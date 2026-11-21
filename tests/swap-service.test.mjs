import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteInput,balanceInput,createReadPool,createEngine,createApi,encode,endpointsFromEnv} from '../server/fstswap-service.mjs';
import * as service from '../server/fstswap-service.mjs';
const a='0x'+'11'.repeat(20),b='0x'+'22'.repeat(20),z='0x'+'00'.repeat(20);
const input={chainId:56,tokenIn:a,tokenOut:b,amountIn:'1000000000000000001',slippageBps:0,singleHop:false};
test('quote input keeps exact integers and explicit zero slippage',()=>{assert.equal(quoteInput(input).amountIn,input.amountIn);assert.equal(quoteInput(input).slippageBps,0);});
test('quote input rejects wrong chains, amounts, routing injection and invalid addresses',()=>{
 for(const patch of [{chainId:97},{amountIn:1},{amountIn:'1e18'},{amountIn:'0'},{amountIn:(1n<<256n).toString()},{tokenOut:a},{slippageBps:-1},{slippageBps:5001},{singleHop:'false'},{rpc:'https://evil'},{data:'0x1234'},{tokenIn:[a]}])assert.throws(()=>quoteInput({...input,...patch}),{code:'INVALID_INPUT'});
});
test('balance input bounds token count and normalizes addresses without accepting arbitrary methods',()=>{
 assert.equal(balanceInput({chainId:56,account:a,tokens:[b,b,z]}).tokens.length,2);
 for(const patch of [{tokens:Array(65).fill(b)},{account:'x'},{chainId:97},{method:'eth_sendTransaction'},{tokens:[]},{account:[a]}])assert.throws(()=>balanceInput({chainId:56,account:a,tokens:[b],...patch}),{code:'INVALID_INPUT'});
});
test('wire encoding keeps uint256 exact',()=>{assert.equal(encode({n:123456789012345678901234567890n}),' {"n":{"$bigint":"123456789012345678901234567890"}}'.trim());});
test('endpoint config rejects URL credentials and non HTTPS',()=>{for(const value of ['http://a','https://user:pass@a','https://a#x'])assert.throws(()=>endpointsFromEnv({FSTSWAP_RPC_URLS:value}));});
test('transport rejects writes before network and rejects an incorrect chain',async()=>{
 let calls=[];const pool=createReadPool(['https://rpc.invalid'],{clock:()=>20000,fetchImpl:async(_url,o)=>{const p=JSON.parse(o.body);calls.push(p.method);return new Response(JSON.stringify({jsonrpc:'2.0',id:p.id,result:'0x61'}));}});
 await assert.rejects(pool.run(r=>r({method:'eth_sendTransaction',params:[]}),AbortSignal.timeout(1000)),{code:'WRONG_CHAIN'});assert.deepEqual(calls,['eth_chainId']);
 const verified=createReadPool(['https://rpc.invalid'],{clock:()=>20000,fetchImpl:async(_url,o)=>{const p=JSON.parse(o.body);calls.push(p.method);return new Response(JSON.stringify({jsonrpc:'2.0',id:p.id,result:'0x38'}));}});
 await verified.run(()=>true,AbortSignal.timeout(1000));
 await assert.rejects(verified.run(r=>r({method:'eth_sign',params:[]}),AbortSignal.timeout(1000)),{code:'RPC_FORBIDDEN'});assert.deepEqual(calls,['eth_chainId','eth_chainId']);
});
function fixture({reorg=false}={}){
 let time=200000,calls=[],calculations=0,configReads=0,balances=0;const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const request=async p=>{calls.push(p);if(p.method==='eth_getBlockByNumber')return {...block,hash:reorg&&p.params[0]!=='latest'?'changed':block.hash};if(p.method==='eth_call')return '0x';};
 const pool={run:f=>f(request,{id:'primary'}),health:()=>({providers:[]})};
 const engine=createEngine(pool,{clock:()=>time,readConfig:async r=>{configReads++;await r({method:'eth_call',params:[{to:a},'latest']});return{version:'1.11'};},readPolicy:async r=>{await r({method:'eth_getBlockByNumber',params:['latest',false]});return{checkedAt:time,assertFresh(){}};},calculate:async(r,i,c,p)=>{calculations++;await r({method:'eth_call',params:[{to:b},'latest']});return{amountIn:BigInt(i.amountIn),out:1n,poolCheckedAt:p.checkedAt};},readBalances:async(r,owner,tokens)=>{balances++;await r({method:'eth_getBalance',params:[owner,'latest']});return{balances:Object.fromEntries(tokens.map(t=>[t.key,owner===a?1n:2n])),failed:[]};}});
 return{engine,calls,stats:()=>({calculations,configReads,balances}),advance:n=>time+=n};
}
test('identical in-flight quotes coalesce and every state read uses the pinned block',async()=>{
 const f=fixture(),[q1,q2]=await Promise.all([f.engine.quote(input),f.engine.quote(input)]);
 assert.equal(f.stats().calculations,1);assert.deepEqual(q1,q2);assert.equal(q1.quote.amountIn,1000000000000000001n);
 assert.ok(f.calls.filter(p=>p.method==='eth_call').every(p=>p.params[1]==='0x20'));assert.equal(q1.expiresAt,215000);
 f.advance(1000);const q3=await f.engine.quote({...input,amountIn:'2'});assert.equal(q3.expiresAt,215000);assert.equal(f.stats().configReads,1);
 f.advance(2000);await f.engine.quote(input);assert.equal(f.stats().configReads,2);
});
test('quote and balance hash changes reject instead of publishing a mixed snapshot',async()=>{const f=fixture({reorg:true});await assert.rejects(f.engine.quote(input),{code:'STALE_BLOCK'});await assert.rejects(f.engine.balances({chainId:56,account:a,tokens:[b]}),{code:'STALE_BLOCK'});});
test('balances are fresh, bound to account, exact and pinned',async()=>{const f=fixture();const one=await f.engine.balances({chainId:56,account:a,tokens:[b,z]}),two=await f.engine.balances({chainId:56,account:b,tokens:[b,z]});assert.equal(one.balances[b],'1');assert.equal(two.balances[b],'2');assert.equal(f.stats().balances,2);assert.ok(f.calls.filter(p=>p.method==='eth_getBalance').every(p=>p.params[1]==='0x20'));});
test('HTTP rejects signing paths, malformed bodies, unknown keys and hides upstream errors',async t=>{
 const server=createApi({pool:{health:()=>({providers:[]})},engine:{quote:i=>{quoteInput(i);throw Error('secret https://key.example')},balances:balanceInput}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.closeAllConnections());t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 let r=await fetch(base+'/api/swap/rpc',{method:'POST',body:'{}'});assert.equal(r.status,404);
 r=await fetch(base+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,method:'eth_sendTransaction'})});assert.equal(r.status,400);
 r=await fetch(base+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const s=await r.text();assert.equal(s.includes('secret'),false);assert.equal(s.includes('https'),false);
});

test('malformed provider URLs never retain credentials in startup errors',()=>{
 assert.throws(()=>endpointsFromEnv({FSTSWAP_RPC_URLS:'https://bad host/API_KEY_SYNTHETIC'}),e=>e.code==='RPC_CONFIG'&&!JSON.stringify(e).includes('SYNTHETIC')&&!e.cause&&!e.input);
});
test('one failing token preserves valid balances without retrying a healthy provider',async()=>{
 let attempts=0;const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const pool={run:fn=>{attempts++;return fn(async()=>block);}};
 const engine=createEngine(pool,{clock:()=>200000,readBalances:async()=>({balances:{bnb:100n},failed:[b]})});
 const result=await engine.balances({chainId:56,account:a,tokens:[z,b]});
 assert.deepEqual(result.balances,{[z]:'100'});assert.deepEqual(result.failedTokens,[b]);assert.equal(attempts,1);
});

test('policy reuses the pinned initial block while the final hash check remains a fresh RPC',async()=>{
 const f=fixture();await f.engine.quote(input);
 const blocks=f.calls.filter(p=>p.method==='eth_getBlockByNumber');
 assert.equal(blocks.length,2);assert.deepEqual(blocks.map(p=>p.params[0]),['latest','0x20']);
});
test('engine binds configuration to the pinned snapshot and owns the final canonical check',async()=>{
 const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'},seen=[];
 const request=async p=>{seen.push(p);return block;};
 const engine=createEngine({run:fn=>fn(request,{id:'same'})},{clock:()=>200000,
  readConfig:async (read,options)=>{assert.deepEqual(options.block,block);return{version:'1.11'};},
  readPolicy:async (read,options)=>{assert.equal(options.deferCanonical,true);return{checkedAt:200000,assertFresh(){}};},
  calculate:async()=>({out:1n})});
 await engine.quote(input);assert.deepEqual(seen.map(p=>p.params[0]),['latest','0x20']);
});
test('slow in-flight context is shared across amounts and expires from its original snapshot time',async()=>{
 let now=200000,configs=0,policies=0,release,ready;
 const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r),block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const engine=createEngine({run:fn=>fn(async()=>block,{id:'same'})},{clock:()=>now,
  readConfig:async()=>{configs++;return{version:'1.11'};},
  readPolicy:async()=>{policies++;const checkedAt=now;ready();await gate;return{checkedAt,assertFresh(){}};},
  calculate:async(_,i,c,p)=>({amountIn:BigInt(i.amountIn),out:1n,poolCheckedAt:p.checkedAt})});
 const one=engine.quote(input);await started;now+=3000;
 const two=engine.quote({...input,amountIn:'2'});release();
 const [q1,q2]=await Promise.all([one,two]);assert.equal(configs,1);assert.equal(policies,1);
 assert.equal(q1.expiresAt,215000);assert.equal(q2.expiresAt,215000);
 now+=1000;assert.equal((await engine.quote({...input,amountIn:'3'})).expiresAt,215000);assert.equal(configs,1);
 now+=2000;await engine.quote(input);assert.equal(configs,2);
});
test('failed context is evicted and cannot poison the next quote',async()=>{
 let reads=0;const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const engine=createEngine({run:fn=>fn(async()=>block,{id:'same'})},{clock:()=>200000,readConfig:async()=>({version:'1.11'}),
  readPolicy:async()=>{if(++reads===1)throw Error('offline');return{checkedAt:200000,assertFresh(){}};},calculate:async()=>({out:1n})});
 await assert.rejects(engine.quote(input),/offline/);assert.equal((await engine.quote(input)).quote.out,1n);assert.equal(reads,2);
});

function controlledEngine({readPolicy,calculate,readBalances,warmup}={}){
 let now=200000;const runs=[],block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const pool={run:(fn,signal,options)=>{runs.push({signal,options});return Promise.resolve().then(()=>fn(async()=>({...block}),{id:'same'}));},health:()=>({providers:[]})};
 const engine=createEngine(pool,{clock:()=>now,readConfig:async()=>({version:'1.11'}),readPolicy:readPolicy||(async()=>({checkedAt:now,assertFresh(){}})),calculate:calculate||(async(_,i,c,p)=>({out:1n,poolCheckedAt:p.checkedAt})),readBalances,warmup});
 return{engine,runs,advance:n=>now+=n};
}
const nextTurn=()=>new Promise(r=>setImmediate(r));
test('quote consumers cancel independently and only the last departure aborts the shared upstream',async()=>{
 let release;const gate=new Promise(r=>release=r),f=controlledEngine({calculate:async()=>{await gate;return{out:1n};}}),a1=new AbortController(),a2=new AbortController();
 const one=f.engine.quote(input,{signal:a1.signal}),two=f.engine.quote(input,{signal:a2.signal});
 await nextTurn();a1.abort(Error('secret synthetic cancellation'));await assert.rejects(one,e=>e.code==='REQUEST_ABORTED'&&!e.message.includes('secret'));
 assert.equal(f.runs[0].signal.aborted,false);a2.abort();await assert.rejects(two,{code:'REQUEST_ABORTED'});assert.equal(f.runs[0].signal.aborted,true);release();
});
test('canceling one amount cannot abort another amount sharing its pending context',async()=>{
 let release,ready,policies=0;const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r);
 const f=controlledEngine({readPolicy:async()=>{policies++;ready();await gate;return{checkedAt:200000,assertFresh(){}};}}),controller=new AbortController();
 const one=f.engine.quote(input,{signal:controller.signal});await started;
 const two=f.engine.quote({...input,amountIn:'2'});await nextTurn();controller.abort();await assert.rejects(one,{code:'REQUEST_ABORTED'});release();
 assert.equal((await two).quote.out,1n);assert.equal(policies,1);
});
test('a canceled pending context is evicted so a subsequent quote starts a fresh read',async()=>{
 let release,ready,reads=0;const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r),f=controlledEngine({readPolicy:async()=>{reads++;if(reads===1){ready();await gate;}return{checkedAt:200000,assertFresh(){}};}}),controller=new AbortController();
 const one=f.engine.quote(input,{signal:controller.signal});await started;controller.abort();await assert.rejects(one,{code:'REQUEST_ABORTED'});
 const two=f.engine.quote(input);release();assert.equal((await two).quote.out,1n);assert.equal(reads,2);
});
test('balances forward cancellation and always start a fresh read',async()=>{
 let reads=0,release;const gate=new Promise(r=>release=r),f=controlledEngine({readBalances:async()=>{reads++;if(reads===1)await gate;return{balances:{[b]:7n},failed:[]};}}),controller=new AbortController(),body={chainId:56,account:a,tokens:[b]};
 const one=f.engine.balances(body,{signal:controller.signal});await nextTurn();controller.abort();await assert.rejects(one,{code:'REQUEST_ABORTED'});assert.equal(f.runs[0].signal.aborted,true);
 const two=await f.engine.balances(body);assert.equal(two.balances[b],'7');assert.equal(reads,2);assert.notEqual(f.runs[1].options?.hedge,true);release();
});
test('HTTP client disconnect cancels its engine consumer after the JSON body is complete',async t=>{
 let received,aborted;const started=new Promise(r=>received=r),ended=new Promise(r=>aborted=r);
 const server=createApi({pool:{health:()=>({providers:[]})},engine:{quote:(_body,{signal}={})=>{received(signal);return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>{aborted();reject(Object.assign(Error('secret upstream'),{code:'REQUEST_ABORTED'}));},{once:true}));}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.closeAllConnections());t.after(()=>server.close());
 const controller=new AbortController(),request=fetch('http://127.0.0.1:'+server.address().port+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:controller.signal}).catch(()=>{});
 const signal=await started;assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);controller.abort();await ended;assert.equal(signal.aborted,true);await request;
});
test('warm contexts preserve original expiry and are reused between scheduled refreshes',async()=>{
 let policies=0;const f=controlledEngine({readPolicy:async()=>{policies++;return{checkedAt:200000,assertFresh(){}};},warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 assert.equal(await f.engine.warmupOnce(),true);f.advance(3000);const q=await f.engine.quote(input);
 assert.equal(policies,1);assert.equal(q.expiresAt,215000);assert.equal(f.runs.filter(r=>r.options?.hedge).length,1);
 f.advance(12000);await assert.rejects(f.engine.quote({...input,amountIn:'2'}),{code:'QUOTE_EXPIRED'});
});
test('warmup yields to foreground work and never runs more than one background context',async()=>{
 let release,ready,reads=0;const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r),f=controlledEngine({readPolicy:async()=>{reads++;if(reads===1){ready();await gate;}return{checkedAt:200000,assertFresh(){}};},warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 const warm=f.engine.warmupOnce();await started;assert.equal(await f.engine.warmupOnce(),false);
 const quote=f.engine.quote(input);await nextTurn();release();assert.equal(await warm,true);assert.equal((await quote).quote.out,1n);assert.equal(reads,1);
});

test('warmup refreshes the default plus three recent pairs sequentially and expires inactive pairs',async()=>{
 const pairs=[],f=controlledEngine({readPolicy:async(_read,options)=>{pairs.push([options.tokenIn,options.tokenOut]);return{checkedAt:options.clock(),assertFresh(){}};},warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 for(const tokenOut of ['0x'+'33'.repeat(20),'0x'+'44'.repeat(20),'0x'+'55'.repeat(20)])await f.engine.quote({...input,tokenOut});
 await f.engine.quote(input);pairs.length=0;f.advance(6000);assert.equal(await f.engine.warmupOnce(),true);assert.equal(pairs.length,4);
 assert.deepEqual(pairs[0],[a,b]);assert.equal(new Set(pairs.map(p=>p.join(':'))).size,4);
 pairs.length=0;f.advance(60000);await f.engine.warmupOnce();assert.deepEqual(pairs,[[a,b]]);
});
test('an unrelated foreground quote cancels default warm and disabled warmup makes no reads',async()=>{
 let ready,release,reads=0;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r),f=controlledEngine({readPolicy:async()=>{if(++reads===1){ready();await gate;}return{checkedAt:200000,assertFresh(){}};},warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 const warming=f.engine.warmupOnce();await started;const q=await f.engine.quote({...input,tokenOut:'0x'+'33'.repeat(20)});assert.equal(q.quote.out,1n);assert.equal(f.runs[0].signal.aborted,true);release();assert.equal(await warming,false);
 const disabled=controlledEngine({warmup:{enabled:false}});disabled.engine.startWarmup();assert.equal(await disabled.engine.warmupOnce(),false);disabled.engine.stopWarmup();assert.equal(disabled.runs.length,0);
});
test('warmup never publishes a snapshot whose final canonical block changed',async()=>{
 let canonical=false,policies=0;const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'},engine=createEngine({run:fn=>fn(async p=>({...block,hash:p.params?.[0]==='latest'||canonical?block.hash:'reorg'}),{id:'same'})},{clock:()=>200000,readConfig:async()=>({version:'1.11'}),readPolicy:async()=>{policies++;return{checkedAt:200000,assertFresh(){}};},calculate:async()=>({out:1n}),warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 assert.equal(await engine.warmupOnce(),false);canonical=true;assert.equal((await engine.quote(input)).quote.out,1n);assert.equal(policies,2);
});
test('warming a recent foreground context validates it without extending the original snapshot deadline',async()=>{
 let policies=0;const f=controlledEngine({readPolicy:async()=>{policies++;return{checkedAt:200000,assertFresh(){}};},warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 await f.engine.quote(input);f.advance(1000);assert.equal(await f.engine.warmupOnce(),true);f.advance(3000);const q=await f.engine.quote({...input,amountIn:'2'});assert.equal(policies,1);assert.equal(q.expiresAt,215000);
});
test('quote context is bound to the same provider as calculation even when headers match',async()=>{
 const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};
 const pool={run:(fn,_signal,options={})=>{const id=options.nodeId||(options.hedge?'primary':'backup');return fn(async p=>p.method==='eth_getBlockByNumber'?{...block}:id,{id});}};
 const engine=createEngine(pool,{clock:()=>200000,readConfig:async r=>({version:'1.11',provider:await r({method:'eth_call',params:[{to:a},'latest']})}),readPolicy:async()=>({checkedAt:200000,assertFresh(){}}),calculate:async(r,i,config)=>({out:1n,contextProvider:config.provider,calculationProvider:await r({method:'eth_call',params:[{to:b},'latest']})})});
 const q=await engine.quote(input);assert.equal(q.quote.contextProvider,'primary');assert.equal(q.quote.calculationProvider,'primary');
});
test('foreground quote preempts a same-pair warmup running on another provider',async()=>{
 let ready,release;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r),block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};const warmSignals=[];
 const pool={run:(fn,signal,options={})=>{if(options.operation==='warm')warmSignals.push(signal);const id=options.nodeId||(options.hedge?'quote-node':'warm-node');return fn(async p=>p.method==='eth_getBlockByNumber'?{...block}:id,{id});}};
 const engine=createEngine(pool,{clock:()=>200000,readConfig:async r=>({version:'1.11',provider:await r({method:'eth_call',params:[{to:a},'latest']})}),readPolicy:async(_r,{config})=>{if(config.provider==='warm-node'){ready();await gate;}return{checkedAt:200000,assertFresh(){}};},calculate:async()=>({out:1n}),warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 const warm=engine.warmupOnce();await started;assert.equal((await engine.quote(input)).quote.out,1n);assert.equal(warmSignals[0].aborted,true);release();assert.equal(await warm,false);
});
test('closing the HTTP service stops its context warmup and releases the background read',async t=>{
 let ready,release;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r),f=controlledEngine({readPolicy:async()=>{ready();await gate;return{checkedAt:200000,assertFresh(){}};},warmup:{pairs:[{tokenIn:a,tokenOut:b}]}});
 const server=createApi({engine:f.engine,pool:{health:()=>({providers:[]})}});t.after(()=>{release();f.engine.stopWarmup();server.closeAllConnections();server.close();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));f.engine.startWarmup();await started;await new Promise(r=>server.close(r));assert.equal(f.runs[0].signal.aborted,true);
});
test('equivalent normalized quote inputs share work regardless of JSON field order',async()=>{
 let release,calculations=0;const gate=new Promise(r=>release=r),f=controlledEngine({calculate:async()=>{calculations++;await gate;return{out:1n};}});
 const one=f.engine.quote(input),two=f.engine.quote({singleHop:false,slippageBps:0,amountIn:input.amountIn,tokenOut:b.toUpperCase().replace('0X','0x'),tokenIn:a,chainId:56});await nextTurn();release();await Promise.all([one,two]);assert.equal(calculations,1);
});

test('balance endpoints are separately configured and safely fall back to the quote configuration',()=>{
 const env={FSTSWAP_RPC_URLS:'https://quote.invalid',FSTSWAP_BALANCE_RPC_URLS:'https://balance.invalid'};
 assert.deepEqual(endpointsFromEnv(env),['https://quote.invalid/']);
 assert.deepEqual(endpointsFromEnv(env,{role:'balances'}),['https://balance.invalid/']);
 assert.deepEqual(endpointsFromEnv({FSTSWAP_RPC_URLS:env.FSTSWAP_RPC_URLS},{role:'balances'}),['https://quote.invalid/']);
 for(const value of['http://bad.invalid','https://user:secret@bad.invalid','https://bad host/key'])assert.throws(()=>endpointsFromEnv({...env,FSTSWAP_BALANCE_RPC_URLS:value},{role:'balances'}),e=>e.code==='RPC_CONFIG'&&!e.message.includes('secret'));
});

function separatePools({hold}={}){
 let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 const calls=[],block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};let value=6n,reorg=false,wrongChain=false;
 const pool=role=>createReadPool(['https://'+role+'.invalid'],{clock:()=>200000,fetchImpl:async(url,o)=>{
  const p=JSON.parse(o.body);calls.push({role,method:p.method,params:p.params});
  if(p.method===hold){started();await gate;}
  const result=p.method==='eth_chainId'?(role==='balance'&&wrongChain?'0x61':'0x38'):p.method==='eth_getBlockByNumber'?{...block,hash:role==='balance'&&reorg&&p.params[0]!=='latest'?'0x'+'cd'.repeat(32):block.hash}:p.method==='eth_getBalance'?ethersQuantity(++value):'0x';
  return new Response(JSON.stringify({jsonrpc:'2.0',id:p.id,result}));
 }});
 const quotePool=pool('quote'),balancePool=pool('balance');
 const engine=createEngine(quotePool,{balancePool,clock:()=>200000,readConfig:async r=>{await r({method:'eth_call',params:[{to:a},'latest']});return{version:'1.11'};},
  readPolicy:async()=>({checkedAt:200000,assertFresh(){}}),calculate:async()=>({out:1n}),
  readBalances:async r=>({balances:{[b]:BigInt(await r({method:'eth_getBalance',params:[a,'latest']}))},failed:[]})});
 return{engine,quotePool,balancePool,calls,entered,release,setReorg:()=>{reorg=true;},setWrongChain:()=>{wrongChain=true;}};
}
const ethersQuantity=value=>'0x'+value.toString(16);
test('a busy quote transport leaves balance reads and balance scoring on their own pool',async t=>{
 const f=separatePools({hold:'eth_call'}),quoting=f.engine.quote(input);t.after(f.release);quoting.catch(()=>{});await f.entered;
 const result=await f.engine.balances({chainId:56,account:a,tokens:[b]});
 assert.equal(result.balances[b],'7');assert.equal(f.quotePool.health().active,1);assert.equal(f.balancePool.health().active,0);
 assert.equal(f.calls.some(c=>c.role==='balance'&&c.method==='eth_getBalance'),true);
 assert.equal(f.calls.some(c=>c.role==='quote'&&c.method==='eth_getBalance'),false);
 f.release();await quoting;
});
test('a busy balance transport does not occupy quote transport capacity or measurements',async t=>{
 const f=separatePools({hold:'eth_getBalance'}),reading=f.engine.balances({chainId:56,account:a,tokens:[b]});t.after(f.release);reading.catch(()=>{});await f.entered;
 assert.equal(f.balancePool.health().active,1);assert.equal(f.quotePool.health().active,0);
 assert.equal((await f.engine.quote(input)).quote.out,1n);
 assert.equal(f.quotePool.health().providers[0].operations.balances,undefined);
 f.release();await reading;
});
test('dedicated balance reads remain fresh, pinned, chain-checked and canonical-checked',async()=>{
 const f=separatePools(),body={chainId:56,account:a,tokens:[b]};
 assert.equal((await f.engine.balances(body)).balances[b],'7');assert.equal((await f.engine.balances(body)).balances[b],'8');
 assert.ok(f.calls.filter(c=>c.method==='eth_getBalance').every(c=>c.role==='balance'&&c.params[1]==='0x20'));
 f.setReorg();await assert.rejects(f.engine.balances(body),{code:'STALE_BLOCK'});
 const wrong=separatePools();wrong.setWrongChain();await assert.rejects(wrong.engine.balances(body),{code:'WRONG_CHAIN'});
});

test('health preserves quote readiness and reports independent balance role health',async t=>{
 const quoteHealth={active:2,providers:[{id:'upstream-1',ready:false}]},balanceHealth={active:1,providers:[{id:'upstream-1',ready:true}]};
 const server=createApi({engine:{},pool:{health:()=>quoteHealth},balancePool:{health:()=>balanceHealth}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const body=await(await fetch('http://127.0.0.1:'+server.address().port+'/api/swap/health')).json();
 assert.deepEqual(body.pool,quoteHealth);assert.equal(body.ready,false);assert.deepEqual(body.balancePool,balanceHealth);
 assert.deepEqual(body.roles,{quote:'pool',balances:'balancePool',shared:false});assert.deepEqual(body.activeByRole,{quote:0,balances:0});
});

test('four pending balance requests reserve HTTP capacity for a quote',async t=>{
 let release,entered,count=0;const gate=new Promise(r=>release=r),full=new Promise(r=>entered=r);
 const server=createApi({pool:{health:()=>({providers:[]})},engine:{balances:async()=>{if(++count===4)entered();await gate;return{};},quote:async()=>({})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release();server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port+'/api/swap/',send=(action,signal)=>fetch(base+action,{method:'POST',headers:{'content-type':'application/json'},signal,body:JSON.stringify(action==='quote'?input:{chainId:56,account:a,tokens:[b]})});
 const pending=Array.from({length:4},()=>send('balances'));await full;
 assert.equal((await send('balances',AbortSignal.timeout(200)).catch(()=>({status:'timed out'}))).status,503);assert.equal((await send('quote')).status,200);
 release();await Promise.all(pending);
});
test('eight pending quotes reserve HTTP capacity for a balance read',async t=>{
 let release,entered,count=0;const gate=new Promise(r=>release=r),full=new Promise(r=>entered=r);
 const server=createApi({pool:{health:()=>({providers:[]})},engine:{quote:async()=>{if(++count===8)entered();await gate;return{};},balances:async()=>({})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release();server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port+'/api/swap/',send=(action,signal)=>fetch(base+action,{method:'POST',headers:{'content-type':'application/json'},signal,body:JSON.stringify(action==='quote'?input:{chainId:56,account:a,tokens:[b]})});
 const pending=Array.from({length:8},()=>send('quote'));await full;
 assert.equal((await send('quote',AbortSignal.timeout(200)).catch(()=>({status:'timed out'}))).status,503);assert.equal((await send('balances')).status,200);
 release();await Promise.all(pending);
});

test('production probes alternate roles, never overlap, and keep balance availability independent of quote busy state',async()=>{
 const calls=[],intervals=[];let quoteBusy=false;
 const pool={probe:async options=>{calls.push({role:'quote',...options});}},balancePool={probe:async options=>calls.push({role:'balances',...options})};
 const scheduler=service.createProbeScheduler({pool,balancePool,engine:{isBusy:()=>quoteBusy},timers:{setInterval(fn,ms){intervals.push({fn,ms});return{unref(){}};},clearInterval(){}}});
 await scheduler.initial();assert.deepEqual(calls.map(c=>c.role),['quote','balances']);
 scheduler.start();assert.equal(intervals[0].ms,15500);
 await scheduler.tick();quoteBusy=true;await scheduler.tick();
 assert.deepEqual(calls.map(c=>c.role),['quote','balances','quote','balances']);assert.equal(calls.at(-1).busy,false);
 scheduler.stop();await scheduler.tick();assert.equal(calls.length,4);
});
test('an active role probe blocks overlapping timer and startup probe rounds',async()=>{
 let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),calls=[];
 const scheduler=service.createProbeScheduler({pool:{probe:async()=>{calls.push('quote');started();await gate;}},balancePool:{probe:async()=>calls.push('balances')}});
 const first=scheduler.tick();await entered;assert.equal(await scheduler.tick(),false);assert.equal(await scheduler.initial(),false);assert.deepEqual(calls,['quote']);
 release();await first;await scheduler.tick();assert.deepEqual(calls,['quote','balances']);scheduler.stop();
});
test('shutdown cancels the active probe and a shared legacy pool is probed only once at startup',async()=>{
 const controller=new AbortController();let started,signal;const entered=new Promise(r=>started=r);
 const pool={probe:options=>{signal=options.signal;started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}};
 const scheduler=service.createProbeScheduler({pool,engine:{isBusy:()=>false},signal:controller.signal});
 const initial=scheduler.initial();await entered;controller.abort();await initial;assert.equal(signal.aborted,true);scheduler.stop();
 let count=0;const shared=service.createProbeScheduler({pool:{probe:async()=>{count++;}}});await shared.initial();assert.equal(count,1);shared.stop();
});
test('custom lower global HTTP limits still apply across both roles',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),full=new Promise(r=>entered=r);
 const server=createApi({pool:{health:()=>({providers:[]})},maxActive:1,engine:{quote:async()=>{entered();await gate;return{};},balances:async()=>({})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release();server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port+'/api/swap/',options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)};
 const pending=fetch(base+'quote',options);await full;
 assert.equal((await fetch(base+'balances',{...options,body:JSON.stringify({chainId:56,account:a,tokens:[b]})})).status,503);
 const health=await(await fetch(base+'health')).json();assert.equal(health.active,1);assert.deepEqual(health.activeByRole,{quote:1,balances:0});
 release();await pending;
});
