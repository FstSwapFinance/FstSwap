import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadPool} from '../server/swap-read-pool.mjs';

const urls=['https://one.invalid/private-KEY','https://two.invalid/private-KEY','https://three.invalid/private-KEY','https://four.invalid/private-KEY'];
const rpc=(id,result)=>new Response(JSON.stringify({jsonrpc:'2.0',id,result}));
const error=code=>Object.assign(new Error(code),{code});
const signal=()=>new AbortController();
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function fixture(t,handler=()=> '0x1',{endpoints=urls.slice(0,2),time=20000,timeoutMs=10000}={}){
 let now=time;const calls=[];
 t.mock.timers.enable({apis:['setTimeout']});
 const fetchImpl=async(url,options)=>{
  const payload=JSON.parse(options.body);const call={url,payload,signal:options.signal};calls.push(call);
  const result=await handler(call);
  return result instanceof Response?result:rpc(payload.id,payload.method==='eth_chainId'&&result===undefined?'0x38':result);
 };
 const pool=createReadPool(endpoints,{fetchImpl,clock:()=>now,timeoutMs});
 return {pool,calls,async advance(ms){now+=ms;t.mock.timers.tick(ms);await flush();},clock:()=>now};
}
function pending(call){return new Promise((_,reject)=>{
 if(call.signal.aborted)return reject(call.signal.reason);
 call.signal.addEventListener('abort',()=>reject(call.signal.reason),{once:true});
});}
const read={method:'eth_call',params:[{to:'0x'+'11'.repeat(20),data:'0x'},'latest']};

test('pool keeps endpoint secrets out of nodes, diagnostics and transport errors',async t=>{
 const f=fixture(t,call=>{if(call.payload.method==='eth_chainId')return '0x38';throw new Error('failed '+call.url);});
 const failure=await f.pool.run(r=>r(read),signal().signal).catch(e=>e);
 assert.equal(failure.code,'UPSTREAM_UNAVAILABLE');
 assert.doesNotMatch(JSON.stringify([f.pool.nodes,f.pool.health(),{message:failure.message,...failure}]),/private-KEY|https:\/\//);
});

test('chain 56 verification is mandatory even at clock zero and expires after ten seconds',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':'0x1',{time:0,endpoints:urls.slice(0,1)});
 await f.pool.run(()=>42,signal().signal);await f.pool.run(()=>42,signal().signal);
 assert.equal(f.calls.filter(c=>c.payload.method==='eth_chainId').length,1);
 await f.advance(10001);await f.pool.run(()=>42,signal().signal);
 assert.equal(f.calls.filter(c=>c.payload.method==='eth_chainId').length,2);
});

test('wrong-chain nodes never execute an operation and cannot become healthy through mutable metadata',async t=>{
 const f=fixture(t,call=>call.url===urls[0]?'0x61':'0x38');
 let executions=0;f.pool.nodes[0].chainAt=f.clock();
 const result=await f.pool.run((r,node)=>{executions++;return node.id;},signal().signal);
 assert.equal(result,'upstream-2');assert.equal(executions,1);
 assert.equal(f.pool.health().providers[0].ready,false);
});

test('terminal quote and nonretryable pool errors retain identity without provider failover or penalty',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':'0x1');
 for(const code of ['NO_ROUTE','UNSAFE_QUOTE','TAX_UNVERIFIED','POOL_LIQUIDITY','POOL_POLICY']){
  const expected=Object.assign(error(code),{reason:'price',retryable:false});let attempts=0;
  await assert.rejects(f.pool.run(async r=>{attempts++;await r(read);throw expected;},signal().signal),e=>e===expected);
  assert.equal(attempts,1);
 }
 assert.equal(f.pool.health().providers.reduce((n,p)=>n+p.failures,0),0);
});

test('retryable transport failures rerun complete same-node operations at most three times',async t=>{
 const f=fixture(t,call=>{if(call.payload.method==='eth_chainId')return '0x38';if(call.payload.method==='eth_getBlockByNumber')return {number:'0x20'};throw error('offline');},{endpoints:urls});
 const attempts=[];
 await assert.rejects(f.pool.run(async(r,node)=>{attempts.push(node.id);await r({method:'eth_getBlockByNumber',params:['latest',false]});return r(read);},signal().signal),{code:'UPSTREAM_UNAVAILABLE'});
 assert.deepEqual(attempts,['upstream-1','upstream-2','upstream-3']);
 for(const url of urls.slice(0,3))assert.deepEqual(f.calls.filter(c=>c.url===url).map(c=>c.payload.method),['eth_chainId','eth_getBlockByNumber','eth_call']);
});

test('caller cancellation aborts work immediately without retries or node failures',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':pending(call));const controller=signal();
 const result=f.pool.run(r=>r(read),controller.signal).catch(e=>e);await flush();controller.abort();await flush();
 assert.equal((await result).code,'REQUEST_ABORTED');
 assert.equal(f.calls.filter(c=>c.payload.method==='eth_call').length,1);
 assert.equal(f.calls.at(-1).signal.aborted,true);
 assert.equal(f.pool.health().providers.reduce((n,p)=>n+p.failures,0),0);
});

test('rate limits respect Retry-After while cooling nodes lose priority',async t=>{
 let limited=true;const f=fixture(t,call=>{
  if(call.payload.method==='eth_chainId')return '0x38';
  if(call.url===urls[0]&&limited)return new Response('',{status:429,headers:{'retry-after':'30'}});
  return '0x2';
 });
 assert.equal(await f.pool.run(r=>r(read),signal().signal),'0x2');
 assert.ok(f.pool.health().providers[0].cooldownMs>=30000);limited=false;
 const before=f.calls.length;assert.equal(await f.pool.run(r=>r(read),signal().signal),'0x2');
 assert.equal(f.calls[before].url,urls[1]);
});

test('request classifications record observed EWMA and small sample p90',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':new Promise(resolve=>setTimeout(()=>resolve('0x1'),100)),{endpoints:urls.slice(0,1)});
 const run=f.pool.run(r=>r(read),signal().signal,{operation:'quote'});await flush();await f.advance(100);await run;
 const provider=f.pool.health().providers[0];
 assert.equal(provider.requests.eth_call.ewmaMs,100);assert.equal(provider.requests.eth_call.p90Ms,100);
 assert.equal(provider.operations.quote.p90Ms,100);assert.equal(provider.requests.eth_call.samples,1);
});

test('unhealthy historical head lag lowers priority without changing the operation result',async t=>{
 let phase=0;const f=fixture(t,call=>{
  if(call.payload.method==='eth_chainId')return '0x38';
  if(call.payload.method==='eth_getBlockByNumber')return {number:call.url===urls[0]?'0x10':'0x20'};
  return '0x1';
 });
 await f.pool.run(r=>r({method:'eth_getBlockByNumber',params:['latest',false]}),signal().signal);
 // A retryable application failure lets the pool observe the other node independently.
 await f.pool.run(async(r,node)=>{if(node.id==='upstream-1'&&phase++===0)throw Object.assign(error('STALE_BLOCK'),{retryable:true});return r({method:'eth_getBlockByNumber',params:['latest',false]});},signal().signal);
 assert.equal(f.pool.health().providers[0].headLag,16);
 assert.equal(await f.pool.run((r,node)=>node.id,signal().signal),'upstream-2');
});

test('hedging requires opt-in, is limited to every fifth eligible operation and aborts only the losing complete operation',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.url===urls[0]?pending(call):call.payload.method==='eth_getBlockByNumber'?{number:'0x30'}:'0x2');
 for(let i=0;i<4;i++)await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'balances'});
 const attempts=[];const result=f.pool.run(async(r,node)=>{
  attempts.push(node.id);const block=await r({method:'eth_getBlockByNumber',params:['latest',false]});const value=await r(read);return {node:node.id,block,value};
 },signal().signal,{hedge:true,operation:'quote'});
 await flush();await f.advance(2499);assert.equal(attempts.length,1);
 await f.advance(1);const winner=await result;
 assert.deepEqual(winner,{node:'upstream-2',block:{number:'0x30'},value:'0x2'});
 assert.deepEqual(attempts,['upstream-1','upstream-2']);
 assert.ok(f.calls.find(c=>c.url===urls[0]&&c.payload.method==='eth_getBlockByNumber').signal.aborted);
 assert.equal(f.pool.health().providers[0].failures,0);
 const controller=signal();const before=f.calls.length;
 const noHedge=f.pool.run(r=>pending({signal:controller.signal}),controller.signal,{operation:'quote'}).catch(e=>e);
 await flush();await f.advance(3000);assert.equal(f.calls.length,before);controller.abort();await noHedge;
});

test('hedge concurrency is globally capped at two and cancellation releases both slots',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':pending(call));
 const controllers=[],runs=[];let attempts=0;
 for(let i=1;i<=15;i++){
  if(i%5){await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'balances'});continue;}
  const controller=signal();controllers.push(controller);
  runs.push(f.pool.run(async r=>{attempts++;return r(read);},controller.signal,{hedge:true,operation:'quote'}).catch(e=>e));await flush();
 }
 try{
  await f.advance(2500);assert.equal(attempts,5);
  assert.equal(f.pool.health().activeHedges,2);
  const idle=createReadPool(['https://idle.invalid'],{fetchImpl:async()=>{throw Error('idle pool must not fetch');}});
  assert.equal(idle.health().activeHedges,0);
 }finally{controllers.forEach(c=>c.abort());await Promise.all(runs);await flush();}
 assert.equal(f.pool.health().activeHedges,0);assert.equal(f.pool.health().active,0);
 assert.equal(f.pool.health().providers.reduce((n,p)=>n+p.failures,0),0);
});

test('transport only permits the read allowlist and retains the response size and concurrency limits',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':new Response('x'.repeat(2*1024*1024+1)),{endpoints:urls.slice(0,1)});
 await assert.rejects(f.pool.run(r=>r({method:'eth_sendRawTransaction',params:['0x']}),signal().signal),{code:'RPC_FORBIDDEN'});
 assert.equal(f.calls.length,1);
 await assert.rejects(f.pool.run(r=>r(read),signal().signal),{code:'UPSTREAM_LIMIT'});
});

test('the tax runtime read allows only the fixed FSTSI contract at an explicit block outside batches',async t=>{
 const token='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e';
 const block='0x8094e65';
 const codeRead={method:'eth_getCode',params:[token,block]};
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':'0x6080',{endpoints:urls.slice(0,1)});
 const run=operation=>f.pool.run(operation,signal().signal,{operation:'quote'});
 assert.equal(await run(request=>request(codeRead)),'0x6080');
 assert.deepEqual(f.calls.map(({payload})=>payload.method),['eth_chainId','eth_getCode']);
 assert.deepEqual(f.calls.at(-1).payload.params,codeRead.params);

 for(const params of [[read.params[0].to,block],[token,'latest'],[token,135000000],[token],[token,block,'extra']]){
  await assert.rejects(run(request=>request({method:'eth_getCode',params})),{code:'RPC_FORBIDDEN'});
 }
 await assert.rejects(run(request=>request.batch([codeRead])),{code:'RPC_FORBIDDEN'});
 assert.equal(f.calls.length,2,'rejected bytecode requests must never reach the provider');
 assert.equal(f.pool.health().providers[0].failures,0);
});

test('transport cannot impersonate a safe internal error to leak its URL',async t=>{
 const f=fixture(t,call=>{if(call.payload.method==='eth_chainId')return '0x38';throw Object.assign(new Error(call.url),{code:'UPSTREAM_UNAVAILABLE',cause:call.url});});
 const failure=await f.pool.run(r=>r(read),signal().signal).catch(e=>e);
 assert.equal(failure.code,'UPSTREAM_UNAVAILABLE');assert.equal(failure.cause,undefined);
 assert.doesNotMatch(failure.message,/https|KEY/);
});

test('48 active requests are allowed but the 49th is rejected without retrying or penalizing providers',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':pending(call),{endpoints:urls.slice(0,1)});
 await f.pool.run(()=>true,signal().signal);
 const controller=signal(),runs=Array.from({length:48},()=>f.pool.run(r=>r(read),controller.signal).catch(e=>e));await flush();
 assert.equal(f.pool.health().active,48);
 await assert.rejects(f.pool.run(r=>r(read),signal().signal),{code:'SERVICE_BUSY'});
 assert.equal(f.calls.filter(c=>c.payload.method==='eth_call').length,48);
 controller.abort();await Promise.all(runs);await flush();
 assert.equal(f.pool.health().active,0);assert.equal(f.pool.health().providers[0].failures,0);
});

test('an upstream timeout is retryable but an expired caller deadline is not a provider failure',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':pending(call),{endpoints:urls.slice(0,1),timeoutMs:1000});
 let attempts=0;const one=f.pool.run(r=>{attempts++;return r(read);},signal().signal).catch(e=>e);await flush();await f.advance(1000);
 assert.equal((await one).code,'UPSTREAM_TIMEOUT');assert.equal(attempts,1);assert.equal(f.pool.health().providers[0].failures,1);
 await f.advance(10000);
 const controller=signal(),two=f.pool.run(r=>r(read),controller.signal).catch(e=>e);await flush();controller.abort(new DOMException('deadline','TimeoutError'));
 assert.equal((await two).code,'REQUEST_TIMEOUT');assert.equal(f.pool.health().providers[0].failures,1);
});

test('historical p90 controls the hedge timer and opt-in does not bypass the fifth-operation limit',async t=>{
 let slow=false;
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':slow&&call.url===urls[0]?pending(call):new Promise(resolve=>setTimeout(()=>resolve('0x2'),100)));
 const warm=f.pool.run(r=>r(read),signal().signal,{operation:'quote'});await flush();await f.advance(100);await warm;
 for(let i=0;i<4;i++)await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'balances'});
 slow=true;let attempts=0;
 const controller=signal(),result=f.pool.run(r=>{attempts++;return r(read);},controller.signal,{hedge:true,operation:'quote'});
 await flush();await f.advance(1499);assert.equal(attempts,1);
 await f.advance(1);assert.equal(attempts,2);await f.advance(100);assert.equal(await result,'0x2');
 const nextController=signal();let nextAttempts=0;
 const next=f.pool.run(()=>{nextAttempts++;return new Promise(()=>{});},nextController.signal,{hedge:true,operation:'quote'}).catch(e=>e);
 await flush();await f.advance(3000);assert.equal(nextAttempts,1);nextController.abort();await next;
});

test('the recent p90 ignores one outlier among ten successful real requests',async t=>{
 let duration=100;const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':new Promise(resolve=>setTimeout(()=>resolve('0x1'),duration)),{endpoints:urls.slice(0,1)});
 for(let i=0;i<10;i++){
  duration=i===9?400:100;const run=f.pool.run(r=>r(read),signal().signal,{operation:'quote'});await flush();await f.advance(duration);await run;
 }
 const stats=f.pool.health().providers[0].requests.eth_call;
 assert.equal(stats.samples,10);assert.equal(stats.p90Ms,100);assert.equal(stats.ewmaMs,175);
});

test('a failed hedge still leaves no more than three total complete operation attempts',async t=>{
 let operationAttempts=0;
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':pending(call),{endpoints:urls,timeoutMs:3000});
 for(let i=0;i<4;i++)await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'balances'});
 const controller=signal();const result=f.pool.run(r=>{operationAttempts++;return r(read);},controller.signal,{hedge:true,operation:'quote'}).catch(e=>e);
 await flush();await f.advance(2500);assert.equal(operationAttempts,2);
 await f.advance(3000);await flush();assert.equal(operationAttempts,3);
 await f.advance(3000);assert.equal((await result).code,'UPSTREAM_TIMEOUT');assert.equal(operationAttempts,3);
});

test('a provider inside Retry-After cooldown is not contacted again when all nodes are cooling',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':new Response('',{status:429,headers:{'retry-after':'30'}}),{endpoints:urls.slice(0,1)});
 await assert.rejects(f.pool.run(r=>r(read),signal().signal),{code:'UPSTREAM_RATE_LIMIT'});
 const before=f.calls.length;
 await assert.rejects(f.pool.run(r=>r(read),signal().signal));
 assert.equal(f.calls.length,before);
 await f.advance(30000);
 await assert.rejects(f.pool.run(r=>r(read),signal().signal),{code:'UPSTREAM_RATE_LIMIT'});
 assert.equal(f.calls.filter(c=>c.payload.method==='eth_call').length,2);
});

test('an internal nodeId binding executes only that provider and disables failover and hedging',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':pending(call),{endpoints:urls});
 for(let i=0;i<4;i++)await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'balances'});
 const controller=signal();let attempts=0;
 const result=f.pool.run(async(r,node)=>{attempts++;assert.equal(node.id,'upstream-2');return r(read);},controller.signal,{hedge:true,operation:'quote',nodeId:'upstream-2'}).catch(e=>e);
 await flush();await f.advance(3000);assert.equal(attempts,1);controller.abort();await result;
 assert.ok(f.calls.filter(c=>c.payload.method==='eth_call').every(c=>c.url===urls[1]));
 const before=f.calls.length;
 await assert.rejects(f.pool.run(()=>true,signal().signal,{nodeId:'unknown'}),{code:'INVALID_INPUT'});
 assert.equal(f.calls.length,before);
});

test('a nested independent context can stay bound to the outer complete operation provider',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.url===urls[0]?'0xa':'0xb');
 const result=await f.pool.run(async(r,node)=>{
  const context=await f.pool.run(async(inner,contextNode)=>({node:contextNode.id,value:await inner(read)}),signal().signal,{operation:'config',nodeId:node.id});
  return {node:node.id,context,value:await r(read)};
 },signal().signal,{operation:'quote'});
 assert.deepEqual(result,{node:'upstream-1',context:{node:'upstream-1',value:'0xa'},value:'0xa'});
});

test('a real engine hedge winner aborts the losing independent context RPC immediately',async t=>{
 const {createEngine}=await import('../server/fstswap-service.mjs');
 const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.payload.method==='eth_getBlockByNumber'?block:call.url===urls[0]?pending(call):'0x',{time:200000});
 for(let i=0;i<4;i++)await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'warm'});
 const engine=createEngine(f.pool,{clock:f.clock,readConfig:async()=>({version:'1.11'}),readPolicy:async request=>{await request(read);return{checkedAt:200000,assertFresh(){}};},calculate:async()=>({out:1n}),warmup:{enabled:false}});
 const input={chainId:56,tokenIn:'0x'+'11'.repeat(20),tokenOut:'0x'+'22'.repeat(20),amountIn:'1',slippageBps:0,singleHop:false};
 const result=engine.quote(input);await flush();await f.advance(2500);assert.equal((await result).quote.out,1n);await flush();
 assert.equal(f.calls.find(c=>c.url===urls[0]&&c.payload.method==='eth_call').signal.aborted,true);
 assert.equal(f.pool.health().active,0);assert.equal(f.pool.health().activeHedges,0);
 assert.equal(f.pool.health().providers[0].failures,0);
});

test('canceling a losing real hedge leaves another amount subscribed to its same-node context',async t=>{
 const {createEngine}=await import('../server/fstswap-service.mjs');
 const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 let releasePrimary,policyReads=0,priming=true;
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.payload.method==='eth_getBlockByNumber'?block:call.url===urls[0]?(priming?'0x':new Promise(resolve=>{releasePrimary=()=>resolve('0x');call.signal.addEventListener('abort',()=>resolve('0x'),{once:true});})):'0x',{time:200000});
 // Establish that primary is a fast eth_call provider before sharing its context.
 await f.pool.run(r=>r(read),signal().signal,{nodeId:'upstream-1',operation:'config'});priming=false;
 for(let i=0;i<4;i++)await f.pool.run(()=>true,signal().signal,{hedge:true,operation:'warm'});
 const engine=createEngine(f.pool,{clock:f.clock,readConfig:async()=>({version:'1.11'}),readPolicy:async request=>{policyReads++;await request(read);return{checkedAt:200000,assertFresh(){}};},calculate:async(_r,input)=>({out:BigInt(input.amountIn)}),warmup:{enabled:false}});
 const input={chainId:56,tokenIn:'0x'+'11'.repeat(20),tokenOut:'0x'+'22'.repeat(20),amountIn:'1',slippageBps:0,singleHop:false};
 const one=engine.quote(input);await flush();const two=engine.quote({...input,amountIn:'2'});await flush();
 assert.equal(f.calls.filter(c=>c.url===urls[0]&&c.payload.method==='eth_call').length,2);
 await f.advance(2500);assert.equal((await one).quote.out,1n);await flush();
 assert.equal(f.calls.filter(c=>c.url===urls[0]&&c.payload.method==='eth_call').at(-1).signal.aborted,false);
 assert.equal(f.pool.health().active,1);releasePrimary();assert.equal((await two).quote.out,2n);await flush();
 assert.equal(policyReads,2);assert.equal(f.pool.health().active,0);
});

test('an old header observation is unknown rather than permanent evidence of provider lag',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':{number:call.url===urls[0]?'0x10':'0x110'});
 await f.pool.run(r=>r({method:'eth_getBlockByNumber',params:['latest',false]}),signal().signal,{nodeId:'upstream-1'});
 await f.advance(60000);
 await f.pool.run(r=>r({method:'eth_getBlockByNumber',params:['latest',false]}),signal().signal,{nodeId:'upstream-2'});
 const old=f.pool.health().providers[0];
 assert.equal(old.headLag,null);assert.ok(old.score<2000);
 // The old observation carries no permanent score penalty. Foreground cold
 // selection can still prefer the peer whose chain and header were just read.
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'warm'}),'upstream-1');
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
});

test('head penalties require close fresh observations and expire when those observations age',async t=>{
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':{number:call.url===urls[0]?'0x10':'0x20'});
 const header={method:'eth_getBlockByNumber',params:['latest',false]};
 await f.pool.run(r=>r(header),signal().signal,{nodeId:'upstream-1'});
 await f.advance(1501);await f.pool.run(r=>r(header),signal().signal,{nodeId:'upstream-2'});
 assert.equal(f.pool.health().providers[0].headLag,null);
 await f.pool.run(r=>r(header),signal().signal,{nodeId:'upstream-1'});
 assert.equal(f.pool.health().providers[0].headLag,16);
 await f.advance(5001);assert.equal(f.pool.health().providers[0].headLag,null);
});

function measuredFixture(t,{calls=[40,400],headers=[40,40]}={}){
 return fixture(t,call=>{
  if(call.payload.method==='eth_chainId')return '0x38';
  const index=urls.indexOf(call.url),header=call.payload.method==='eth_getBlockByNumber';
  return new Promise(resolve=>setTimeout(()=>resolve(header?{number:'0x20'}:'0x1'),(header?headers:calls)[index]));
 });
}
async function measure(f,nodeId,method,delay,{operation='quote',extraMs=0}={}){
 const run=f.pool.run(async r=>{
  await r(method==='eth_getBlockByNumber'?{method,params:['latest',false]}:read);
  if(extraMs)await new Promise(resolve=>setTimeout(resolve,extraMs));
 },signal().signal,{nodeId,operation});
 await flush();await f.advance(delay);if(extraMs)await f.advance(extraMs);await run;await flush();
}

test('provider selection compares same-method RPC speed rather than complete quote computation cost',async t=>{
 const f=measuredFixture(t);
 await measure(f,'upstream-1','eth_call',40,{extraMs:3000});
 await measure(f,'upstream-2','eth_call',400);
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-1');
 assert.equal(f.pool.health().providers[0].operations.quote.p90Ms,3040);
});

test('a healthy fast provider keeps context warmups ahead of unknown providers despite expensive warm operations',async t=>{
 const f=measuredFixture(t);
 await measure(f,'upstream-1','eth_call',40,{operation:'warm',extraMs:1800});
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'warm'}),'upstream-1');
});

test('cache-only operation completions never make a slow RPC look faster than a fast provider',async t=>{
 const f=measuredFixture(t,{calls:[300,50]});
 await measure(f,'upstream-1','eth_call',300);
 await measure(f,'upstream-2','eth_call',50);
 for(let i=0;i<24;i++)await f.pool.run(()=>true,signal().signal,{nodeId:'upstream-1',operation:'quote'});
 await flush();
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
});

test('context warmups share eth_call ranking while explicit light warmups use header speed',async t=>{
 const f=measuredFixture(t,{calls:[40,400],headers:[500,40]});
 await measure(f,'upstream-1','eth_call',40);await measure(f,'upstream-2','eth_call',400);
 await measure(f,'upstream-1','eth_getBlockByNumber',500);await measure(f,'upstream-2','eth_getBlockByNumber',40);
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'warm'}),'upstream-1');
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'warm',rpcClass:'header'}),'upstream-2');
});

const probeDecimals='0x'+('12'.padStart(64,'0'));
const probeBlock={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
function probeFixture(t,handler,{endpoints=urls.slice(0,2)}={}){
 return fixture(t,call=>handler?handler(call):call.payload.method==='eth_chainId'?'0x38':call.payload.method==='eth_getBlockByNumber'?{...probeBlock}:probeDecimals,{time:200000,endpoints});
}
function probe(pool,options){assert.equal(typeof pool.probe,'function','read pool must expose a bounded background probe API');return pool.probe(options);}

test('background probing is explicit and reads only fixed chain, header and USDT decimals on one node',async t=>{
 const f=probeFixture(t);await f.advance(60000);assert.equal(f.calls.length,0);
 const result=await probe(f.pool);
 assert.equal(result.status,'ok');assert.equal(result.id,'upstream-1');
 assert.deepEqual(f.calls.map(c=>c.payload.method),['eth_chainId','eth_getBlockByNumber','eth_call']);
 assert.ok(f.calls.every(c=>c.url===urls[0]));
 assert.deepEqual(f.calls.at(-1).payload.params,[{to:'0x55d398326f99059ff775485246999027b3197955',data:'0x313ce567'},'0x20']);
 const provider=f.pool.health().providers[0];
 assert.equal(provider.requests.eth_call,undefined);assert.equal(provider.probeRequests.eth_call.samples,1);
 assert.equal(provider.measurementSource,'probe');assert.equal(provider.lastProbeAt,260000);
 assert.doesNotMatch(JSON.stringify(f.pool.health()),/private-KEY|https:\/\//);
});

test('probes prefer unmeasured providers then rotate by oldest probe without replacing foreground ranking',async t=>{
 const f=probeFixture(t,undefined,{endpoints:urls.slice(0,3)});
 await f.pool.run(r=>r(read),signal().signal,{nodeId:'upstream-1',operation:'quote'});await flush();
 const ids=[];
 for(let i=0;i<4;i++){if(i)await f.advance(30000);ids.push((await probe(f.pool)).id);}
 assert.deepEqual(ids,['upstream-2','upstream-3','upstream-1','upstream-2']);
});

test('probes enforce a thirty second interval without creating their own timer',async t=>{
 const f=probeFixture(t);await probe(f.pool);const before=f.calls.length;
 assert.deepEqual(await probe(f.pool),{status:'skipped',reason:'interval'});
 await f.advance(29999);assert.deepEqual(await probe(f.pool),{status:'skipped',reason:'interval'});assert.equal(f.calls.length,before);
 await f.advance(1);assert.equal(f.calls.length,before);assert.equal((await probe(f.pool)).id,'upstream-2');
});

test('a running probe excludes another probe and shutdown cancellation aborts it without penalizing nodes',async t=>{
 const f=probeFixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.payload.method==='eth_getBlockByNumber'?{...probeBlock}:pending(call));
 const controller=signal(),one=probe(f.pool,{signal:controller.signal}).catch(e=>e);await flush();
 assert.deepEqual(await probe(f.pool),{status:'skipped',reason:'running'});
 controller.abort();assert.equal((await one).code,'REQUEST_ABORTED');await flush();
 assert.equal(f.pool.health().active,0);assert.equal(f.pool.health().probing,false);
 assert.equal(f.pool.health().providers[0].failures,0);assert.equal(f.calls.at(-1).signal.aborted,true);
});

test('foreground operations and the server busy hint make probes skip before contacting any node',async t=>{
 const f=probeFixture(t);await f.pool.run(()=>true,signal().signal);await flush();
 const controller=signal(),foreground=f.pool.run(()=>new Promise(()=>{}),controller.signal).catch(e=>e);await flush();const before=f.calls.length;
 assert.deepEqual(await probe(f.pool),{status:'skipped',reason:'busy'});assert.equal(f.calls.length,before);
 controller.abort();await foreground;await flush();
 assert.deepEqual(await probe(f.pool,{busy:true}),{status:'skipped',reason:'busy'});assert.equal(f.calls.length,before);
 assert.equal((await probe(f.pool)).status,'ok');
});

test('probes skip cooling providers and never accept caller-selected targets or RPC methods',async t=>{
 const f=probeFixture(t,call=>call.payload.method==='eth_chainId'?(call.url===urls[0]?'0x61':'0x38'):call.payload.method==='eth_getBlockByNumber'?{...probeBlock}:probeDecimals);
 await assert.rejects(f.pool.run(()=>true,signal().signal,{nodeId:'upstream-1'}),{code:'WRONG_CHAIN'});
 const before=f.calls.length;
 await assert.rejects(probe(f.pool,{target:'https://attacker.invalid',method:'eth_sendTransaction'}),{code:'INVALID_INPUT'});assert.equal(f.calls.length,before);
 assert.equal((await probe(f.pool)).id,'upstream-2');
 assert.ok(f.calls.slice(before).every(c=>c.url===urls[1]));
});

test('a probe cannot succeed on the wrong chain, a stale header or a non-18 decimals response',async t=>{
 for(const scenario of ['chain','header','decimals'])await t.test(scenario,async child=>{
  const f=probeFixture(child,call=>call.payload.method==='eth_chainId'?(scenario==='chain'?'0x61':'0x38'):call.payload.method==='eth_getBlockByNumber'?{...probeBlock,timestamp:scenario==='header'?'0x1':probeBlock.timestamp}:scenario==='decimals'?'0x'+('6'.padStart(64,'0')):probeDecimals,{endpoints:urls.slice(0,1)});
  await assert.rejects(probe(f.pool),{code:scenario==='chain'?'WRONG_CHAIN':scenario==='header'?'STALE_BLOCK':'UPSTREAM_UNAVAILABLE'});
  assert.equal(f.pool.health().providers[0].failures,1);
 });
});

test('simple probe samples stay separate and cannot dilute recent real quote eth_call latency',async t=>{
 let duration=400;
 const f=probeFixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.payload.method==='eth_getBlockByNumber'?{...probeBlock,timestamp:'0x'+Math.floor(f.clock()/1000).toString(16)}:new Promise(resolve=>setTimeout(()=>resolve(probeDecimals),duration)),{endpoints:urls.slice(0,1)});
 await measure(f,'upstream-1','eth_call',400);
 duration=10;const first=probe(f.pool);await flush();await f.advance(10);await first;await flush();
 let provider=f.pool.health().providers[0];
 assert.equal(provider.requests.eth_call.samples,1);assert.equal(provider.requests.eth_call.ewmaMs,400);
 assert.equal(provider.probeRequests.eth_call.ewmaMs,10);assert.equal(provider.measurementSource,'real');assert.equal(provider.score,400);
 await f.advance(300001);
 const next=probe(f.pool);await flush();await f.advance(10);await next;await flush();provider=f.pool.health().providers[0];
 assert.equal(provider.measurementSource,'probe');assert.ok(provider.score<1000);assert.equal(provider.requests.eth_call.ewmaMs,400);
});

test('probe chain validation is fresh even when the normal ten second verification cache is valid',async t=>{
 let chain='0x38';
 const f=probeFixture(t,call=>call.payload.method==='eth_chainId'?chain:call.payload.method==='eth_getBlockByNumber'?{...probeBlock}:probeDecimals,{endpoints:urls.slice(0,1)});
 await f.pool.run(()=>true,signal().signal);await flush();chain='0x61';
 await assert.rejects(probe(f.pool),{code:'WRONG_CHAIN'});
 assert.deepEqual(f.calls.map(c=>c.payload.method),['eth_chainId','eth_chainId']);
});

test('empty and fully cooled pools skip probes without consuming an interval or making requests',async t=>{
 const f=probeFixture(t,call=>call.payload.method==='eth_chainId'?'0x61':probeDecimals,{endpoints:urls.slice(0,1)});
 await assert.rejects(f.pool.run(()=>true,signal().signal),{code:'WRONG_CHAIN'});await flush();const before=f.calls.length;
 assert.deepEqual(await probe(f.pool),{status:'skipped',reason:'cooldown'});assert.equal(f.calls.length,before);
 const empty=createReadPool([],{fetchImpl:async()=>{throw Error('must not fetch');}});
 assert.deepEqual(await probe(empty),{status:'skipped',reason:'empty'});
 const controller=signal();controller.abort();await assert.rejects(probe(empty,{signal:controller.signal}),{code:'REQUEST_ABORTED'});
});

test('a foreground arrival preempts an active probe without a retry, penalty or wrong-provider load bias',async t=>{
 let probingCall=false;
 const f=probeFixture(t,call=>{
  if(call.payload.method==='eth_chainId')return '0x38';
  if(call.payload.method==='eth_getBlockByNumber')return {...probeBlock};
  if(probingCall)return pending(call);
  return new Promise(resolve=>setTimeout(()=>resolve(probeDecimals),call.url===urls[0]?50:100));
 });
 await measure(f,'upstream-1','eth_call',50);await measure(f,'upstream-2','eth_call',100);
 probingCall=true;
 const background=probe(f.pool).catch(e=>e);await flush();
 assert.equal(f.pool.health().probing,true);assert.equal(f.pool.health().active,1);
 const readsBefore=f.calls.length;
 const foreground=f.pool.run((_request,node)=>node.id,signal().signal,{operation:'quote'});
 assert.equal(await foreground,'upstream-1');await flush();
 assert.equal((await background).code,'REQUEST_ABORTED');
 assert.equal(f.calls.length,readsBefore);assert.equal(f.calls.at(-1).signal.aborted,true);
 assert.equal(f.pool.health().active,0);assert.equal(f.pool.health().probing,false);
 assert.equal(f.pool.health().providers[0].failures,0);
 assert.equal(f.pool.health().providers[0].probeRequests.eth_call.failures,0);
});

const latestHeader={method:'eth_getBlockByNumber',params:['latest',false]};
async function bootstrapFixture(t,{readyId='upstream-1',time=200000,headerNumber='0x20'}={}){
 const f=fixture(t,call=>call.payload.method==='eth_chainId'?'0x38':call.payload.method==='eth_getBlockByNumber'?{...probeBlock,number:headerNumber,timestamp:'0x'+Math.floor(f.clock()/1000).toString(16)}:probeDecimals,{time,endpoints:urls.slice(0,3)});
 await f.pool.run(r=>r(latestHeader),signal().signal,{operation:'warm',rpcClass:'header',nodeId:readyId});
 return f;
}
async function holdWarm(t,f,nodeId='upstream-1'){
 const controller=signal();let request,release;
 const run=f.pool.run(r=>{request=r;return new Promise(resolve=>{release=resolve;});},controller.signal,{operation:'warm',nodeId}).catch(e=>e);
 await flush();assert.equal(typeof request,'function');
 t.after(async()=>{controller.abort();await run;await flush();});
 return{request,async finish(){release(true);await run;await flush();}};
}

test('cold foreground requests keep a verified header node ahead of unknown warm-load competitors',async t=>{
 for(const operation of ['quote','balances','read'])await t.test(operation,async child=>{
  const f=await bootstrapFixture(child);await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation}),'upstream-1');
  assert.equal(f.calls.some(call=>call.url===urls[1]),false);
 });
});

test('cold bootstrap can reuse the third endpoint without removing the original first two',async t=>{
 const f=await bootstrapFixture(t,{readyId:'upstream-3'});await holdWarm(t,f,'upstream-3');
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-3');
 assert.deepEqual(f.pool.nodes.map(node=>node.id),['upstream-1','upstream-2','upstream-3']);
});

test('cold bootstrap accepts successful chain and header proofs recorded at clock zero',async t=>{
 const f=await bootstrapFixture(t,{time:0});await holdWarm(t,f);
 assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-1');
});

test('bootstrap requires a fresh chain proof, header and completed operation',async t=>{
 await t.test('chain only cannot stand in for a latest header',async child=>{
  const f=fixture(child,call=>call.payload.method==='eth_chainId'?'0x38':probeDecimals,{time:200000,endpoints:urls.slice(0,3)});
  await f.pool.run(()=>true,signal().signal,{nodeId:'upstream-1'});await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
 });
 await t.test('a fresh completion cannot renew an expired header',async child=>{
  const f=await bootstrapFixture(child);await f.advance(5000);
  await f.pool.run(()=>true,signal().signal,{nodeId:'upstream-1'});await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
 });
 await t.test('an in-flight fresh header cannot renew an expired successful operation',async child=>{
  const f=await bootstrapFixture(child),held=await holdWarm(child,f);await f.advance(5000);await held.request(latestHeader);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
 });
 await t.test('a late header and completion cannot renew an expired chain proof',async child=>{
  const f=await bootstrapFixture(child),one=await holdWarm(child,f);await holdWarm(child,f);await f.advance(10000);
  await one.request(latestHeader);await one.finish();
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
 });
});

test('failed or relatively lagging bootstrap providers do not displace unknown alternatives',async t=>{
 await t.test('failed and cooling provider',async child=>{
  const f=await bootstrapFixture(child);await holdWarm(child,f);
  await assert.rejects(f.pool.run(()=>{throw error('STALE_BLOCK');},signal().signal,{nodeId:'upstream-1'}),{code:'STALE_BLOCK'});
  const before=f.calls.length;assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
  assert.ok(f.pool.health().providers[0].cooldownMs>0);assert.ok(f.calls.slice(before).every(call=>call.url!==urls[0]));
 });
 await t.test('fresh but sixteen blocks behind a recently observed peer',async child=>{
  const f=fixture(child,call=>call.payload.method==='eth_chainId'?'0x38':{...probeBlock,number:call.url===urls[0]?'0x10':'0x20'},{time:200000,endpoints:urls.slice(0,3)});
  for(const nodeId of ['upstream-1','upstream-2'])await f.pool.run(r=>r(latestHeader),signal().signal,{operation:'warm',rpcClass:'header',nodeId});
  await assert.rejects(f.pool.run(()=>{throw error('STALE_BLOCK');},signal().signal,{nodeId:'upstream-2'}));await holdWarm(child,f);
  assert.equal(f.pool.health().providers[0].headLag,16);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-3');
 });
});

test('recent real or probe call observations leave foreground latency ranking authoritative',async t=>{
 await t.test('any recent real measurement disables the cold preference layer',async child=>{
  const f=await bootstrapFixture(child);const measured=f.pool.run(async r=>{await new Promise(resolve=>setTimeout(resolve,1200));return r(read);},signal().signal,{operation:'quote',nodeId:'upstream-3'});
  // Transport latency, rather than the surrounding computation delay, is measured.
  await flush();await f.advance(1200);await measured;
  await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-3');
 });
 await t.test('a fast background probe remains ahead of a header-only provider',async child=>{
  const f=await bootstrapFixture(child);
  await assert.rejects(f.pool.run(()=>{throw error('STALE_BLOCK');},signal().signal,{nodeId:'upstream-1'}));
  assert.equal((await probe(f.pool)).id,'upstream-2');await f.advance(10001);
  await f.pool.run(r=>r(latestHeader),signal().signal,{operation:'warm',rpcClass:'header',nodeId:'upstream-1'});await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote'}),'upstream-2');
 });
});

test('bootstrap ordering does not change warmups, unbound config work or a fixed node identity',async t=>{
 for(const operation of ['warm','config'])await t.test(operation,async child=>{
  const f=await bootstrapFixture(child);await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation}),'upstream-2');
 });
 await t.test('fixed provider identity',async child=>{
  const f=await bootstrapFixture(child);await holdWarm(child,f);
  assert.equal(await f.pool.run((_r,node)=>node.id,signal().signal,{operation:'quote',nodeId:'upstream-3'}),'upstream-3');
 });
});
