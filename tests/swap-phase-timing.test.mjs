import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimingScope,measurePhase,countTiming} from '../server/swap-timing.mjs';

const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
test('disabled timing preserves synchronous values and exact thrown errors',()=>{
 const value={ok:true},error=Error('original');
 assert.equal(measurePhase('route',()=>value),value);
 assert.throws(()=>measurePhase('route',()=>{throw error;}),e=>e===error);
});
test('timing retains synchronous return types and records failed work without replacing errors',()=>{
 let now=10;const scope=createTimingScope({clock:()=>now}),value={ok:true},failure=Error('failure');
 scope.run(()=>{
  assert.equal(measurePhase('config',()=>{now=14;return value;}),value);
  assert.throws(()=>measurePhase('policy',()=>{now=21;throw failure;}),error=>error===failure);
 });
 assert.deepEqual(scope.snapshot().durations,{config:4,policy:7});
});
test('parallel request scopes isolate timings and counters after asynchronous work',async()=>{
 let oneTime=0,twoTime=0;const one=createTimingScope({clock:()=>oneTime}),two=createTimingScope({clock:()=>twoTime}),gate=deferred();
 await Promise.all([
  one.run(()=>measurePhase('route',async()=>{await gate.promise;oneTime=11;countTiming('rpc_calls',3);return 1;})),
  two.run(()=>measurePhase('policy',async()=>{twoTime=7;countTiming('rpc_calls',1);gate.resolve();return 2;})),
 ]);
 assert.deepEqual(one.snapshot(),{durations:{route:11},counts:{rpc_calls:3}});
 assert.deepEqual(two.snapshot(),{durations:{policy:7},counts:{rpc_calls:1}});
});
test('nested parallel phase work may overlap and is never reported as a disjoint total',async()=>{
 let now=0;const scope=createTimingScope({clock:()=>now});
 await scope.run(()=>measurePhase('context',async()=>{await Promise.all([measurePhase('policy',async()=>{now=5;}),measurePhase('config',async()=>{now=8;})]);now=10;}));
 assert.equal(scope.snapshot().durations.context,10);
 assert.ok(scope.snapshot().durations.policy>0&&scope.snapshot().durations.config>=0);
 assert.match(scope.header(10),/^total;dur=10\.0/);
});
test('untrusted phase names, counters, and invalid measurements cannot enter public headers',()=>{
 let now=10;const scope=createTimingScope({clock:()=>now});
 scope.run(()=>{
  measurePhase('https://secret.invalid\r\nX-Key: token',()=>{now=20;});
  countTiming('https://private.invalid',42);countTiming('rpc_calls',-1);countTiming('rpc_calls',Infinity);countTiming('rpc_calls',1.5);
  countTiming('rpc_calls',2);measurePhase('config',()=>{now=NaN;});
 });
 const header=scope.header(25);
 assert.match(header,/rpc_calls;desc="2"/);assert.doesNotMatch(header,/secret|private|X-Key|NaN|Infinity|\r|\n/);
});
test('formatting the header seals timing so ignored late work cannot change a completed response',async()=>{
 let now=0;const scope=createTimingScope({clock:()=>now}),gate=deferred();
 const work=scope.run(()=>measurePhase('rpc',async()=>{await gate.promise;now=30;countTiming('rpc_calls');}));
 const header=scope.header(5),snapshot=scope.snapshot();gate.resolve();await work;
 assert.equal(scope.header(5),header);assert.deepEqual(scope.snapshot(),snapshot);
});
test('a throwing diagnostic clock cannot change business work or its original error',()=>{
 const scope=createTimingScope({clock:()=>{throw Error('diagnostic clock');}}),failure=Error('business error');
 scope.run(()=>{assert.equal(measurePhase('route',()=>17),17);assert.throws(()=>measurePhase('route',()=>{throw failure;}),error=>error===failure);});
 assert.doesNotThrow(()=>scope.header(5));
});
