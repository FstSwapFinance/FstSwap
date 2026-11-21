import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../server/fstswap-service.mjs';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),C='0x'+'33'.repeat(20);
const input={chainId:56,tokenIn:A,tokenOut:B,amountIn:'100',slippageBps:50,singleHop:false};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
function fixture(t,{warmNode='third',frontNodes=['front-1','front-2'],holdForeground=false}={}){
 const warmGate=deferred(),quoteGate=deferred(),frontGate=deferred(),headers=new Map(),policies=[],runs=[],jobs=[];
 let number=0,quotes=0,warmSignal;
 const request=async p=>{
  if(p.method==='eth_getBlockByNumber'){
   if(p.params[0]==='latest'){
    const block={number:'0x'+(++number).toString(16),hash:'0x'+number.toString(16).padStart(64,'0'),timestamp:'0xc8'};
    headers.set(block.number,block);return block;
   }
   return headers.get(p.params[0]);
  }
  return'0x';
 };
 const pool={run(fn,signal,options={}){
  runs.push({signal,options});
  if(options.operation==='warm'&&!options.nodeId&&!warmSignal){warmSignal=signal;return warmGate.promise.then(()=>fn(request,{id:warmNode},signal));}
  const id=options.nodeId||(options.operation==='quote'?frontNodes[quotes++]:'third');
  return (holdForeground&&options.operation==='quote'?frontGate.promise:Promise.resolve()).then(()=>fn(request,{id},signal));
 }};
 const engine=createEngine(pool,{clock:()=>200000,warmup:{pairs:[input]},
  readConfig:async()=>({version:'2.1.0'}),
  readPolicy:async(_read,options)=>{policies.push(options.nodeId);return{checkedAt:200000,assertFresh(){}};},
  calculate:async(_read,trade,_config,policy)=>{await quoteGate.promise;return{out:BigInt(trade.amountIn),poolCheckedAt:policy.checkedAt};},
 });
 t.after(async()=>{engine.stopWarmup();warmGate.resolve();quoteGate.resolve();frontGate.resolve();await Promise.allSettled(jobs);});
 return{engine,policies,runs,warmGate,quoteGate,frontGate,warmSignal:()=>warmSignal,
  warm(){const job=engine.warmupOnce();jobs.push(job);return job;},quote(value=input){const job=engine.quote(value);jobs.push(job);return job;}};
}
test('a warm awaiting node assignment cannot start a third policy behind two foreground nodes',async t=>{
 const f=fixture(t),warm=f.warm();f.quote();f.quote({...input,amountIn:'101'});await turn();
 assert.deepEqual(f.policies,['front-1','front-2']);f.warmGate.resolve();
 assert.equal(await warm,false);assert.equal(f.warmSignal().aborted,true);assert.deepEqual(f.policies,['front-1','front-2']);
});
test('a warm awaiting node assignment cancels if the matching foreground uses another node',async t=>{
 const f=fixture(t),warm=f.warm();f.quote();await turn();f.warmGate.resolve();
 assert.equal(await warm,false);assert.equal(f.warmSignal().aborted,true);assert.deepEqual(f.policies,['front-1']);
});
test('a warm assigned to the same foreground node shares its matching policy safely',async t=>{
 const f=fixture(t,{warmNode:'front-1'}),warm=f.warm();f.quote();await turn();f.warmGate.resolve();
 assert.equal(await warm,true);assert.equal(f.warmSignal().aborted,false);assert.deepEqual(f.policies,['front-1']);
});
test('a pending foreground without a known node conservatively cancels delayed warm discovery',async t=>{
 const f=fixture(t,{holdForeground:true}),warm=f.warm();f.quote();f.warmGate.resolve();
 assert.equal(await warm,false);assert.equal(f.warmSignal().aborted,true);assert.deepEqual(f.policies,[]);
});
test('an unrelated foreground cancellation still blocks an uncooperative late warm callback',async t=>{
 const f=fixture(t),warm=f.warm();f.quote({...input,tokenOut:C});await turn();f.warmGate.resolve();
 assert.equal(await warm,false);assert.equal(f.warmSignal().aborted,true);assert.deepEqual(f.policies,['front-1']);
});
