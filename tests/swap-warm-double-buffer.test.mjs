import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../server/fstswap-service.mjs';

const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20);
const input={chainId:56,tokenIn:A,tokenOut:B,amountIn:'100',slippageBps:50,singleHop:false};
const gate=()=>{let release;return{promise:new Promise(resolve=>release=resolve),release};};
const flush=async()=>{for(let n=0;n<100;n++)await Promise.resolve();};
const observe=work=>{const state={settled:false};work.then(value=>Object.assign(state,{settled:true,value}),error=>Object.assign(state,{settled:true,error}));return state;};
function fixture(t){
 let now=1800000000000,nodeId='one',sequence=0,held,oracleExpiry=Infinity;
 const headers=new Map(),reorgs=new Set(),calls=[],policies=[],calculations=[],warmSignals=[];
 const pool={run:async(fn,signal,options={})=>{
  if(signal?.aborted)throw Object.assign(Error('aborted'),{code:'REQUEST_ABORTED'});
  if(options.operation==='warm')warmSignals.push(signal);
  const id=options.nodeId||nodeId;
  const request=async payload=>{
   calls.push({nodeId:id,...payload});
   if(payload.method!=='eth_getBlockByNumber')throw Error('Unexpected RPC');
   if(payload.params[0]==='latest'){
    const block={number:'0x'+(++sequence).toString(16),hash:'0x'+sequence.toString(16).padStart(64,'0'),timestamp:'0x'+Math.floor(now/1000).toString(16)};
    headers.set(block.number,block);return{...block};
   }
   return{...headers.get(payload.params[0]),...(reorgs.has(payload.params[0])?{hash:'0x'+'ff'.repeat(32)}:{})};
  };
  return fn(request,{id},signal);
 }};
 const engine=createEngine(pool,{clock:()=>now,warmup:{pairs:[input]},readConfig:async(_read,{block})=>({version:'2.1.0',block}),
  readPolicy:async(_read,options)=>{
   const policy={...options,index:policies.length,checkedAt:now,assertFresh(){if(policy.index===0&&now>=oracleExpiry)throw Object.assign(Error('Oracle expired'),{code:'POOL_LIQUIDITY',reason:'oracle'});}};
   policies.push(policy);const pending=held;held=null;if(pending){pending.started.release();await pending.promise;if(pending.fail)throw Error('offline');}return policy;
  },calculate:async(_read,trade,_config,policy)=>{const ordinal=calculations.length+1;calculations.push({trade,policy});return{out:BigInt(trade.amountIn)*2n,ordinal,poolCheckedAt:policy.checkedAt};},
 });
 t.after(()=>{engine.stopWarmup();held?.release();});
 return{engine,calls,policies,calculations,warmSignals,advance:ms=>now+=ms,setNode:id=>nodeId=id,reorgBlock:number=>reorgs.add(number),expireOriginalOracleAt:ms=>oracleExpiry=ms,
  holdNextPolicy({fail=false}={}){const pending={...gate(),started:gate(),fail};held=pending;t.after(pending.release);return pending;}};
}

test('same-pair foreground quotes keep the previous valid completed policy while a new warm is pending',async t=>{
 const f=fixture(t);assert.equal(await f.engine.warmupOnce(),true);const old=f.policies[0].block;
 f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 const quote=f.engine.quote({...input,amountIn:'101'}),state=observe(quote);await flush();
 assert.equal(state.settled,true,'a new warm must not add its policy latency to a still-valid foreground context');
 assert.equal(state.error,undefined);assert.equal(state.value.blockHash,old.hash);assert.equal(f.policies.length,2);assert.equal(f.calculations.length,1);
 assert.equal(state.value.expiresAt-state.value.quote.poolCheckedAt,15000);assert.equal(f.warmSignals[0].aborted,false);
 pending.release();assert.equal(await warm,true);const current=await f.engine.quote({...input,amountIn:'102'});assert.notEqual(current.blockHash,old.hash);assert.equal(f.policies.length,2);
});

test('a pending refresh does not hide a two-second completed quote or renew its original timestamps',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(2900);const first=await f.engine.quote(input);
 f.advance(100);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 const before=f.calls.length,state=observe(f.engine.quote(input));await flush();
 assert.equal(state.settled,true,'completed quote cache remains usable during unrelated refresh work');assert.equal(state.error,undefined);
 assert.equal(state.value.quotedAt,first.quotedAt);assert.equal(state.value.expiresAt,first.expiresAt);assert.equal(state.value.quote.poolCheckedAt,first.quote.poolCheckedAt);assert.equal(f.calculations.length,1);
 assert.deepEqual(f.calls.slice(before),[{nodeId:'one',method:'eth_getBlockByNumber',params:[first.blockNumber,false]}]);
 f.advance(1900);await f.engine.quote(input);assert.equal(f.calculations.length,2,'the original completion window still ends at exactly two seconds');
 pending.release();await warm;
});

test('canceling the pending warm leaves its previous completed context available without rebuilding policy',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 f.engine.stopWarmup();assert.equal(await warm,false);pending.release();await flush();
 const quote=await f.engine.quote(input);assert.equal(quote.blockNumber,'0x1');assert.equal(f.policies.length,2,'canceled refresh cannot evict the old completed context');
});

test('a failed warm leaves the completed context available rather than forcing duplicate policy reads',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy({fail:true}),warm=f.engine.warmupOnce();await pending.started.promise;
 pending.release();assert.equal(await warm,false);const quote=await f.engine.quote(input);
 assert.equal(quote.blockNumber,'0x1');assert.equal(f.policies.length,2,'a failed refresh must retain the previous completed context');
});

test('foreground reuse still ends at the original 5.5-second completed warm window',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 f.advance(2499);const allowed=observe(f.engine.quote({...input,amountIn:'101'}));await flush();assert.equal(allowed.settled,true);assert.equal(allowed.value.blockNumber,'0x1');
 f.advance(1);const expired=observe(f.engine.quote({...input,amountIn:'102'}));await flush();assert.equal(expired.settled,false,'at 5500 ms foreground must wait for the replacement, not extend the old policy window');
 pending.release();assert.equal(await warm,true);await flush();assert.equal(expired.settled,true);assert.equal(expired.value.blockNumber,'0x2');assert.equal(expired.value.expiresAt-expired.value.quote.poolCheckedAt,15000);
});

test('fresh quote requests still calculate independently while reusing only a valid prepared context',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(2900);const ordinary=await f.engine.quote(input);
 f.advance(100);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 const one=observe(f.engine.quote(input,{fresh:true})),two=observe(f.engine.quote(input,{fresh:true}));await flush();
 assert.equal(one.settled,true);assert.equal(two.settled,true);assert.notEqual(one.value.quote.ordinal,two.value.quote.ordinal);assert.equal(f.calculations.length,3);
 const cached=await f.engine.quote(input);assert.equal(cached.quote.ordinal,ordinary.quote.ordinal,'fresh calls must not replace normal completed cache');
 pending.release();await warm;
});

test('an expired oracle in the retained policy rejects without waiting for or trusting a future warm result',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 f.expireOriginalOracleAt(1800000003500);f.advance(600);const state=observe(f.engine.quote(input));await flush();
 assert.equal(state.settled,true);assert.equal(state.error?.code,'POOL_LIQUIDITY');assert.equal(state.error?.reason,'oracle');assert.equal(f.calculations.length,0);
 pending.release();await warm;
});

test('a foreground attempt on another node cannot consume the retained context from the warmed node',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 f.setNode('two');const quote=await f.engine.quote(input);assert.equal(quote.blockNumber,'0x3');assert.equal(f.calculations[0].policy.nodeId,'two');assert.equal(f.policies.length,3);
 pending.release();assert.equal(await warm,false);
});

test('first warm without a previous completed policy still shares pending work with matching foreground requests',async t=>{
 const f=fixture(t),pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 const state=observe(f.engine.quote(input));await flush();assert.equal(state.settled,false);assert.equal(f.policies.length,1);
 pending.release();assert.equal(await warm,true);await flush();assert.equal(state.settled,true);assert.equal(state.value.blockNumber,'0x1');assert.equal(f.policies.length,1);
});

test('a canceled warm whose upstream ignores abort cannot replace a later foreground context',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 f.engine.stopWarmup();assert.equal(await warm,false);f.advance(6000);
 const current=await f.engine.quote({...input,amountIn:'101'});assert.equal(current.blockNumber,'0x3');
 pending.release();await flush();
 const next=await f.engine.quote({...input,amountIn:'102'});assert.equal(next.blockNumber,current.blockNumber);assert.equal(next.blockHash,current.blockHash);assert.equal(f.policies.length,3,'late abandoned work must neither publish nor force a later policy rebuild');
 assert.equal(f.calculations.at(-1).policy.index,2);
});

test('a reorg of the retained context during refresh still rejects its final canonical check',async t=>{
 const f=fixture(t);await f.engine.warmupOnce();f.advance(3000);const pending=f.holdNextPolicy(),warm=f.engine.warmupOnce();await pending.started.promise;
 f.reorgBlock('0x1');const stale=observe(f.engine.quote({...input,amountIn:'101'}));await flush();
 assert.equal(stale.settled,true);assert.equal(stale.error?.code,'STALE_BLOCK','old context is only reusable when its original hash remains canonical');
 const replacement=observe(f.engine.quote({...input,amountIn:'102'}));await flush();assert.equal(replacement.settled,false,'the invalidated old snapshot cannot satisfy another request');
 pending.release();assert.equal(await warm,true);await flush();assert.equal(replacement.settled,true);assert.equal(replacement.error,undefined);assert.equal(replacement.value.blockNumber,'0x2');
 assert.equal(replacement.value.expiresAt-replacement.value.quote.poolCheckedAt,15000);
});
