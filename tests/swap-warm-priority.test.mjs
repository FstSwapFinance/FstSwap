import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../server/fstswap-service.mjs';

const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),C='0x'+'33'.repeat(20),D='0x'+'44'.repeat(20);
const input={chainId:56,tokenIn:A,tokenOut:B,amountIn:'100',slippageBps:50,singleHop:false};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;return{promise:new Promise(r=>resolve=r),release:()=>resolve()};};
function fixture(t,{policy,calculate,warmup}={}){
 let now=200000,node='one',number=0;
 const headers=new Map(),calls=[],runs=[],policies=[],calculations=[];
 const canonicalFailures=new Set();
 const request=async p=>{
  calls.push(p);
  if(p.method==='eth_getBlockByNumber'){
   if(p.params[0]==='latest'){
    const block={number:'0x'+(++number).toString(16),hash:'0x'+number.toString(16).padStart(64,'0'),timestamp:'0x'+Math.floor(now/1000).toString(16)};
    headers.set(block.number,block);return{...block};
   }
   const block=headers.get(p.params[0]);return{...block,hash:canonicalFailures.has(p.params[0])?'0x'+'ff'.repeat(32):block.hash};
  }
  return'0x';
 };
 const pool={run:(fn,signal,options={})=>{runs.push({signal,options});return Promise.resolve().then(()=>fn(request,{id:options.nodeId||node},signal));}};
 const engine=createEngine(pool,{clock:()=>now,warmup:{pairs:[input],...warmup},
  readConfig:async(_read,{block})=>({version:'2.1.0',block}),
  readPolicy:async(read,options)=>{const item={...options,index:policies.length};policies.push(item);await policy?.(item);return{checkedAt:now,assertFresh(){}};},
  calculate:async(_read,trade,config,policy,options)=>{const item={trade,config,policy,...options,index:calculations.length};calculations.push(item);await calculate?.(item);return{out:BigInt(trade.amountIn),poolCheckedAt:policy.checkedAt};},
 });
 t.after(()=>engine.stopWarmup());
 return{engine,calls,runs,policies,calculations,advance:ms=>now+=ms,setNode:id=>node=id,failCanonical:number=>canonicalFailures.add(number),latest:()=>calls.filter(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='latest').length};
}

test('an unrelated foreground quote cancels the already running default warm',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===0){started.release();await pending.promise;}}});
 const warming=f.engine.warmupOnce();await started.promise;
 const q=await f.engine.quote({...input,tokenOut:C});assert.equal(q.quote.out,100n);
 assert.equal(f.runs[0].signal.aborted,true);
 assert.equal(await warming,false);pending.release();
});

test('a due warm starts no background work while one foreground quote is running',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{calculate:async()=>{started.release();await pending.promise;}});
 const q=f.engine.quote({...input,tokenOut:C});await started.promise;
 assert.equal(await f.engine.warmupOnce(),false);
 assert.deepEqual(f.policies.map(p=>[p.tokenIn,p.tokenOut]),[[A,C]]);
 pending.release();await q;
});

test('the second distinct foreground request cancels the single background warm',async t=>{
 const warmGate=gate(),warmStarted=gate(),quoteGate=gate(),quoteStarted=gate();t.after(()=>{warmGate.release();quoteGate.release();});
 const f=fixture(t,{policy:async item=>{if(item.index===0){warmStarted.release();await warmGate.promise;}},calculate:async()=>{quoteStarted.release();await quoteGate.promise;}});
 const warming=f.engine.warmupOnce();await warmStarted.promise;
 const first=f.engine.quote(input);await turn();
 assert.equal(f.runs[0].signal.aborted,false);
 const second=f.engine.quote({...input,tokenOut:D});await turn();
 assert.equal(f.runs[0].signal.aborted,true);assert.equal(await warming,false);
 quoteGate.release();warmGate.release();await Promise.all([first,second]);
});

test('duplicate same-pair foreground consumers safely share an existing default warm',async t=>{
 const warmGate=gate(),warmStarted=gate(),quoteGate=gate(),quoteStarted=gate();t.after(()=>{warmGate.release();quoteGate.release();});
 const f=fixture(t,{policy:async item=>{if(item.index===0){warmStarted.release();await warmGate.promise;}},calculate:async()=>{quoteStarted.release();await quoteGate.promise;}});
 const warming=f.engine.warmupOnce();await warmStarted.promise;
 const first=f.engine.quote(input),duplicate=f.engine.quote(input);await turn();
 assert.equal(f.runs[0].signal.aborted,false);assert.equal(f.policies.length,1);assert.equal(f.calculations.length,0);
 warmGate.release();await quoteStarted.promise;assert.equal(f.calculations.length,1);
 quoteGate.release();const [a,b]=await Promise.all([first,duplicate]);assert.equal(await warming,true);
 assert.equal(a.blockHash,b.blockHash);assert.equal(a.blockNumber,'0x1');assert.equal(a.expiresAt-a.quote.poolCheckedAt,15000);
 assert.equal(f.calls.filter(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='0x1').length,2,'warm and executable quote both retain canonical checks');
});

test('a partial default warm does not replace the last completed raw snapshot',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===1){started.release();await pending.promise;}}});
 const old=await f.engine.quote(input);f.advance(3000);
 const warming=f.engine.warmupOnce();await started.promise;
 const other=await f.engine.quote({...input,tokenOut:C});
 assert.equal(other.blockHash,old.blockHash);assert.equal(other.expiresAt,old.expiresAt);
 pending.release();assert.equal(await warming,false);
});

test('a failed warm leaves the previous completed raw snapshot available',async t=>{
 const f=fixture(t,{policy:async item=>{if(item.index===1)throw Error('offline');}});
 const old=await f.engine.quote(input);f.advance(3000);assert.equal(await f.engine.warmupOnce(),false);
 const other=await f.engine.quote({...input,tokenOut:C});assert.equal(other.blockHash,old.blockHash);assert.equal(f.latest(),2);
});

test('a reorg in the new warm cannot evict the previous canonical snapshot',async t=>{
 const f=fixture(t,{policy:async item=>{if(item.index===1)f.failCanonical(item.block.number);}});
 const old=await f.engine.quote(input);f.advance(3000);assert.equal(await f.engine.warmupOnce(),false);
 const other=await f.engine.quote({...input,tokenOut:C});assert.equal(other.blockHash,old.blockHash);assert.equal(other.expiresAt,old.expiresAt);
});

test('a cancelled older warm cannot publish after a newer foreground snapshot',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===1){started.release();await pending.promise;}}});
 await f.engine.quote(input);f.advance(3000);const warming=f.engine.warmupOnce();await started.promise;
 f.advance(6000);const fresh=await f.engine.quote({...input,tokenOut:C});pending.release();assert.equal(await warming,false);await turn();
 const next=await f.engine.quote({...input,tokenOut:D});assert.equal(next.blockHash,fresh.blockHash);assert.equal(next.expiresAt,fresh.expiresAt);assert.equal(f.latest(),3);
});

test('an invalid older warm cannot remove a newer foreground snapshot',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===1){started.release();await pending.promise;f.failCanonical(item.block.number);}}});
 await f.engine.quote(input);f.advance(3000);const warming=f.engine.warmupOnce();await started.promise;
 f.advance(6000);const fresh=await f.engine.quote({...input,tokenOut:C});pending.release();assert.equal(await warming,false);
 const next=await f.engine.quote({...input,tokenOut:D});assert.equal(next.blockHash,fresh.blockHash);assert.equal(next.expiresAt,fresh.expiresAt);
});

test('a three-second warm schedule keeps the raw snapshot reuse limit at eight and a half seconds',async t=>{
 const f=fixture(t,{warmup:{intervalMs:3000}});const old=await f.engine.quote(input);f.advance(8400);
 const other=await f.engine.quote({...input,tokenOut:C});assert.equal(other.blockHash,old.blockHash);assert.equal(other.expiresAt,old.expiresAt);assert.equal(other.expiresAt-other.quote.poolCheckedAt,15000);
 f.advance(100);const fresh=await f.engine.quote({...input,tokenOut:D});assert.notEqual(fresh.blockHash,old.blockHash);assert.equal(fresh.expiresAt-fresh.quote.poolCheckedAt,15000);
});

test('a stopped warm cannot publish late policy work after cancellation',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===1){started.release();await pending.promise;}}});
 const old=await f.engine.quote(input);f.advance(3000);const warming=f.engine.warmupOnce();await started.promise;
 f.engine.stopWarmup();assert.equal(await warming,false);pending.release();await turn();
 const other=await f.engine.quote({...input,tokenOut:C});assert.equal(other.blockHash,old.blockHash);
});

test('default background refresh starts every three seconds without starting parallel warm jobs',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===1){started.release();await pending.promise;}}});
 f.engine.startWarmup();await turn();f.advance(3000);t.mock.timers.tick(3000);await turn();
 assert.equal(f.policies.length,2);f.advance(3000);t.mock.timers.tick(3000);await turn();assert.equal(f.policies.length,2);
 pending.release();await turn();
});

test('periodic warm waits until the foreground quote settles before starting a fresh policy',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{calculate:async()=>{started.release();await pending.promise;}});
 f.engine.startWarmup();await turn();
 const quote=f.engine.quote({...input,tokenOut:C});await started.promise;
 f.advance(3000);t.mock.timers.tick(3000);await turn();
 assert.equal(f.policies.length,2);assert.equal(f.latest(),1,'timer cannot start a new header/policy during foreground');
 pending.release();await quote;
 f.advance(3000);t.mock.timers.tick(3000);await turn();
 assert.ok(f.latest()>1,'periodic warm resumes after foreground settles');
});

test('cancelling the last foreground consumer releases warm scheduling without late quote delivery',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{calculate:async()=>{started.release();await pending.promise;}});
 const a=new AbortController(),b=new AbortController();
 const first=f.engine.quote({...input,tokenOut:C},{signal:a.signal});first.catch(()=>{});
 const second=f.engine.quote({...input,tokenOut:C},{signal:b.signal});second.catch(()=>{});
 await started.promise;assert.equal(await f.engine.warmupOnce(),false);
 a.abort();await assert.rejects(first,{code:'REQUEST_ABORTED'});assert.equal(await f.engine.warmupOnce(),false,'remaining subscriber still owns the foreground slot');
 b.abort();await assert.rejects(second,{code:'REQUEST_ABORTED'});await turn();
 assert.equal(await f.engine.warmupOnce(),true);pending.release();await turn();assert.equal(f.engine.isBusy(),false);
});

test('a failed foreground calculation releases warm scheduling and retains later canonical validation',async t=>{
 let fail=true;const f=fixture(t,{calculate:async()=>{if(fail)throw Error('calculation unavailable');}});
 await assert.rejects(f.engine.quote({...input,tokenOut:C}),/calculation unavailable/);assert.equal(f.engine.isBusy(),false);
 assert.equal(await f.engine.warmupOnce(),true);fail=false;
 const quote=await f.engine.quote(input);assert.equal(quote.quote.out,100n);assert.equal(quote.expiresAt-quote.quote.poolCheckedAt,15000);
 f.failCanonical(quote.blockNumber);await assert.rejects(f.engine.quote({...input,amountIn:'101'}),{code:'STALE_BLOCK'});
});

test('same-pair warm from another node is cancelled and cannot supply the foreground context',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===0){started.release();await pending.promise;}}});
 const warming=f.engine.warmupOnce();await started.promise;f.setNode('two');
 const quote=await f.engine.quote(input);assert.equal(await warming,false);assert.equal(f.runs[0].signal.aborted,true);
 assert.equal(f.calculations[0].nodeId,'two');assert.equal(quote.blockNumber,'0x2');pending.release();await turn();
 const next=await f.engine.quote({...input,tokenOut:C});assert.equal(next.blockHash,quote.blockHash,'late node-one policy cannot replace node-two snapshot');
});

test('distinct amounts for the same pair keep the single matching warm alive',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const f=fixture(t,{policy:async item=>{if(item.index===0){started.release();await pending.promise;}}});
 const warming=f.engine.warmupOnce();await started.promise;
 const first=f.engine.quote(input),second=f.engine.quote({...input,amountIn:'101'});await turn();
 assert.equal(f.runs[0].signal.aborted,false);assert.equal(f.policies.length,1);
 pending.release();const [a,b]=await Promise.all([first,second]);assert.equal(await warming,true);
 assert.equal(a.blockHash,b.blockHash);assert.equal(a.quote.out,100n);assert.equal(b.quote.out,101n);
});

test('a matching recent-pair warm is shared after the default pair completed',async t=>{
 const pending=gate(),started=gate();t.after(pending.release);
 const other={...input,tokenOut:C};
 const f=fixture(t,{warmup:{pairs:[input,other]},policy:async item=>{if(item.index===1){started.release();await pending.promise;}}});
 const warming=f.engine.warmupOnce();await started.promise;
 const quote=f.engine.quote(other);await turn();
 assert.equal(f.runs[0].signal.aborted,false);assert.equal(f.policies.length,2);
 pending.release();const q=await quote;assert.equal(await warming,true);assert.equal(q.quote.out,100n);
 assert.equal(q.expiresAt-q.quote.poolCheckedAt,15000);
});
