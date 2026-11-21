import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../server/fstswap-service.mjs';

const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),H1='0x'+'ab'.repeat(32),H2='0x'+'cd'.repeat(32);
const input={chainId:56,tokenIn:A,tokenOut:B,amountIn:'100',slippageBps:50,singleHop:false};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const flush=async()=>{for(let n=0;n<80;n++)await Promise.resolve();};
function fixture(t){
 let now=1800000000000,hash=H1,oracleExpiry=Infinity,cacheHeader,calculationGate,canonicalGate;
 const calls=[],runs=[],calculations=[],policies=[];
 const header=()=>({number:'0x100',hash,timestamp:'0x'+Math.floor(now/1000).toString(16)});
 const request=async payload=>{calls.push(payload);if(payload.method!=='eth_getBlockByNumber')throw Error('Unexpected '+payload.method);
  if(payload.params[0]!=='latest'&&canonicalGate){const gate=canonicalGate;canonicalGate=null;await gate.promise;}
  return payload.params[0]==='latest'||cacheHeader===undefined?header():cacheHeader;
 };
 const pool={run:async(fn,signal,options={})=>{runs.push(options);if(signal?.aborted)throw Object.assign(Error('aborted'),{code:'REQUEST_ABORTED'});return fn(request,{id:options.nodeId||'one'},signal);}};
 const engine=createEngine(pool,{clock:()=>now,warmup:{enabled:false},readConfig:async()=>({version:'2.1.0',marker:7}),
  readPolicy:async()=>{const p={checkedAt:now,pools:new Map(),assertFresh(){if(now>=oracleExpiry)throw Object.assign(Error('expired oracle'),{code:'POOL_LIQUIDITY',reason:'oracle',retryable:true});},assertValue(){}};policies.push(p);return p;},
  calculate:async(_r,trade,_c,p,{signal})=>{const ordinal=calculations.length+1;calculations.push({trade,signal});const gate=calculationGate;calculationGate=null;if(gate)await gate.promise;return{out:BigInt(trade.amountIn)*2n,ordinal,poolCheckedAt:p.checkedAt};},
 });
 t.after(()=>engine.stopWarmup());
 return{engine,calls,runs,calculations,policies,advance:n=>now+=n,setHeader:v=>cacheHeader=v,setHash:v=>hash=v,oracleExpiresAt:n=>oracleExpiry=n,
  holdCalculation(){const gate=deferred();calculationGate=gate;return gate;},holdCanonical(){const gate=deferred();canonicalGate=gate;return gate;}};
}
function observed(work){work.catch(()=>{});return work;}
test('a repeated quote reuses the completed result for two seconds while checking the same node and canonical block',async t=>{
 const f=fixture(t),first=await f.engine.quote(input);f.advance(1000);const count=f.calls.length,second=await f.engine.quote(input);
 assert.equal(f.calculations.length,1);assert.equal(second.quotedAt,first.quotedAt);assert.equal(second.quote.poolCheckedAt,first.quote.poolCheckedAt);assert.equal(second.expiresAt,first.expiresAt);
 assert.deepEqual(f.calls.slice(count),[{method:'eth_getBlockByNumber',params:['0x100',false]}]);assert.equal(f.runs.at(-1).nodeId,'one');
 f.advance(999);await f.engine.quote(input);assert.equal(f.calculations.length,1,'a hit must not restart the original two-second completion window');
 f.advance(1);await f.engine.quote(input);assert.equal(f.calculations.length,2);
});
test('the completed cache and every consumer response are isolated from caller mutations',async t=>{
 const f=fixture(t),first=await f.engine.quote(input);first.quote.out=999n;first.config.marker=999;first.input.amountIn='999';
 const second=await f.engine.quote(input);assert.equal(second.quote.out,200n);assert.equal(second.config.marker,7);assert.equal(second.input.amountIn,'100');
 second.quote.out=888n;assert.equal((await f.engine.quote(input)).quote.out,200n);assert.equal(f.calculations.length,1);
});
test('fresh calls each bypass earlier pending or completed work and never replace the ordinary completion cache',async t=>{
 const f=fixture(t),first=await f.engine.quote(input),gate=f.holdCalculation();
 const fresh=observed(f.engine.quote(input,{fresh:true}));await flush();const another=observed(f.engine.quote(input,{fresh:true}));await flush();
 assert.equal(f.calculations.length,3,'every fresh call must own an independent calculation');assert.equal((await another).quote.ordinal,3);
 gate.resolve();assert.equal((await fresh).quote.ordinal,2);const ordinary=await f.engine.quote(input);assert.equal(ordinary.quote.ordinal,first.quote.ordinal);assert.equal(f.calculations.length,3);
});
test('a changed canonical hash discards the completion and recomputes a new snapshot instead of returning old output',async t=>{
 const f=fixture(t),first=await f.engine.quote(input);f.setHash(H2);
 const second=await f.engine.quote(input);assert.equal(second.blockHash,H2);assert.notEqual(second.blockHash,first.blockHash);assert.equal(f.calculations.length,2);assert.equal(f.policies.length,2);
});
test('null or malformed canonical headers cannot satisfy a completed quote hit',async t=>{
 for(const header of[null,{number:'0x100',hash:H1,timestamp:'bad'}, {number:'0x101',hash:H1,timestamp:'0x6b49d200'}]){
  const f=fixture(t);await f.engine.quote(input);f.setHeader(header);
  await assert.rejects(f.engine.quote(input));assert.ok(f.calculations.length>=1);
 }
});
test('a completion hit preserves the oracle expiry, even inside the two-second and fifteen-second windows',async t=>{
 const f=fixture(t);await f.engine.quote(input);f.oracleExpiresAt(1800000000500);f.advance(600);
 await assert.rejects(f.engine.quote(input),{code:'POOL_LIQUIDITY',reason:'oracle'});
});
test('a delayed canonical hit cannot outlive either the completion window or original quote expiry',async t=>{
 for(const elapsed of[2000,15000]){
  const f=fixture(t),first=await f.engine.quote(input),gate=f.holdCanonical(),pending=observed(f.engine.quote(input));await flush();
  f.advance(elapsed);gate.resolve();const current=await pending;
  assert.equal(f.calculations.length,2,'an aged cache validation must run a new calculation');assert.equal(current.quote.ordinal,2);assert.ok(current.quotedAt>first.quotedAt);assert.ok(current.expiresAt>current.quotedAt);assert.equal(first.expiresAt,1800000015000);
 }
});
test('canceling one joined cache validation leaves other consumers alive and canceled late work is not cached',async t=>{
 const f=fixture(t);await f.engine.quote(input);const gate=f.holdCanonical(),controller=new AbortController();
 const one=observed(f.engine.quote(input,{signal:controller.signal})),rejected=assert.rejects(one,{code:'REQUEST_ABORTED'});await flush();
 const two=observed(f.engine.quote(input));controller.abort();await rejected;gate.resolve();assert.equal((await two).quote.out,200n);assert.equal(f.calculations.length,1);
 f.advance(2000);const lateGate=f.holdCalculation(),aborted=new AbortController(),late=observed(f.engine.quote(input,{signal:aborted.signal})),lateRejected=assert.rejects(late,{code:'REQUEST_ABORTED'});await flush();
 aborted.abort();await lateRejected;lateGate.resolve();await flush();await f.engine.quote(input);assert.equal(f.calculations.length,3,'an abandoned computation must not publish a completion');
});
test('completed quote storage evicts beyond thirty-two full input identities',async t=>{
 const f=fixture(t);for(let n=100;n<133;n++)await f.engine.quote({...input,amountIn:String(n)});
 assert.equal(f.calculations.length,33);await f.engine.quote({...input,amountIn:'132'});assert.equal(f.calculations.length,33);await f.engine.quote(input);assert.equal(f.calculations.length,34);
});
