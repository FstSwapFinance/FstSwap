import test from 'node:test';
import assert from 'node:assert/strict';
import {recheckSwapQuote} from '../src/swap-preflight.mjs';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),C='0x'+'33'.repeat(20);
const config=()=>({version:'2.0.0',feeConfigVersion:5n,platformFeeBps:30,defaultFeeToken:A,feeReceiver:B,wbnb:C,adaptersOff:[]});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function fixture(){
 const quoted=config(),fresh=config(),q={kind:'fstswap',serviceMeta:{config:quoted}};
 const configGate=deferred(),policyGate=deferred(),calls=[];
 const policy={assertFresh(){calls.push('fresh');}};
 const options={quote:q,readConfig:async()=>{calls.push('config');await configGate.promise;return fresh;},readPolicy:async c=>{calls.push('policy');await policyGate.promise;return policy;}};
 return{q,quoted,fresh,calls,policy,options,configGate,policyGate};
}
test('remote route checks start together and both must finish before submission can continue',async()=>{
 const f=fixture();let completed=false;const run=recheckSwapQuote(f.options).then(r=>{completed=true;return r;});
 await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,['config','policy']);
 f.policyGate.resolve();await new Promise(r=>setImmediate(r));assert.equal(completed,false);
 f.configGate.resolve();const result=await run;assert.equal(result.config,f.fresh);assert.equal(result.policy,f.policy);assert.deepEqual(f.calls,['config','policy','fresh']);
});
test('every fee, deployment or adapter configuration change rejects the provisional route',async()=>{
 for(const change of [c=>{c.version='1.11';},c=>{c.feeConfigVersion=6n;},c=>{c.platformFeeBps=31;},c=>{c.defaultFeeToken=B;},c=>{c.feeReceiver=A;},c=>{c.wbnb=A;},c=>{c.adaptersOff=['fst'];}]){
  const f=fixture();change(f.fresh);const run=recheckSwapQuote(f.options);f.configGate.resolve();f.policyGate.resolve();await assert.rejects(run,{code:'UNSAFE_QUOTE'});
 }
});
test('address casing and adapter ordering do not falsely invalidate equal chain configuration',async()=>{
 const f=fixture();f.quoted.adaptersOff=['fst','pancake'];f.fresh.adaptersOff=['pancake','fst'];f.fresh.defaultFeeToken=A.toUpperCase().replace('0X','0x');
 const run=recheckSwapQuote(f.options);f.configGate.resolve();f.policyGate.resolve();assert.equal((await run).policy,f.policy);
});
test('native BNB remains a valid default fee asset when both configurations agree',async()=>{
 const f=fixture();f.quoted.defaultFeeToken=f.fresh.defaultFeeToken='0x'+'00'.repeat(20);
 const run=recheckSwapQuote(f.options);f.configGate.resolve();f.policyGate.resolve();assert.equal((await run).policy,f.policy);
});
test('malformed or duplicate adapter identities are rejected instead of becoming trusted provisional data',async()=>{
 for(const list of [['fst','fst'],['unregistered'],[{}]]){
  const f=fixture();f.quoted.adaptersOff=list;f.fresh.adaptersOff=list;
  const run=recheckSwapQuote(f.options);f.configGate.resolve();f.policyGate.resolve();await assert.rejects(run,{code:'UNSAFE_QUOTE'});
 }
});
test('local quotes read chain configuration first and cannot reuse an unverified provisional value',async()=>{
 const f=fixture();delete f.q.serviceMeta;
 const run=recheckSwapQuote(f.options);await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,['config']);
 f.configGate.resolve();await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,['config','policy']);
 f.policyGate.resolve();assert.equal((await run).config,f.fresh);
});
test('a chain read failure or stale policy prevents continuation',async()=>{
 const f=fixture();f.options.readConfig=async()=>{throw Error('chain unavailable');};f.policyGate.resolve();await assert.rejects(recheckSwapQuote(f.options),/chain unavailable/);
 const g=fixture();g.policy.assertFresh=()=>{throw Error('expired');};const run=recheckSwapQuote(g.options);g.configGate.resolve();g.policyGate.resolve();await assert.rejects(run,/expired/);
});
