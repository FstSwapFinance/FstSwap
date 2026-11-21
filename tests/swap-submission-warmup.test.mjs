import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubmissionWarmup} from '../src/swap-submission-warmup.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
function fixture(){let now=1000;const identity={quote:{},provider:{},providerRequest(){},key:'exact transaction + settings',expiresAt:10000};return{identity,warm:createSubmissionWarmup({clock:()=>now}),advance:ms=>now+=ms};}
test('only a completed matching preparation can be consumed, once',async()=>{
 const f=fixture(),value={gasLimit:60000n,expiresAt:9000};
 f.warm.start(f.identity,async()=>value);assert.equal(f.warm.pending(),true);await tick();assert.equal(f.warm.pending(),false);
 assert.equal(f.warm.take(f.identity,()=>true),value);assert.equal(f.warm.take(f.identity,()=>true),null);
});
test('clicking during prefetch cancels it instead of waiting or publishing its late result',async()=>{
 const f=fixture(),gate=deferred();let signal;
 f.warm.start(f.identity,async options=>{signal=options.signal;await gate.promise;return{};});await tick();
 assert.equal(f.warm.take(f.identity,()=>true),null);assert.equal(signal.aborted,true);gate.resolve();await tick();assert.equal(f.warm.take(f.identity,()=>true),null);
});
test('quote, provider, request function and full identity changes reject stale preparation',async()=>{
 for(const change of [identity=>({...identity,quote:{}}),identity=>({...identity,provider:{}}),identity=>({...identity,providerRequest(){}}),identity=>({...identity,key:'different bytes or settings'})]){
  const f=fixture();f.warm.start(f.identity,async()=>({}));await tick();assert.equal(f.warm.take(change(f.identity),()=>true),null);
 }
});
test('completion TTL cannot extend the original quote or policy expiration',async()=>{
 for(const {expiry,age}of[{expiry:10000,age:2000},{expiry:1500,age:500}]){
  const f=fixture();f.warm.start(f.identity,async()=>({expiresAt:expiry}));await tick();f.advance(age);assert.equal(f.warm.take(f.identity,()=>true),null);
 }
 const f=fixture();f.warm.start({...f.identity,expiresAt:1400},async()=>({expiresAt:9000}));await tick();f.advance(400);assert.equal(f.warm.take(f.identity,()=>true),null);
});
test('repeating the same schedule does not renew a completed result',async()=>{
 const f=fixture();let calls=0;const build=async()=>{calls++;return{};};
 f.warm.start(f.identity,build);await tick();f.advance(1500);f.warm.start(f.identity,build);await tick();f.advance(500);
 assert.equal(f.warm.take(f.identity,()=>true),null);assert.equal(calls,1);
});
test('the same identity may rebuild after expiry without reviving the previous value',async()=>{
 const f=fixture(),first={gasLimit:60000n},second={gasLimit:70000n};let builds=0;
 f.warm.start(f.identity,async()=>{builds++;return first;});await tick();f.advance(2000);
 assert.equal(f.warm.start(f.identity,async()=>{builds++;return second;}),true);await tick();
 assert.equal(builds,2);assert.equal(f.warm.take(f.identity,()=>true),second);
});
test('an expired rebuild failure cannot restore or extend the old preparation',async()=>{
 const f=fixture();f.warm.start(f.identity,async()=>({}));await tick();f.advance(2001);
 assert.equal(f.warm.start(f.identity,async()=>{throw Error('offline');}),true);await tick();assert.equal(f.warm.take(f.identity,()=>true),null);
});
test('a rebuilt result still expires at the unchanged original quote deadline',async()=>{
 const f=fixture();f.identity.expiresAt=3500;f.warm.start(f.identity,async()=>({expiresAt:9000}));await tick();f.advance(2000);
 assert.equal(f.warm.start(f.identity,async()=>({expiresAt:9000})),true);await tick();f.advance(500);assert.equal(f.warm.take(f.identity,()=>true),null);
});
test('replaced or canceled work cannot overwrite newer preparation',async()=>{
 const f=fixture(),gate=deferred(),newIdentity={...f.identity,key:'new'},newValue={gasLimit:70000n};
 f.warm.start(f.identity,async()=>{await gate.promise;return{gasLimit:60000n};});await tick();f.warm.start(newIdentity,async()=>newValue);await tick();gate.resolve();await tick();assert.equal(f.warm.take(newIdentity,()=>true),newValue);
});
test('a failed or invalidated proof remains a cache miss without surfacing an error',async()=>{
 const f=fixture();f.warm.start(f.identity,async()=>{throw Error('public RPC unavailable');});await tick();assert.equal(f.warm.take(f.identity,()=>true),null);
 f.warm.start(f.identity,async()=>({}));await tick();assert.equal(f.warm.take(f.identity,()=>{throw Error('stale policy');}),null);
});
test('an uncooperative prefetch is bounded and its result has no publication rights',async()=>{
 const identity={quote:{},provider:{},key:'bounded',expiresAt:Date.now()+10000},warm=createSubmissionWarmup({maxRunMs:5}),gate=deferred();let signal;
 warm.start(identity,async options=>{signal=options.signal;await gate.promise;return{};});await new Promise(resolve=>setTimeout(resolve,15));assert.equal(signal.aborted,true);assert.equal(warm.pending(),false);gate.resolve();await tick();assert.equal(warm.take(identity,()=>true),null);
});
test('clock rollback and an already canceled signal prevent consumption or publication',async()=>{
 const f=fixture();f.warm.start(f.identity,async()=>({}));await tick();f.advance(-1);assert.equal(f.warm.take(f.identity,()=>true),null);
 const controller=new AbortController();controller.abort();let called=false;f.warm.start(f.identity,async()=>{called=true;return{};},{signal:controller.signal});await tick();assert.equal(called,false);
});
test('external cancellation also invalidates a completed private preparation',async()=>{
 const f=fixture(),controller=new AbortController();f.warm.start(f.identity,async()=>({}),{signal:controller.signal});await tick();controller.abort();assert.equal(f.warm.take(f.identity,()=>true),null);
});
test('mutating the caller identity cannot extend the original expiry while work is pending',async()=>{
 const f=fixture(),gate=deferred();f.identity.expiresAt=1500;f.warm.start(f.identity,async()=>{await gate.promise;return{};});
 f.identity.expiresAt=9000;gate.resolve();await tick();f.advance(500);assert.equal(f.warm.take(f.identity,()=>true),null);
});
