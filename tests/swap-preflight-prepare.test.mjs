import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSwapSubmission} from '../src/swap-preflight.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(){
 const policy={assertFresh:()=>true};
 return{minimum:100n,check:async()=>({policy}),allowance:async()=>false,simulate:async()=>120n,estimate:async()=>100000n,gasPrice:async()=>5n};
}
test('optional gas reads expire quickly and use existing fallback after hard simulation passes',async()=>{
 const f=fixture(),gas=deferred();let completed=false,estimateSignal,priceSignal;
 f.estimate=({signal})=>{estimateSignal=signal;return gas.promise;};f.gasPrice=({signal})=>{priceSignal=signal;return gas.promise;};
 const run=prepareSwapSubmission({...f,gasTimeoutMs:20}).then(value=>{completed=true;return value;});
 try{await sleep(45);assert.equal(completed,true);const result=await run;assert.equal(result.gasLimit,900000n);assert.equal(result.gasPrice,3000000000n);assert.equal(estimateSignal.aborted,true);assert.equal(priceSignal.aborted,true);}
 finally{gas.resolve(100000n);await run;}
});
test('the gas timeout never shortens the required simulation of a taxed-token swap',async()=>{
 const f=fixture(),simulation=deferred();let completed=false;
 f.simulate=()=>simulation.promise;
 const run=prepareSwapSubmission({...f,gasTimeoutMs:20}).then(value=>{completed=true;return value;});
 await sleep(45);assert.equal(completed,false);simulation.resolve(99n);await assert.rejects(run,{code:'UNSAFE_QUOTE'});
});
test('mandatory preflight failure cancels optional reads without waiting for gas timeouts',async()=>{
 const f=fixture(),gas=deferred();let completed=false,gasSignal;
 f.check=async()=>{throw Object.assign(Error('unsafe pool'),{code:'POOL_LIQUIDITY'});};
 f.estimate=({signal})=>{gasSignal=signal;return gas.promise;};
 const run=prepareSwapSubmission(f).then(()=>{completed=true;return null;},error=>{completed=true;return error;});
 try{await tick();assert.equal(completed,true);assert.equal((await run).code,'POOL_LIQUIDITY');assert.equal(gasSignal.aborted,true);}
 finally{gas.resolve(100000n);await run;}
});
test('insufficient allowance returns to authorization without waiting for a reverting simulation',async()=>{
 const f=fixture(),simulation=deferred();let completed=false,simulationSignal;
 f.allowance=async()=>true;f.simulate=({signal})=>{simulationSignal=signal;return simulation.promise;};
 const run=prepareSwapSubmission(f).then(value=>{completed=true;return value;});
 try{await tick();assert.equal(completed,true);assert.equal((await run).needsApproval,true);assert.equal(simulationSignal.aborted,true);}
 finally{simulation.reject(Error('allowance revert'));await run;}
});
test('successful preparation preserves estimated gas and rejects a stale policy',async()=>{
 const result=await prepareSwapSubmission(fixture());assert.equal(result.gasLimit,130000n);assert.equal(result.gasPrice,5n);assert.equal(result.simulated,120n);
 const f=fixture();f.check=async()=>({policy:{assertFresh(){throw Object.assign(Error('stale'),{code:'POOL_LIQUIDITY'});}}});await assert.rejects(prepareSwapSubmission(f),{code:'POOL_LIQUIDITY'});
});
test('cancellation aborts every read-only branch and does not yield fallback approval',async()=>{
 const f=fixture(),controller=new AbortController(),signals=[],pending=deferred();
 for(const key of ['check','allowance','simulate','estimate','gasPrice'])f[key]=({signal})=>{signals.push(signal);return pending.promise;};
 const run=prepareSwapSubmission({...f,signal:controller.signal});const rejection=assert.rejects(run,{name:'AbortError'});
 await tick();controller.abort();await rejection;assert.equal(signals.length,5);assert.equal(signals.every(signal=>signal.aborted),true);pending.resolve();
});
test('completed gas preparation is not multiplied twice and never replaces mandatory simulation',async()=>{
 const f=fixture();let simulations=0;f.simulate=async()=>{simulations++;return 120n;};
 const result=await prepareSwapSubmission({...f,gasOptions:async()=>({gasLimit:77777n,gasPrice:7n})});assert.equal(result.gasLimit,77777n);assert.equal(result.gasPrice,7n);assert.equal(simulations,1);
});
