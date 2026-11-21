import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {readWalletBalances,invalidateWalletBalances} from '../src/swap-balances.mjs';

globalThis.ethers=ethers;
const owner='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20);
const a={key:'a',address:'0x'+'aa'.repeat(20),decimals:18},b={key:'b',address:'0x'+'bb'.repeat(20),decimals:18};
const bnb={key:'bnb',address:null,decimals:18};
const codec=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function getEthBalance(address) view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
function fixture(){
 let now=10000;const values=new Map(),failed=new Set(),gates=[],calls=[];
 const key=(account,token)=>[account.toLowerCase(),String(token.address||'native').toLowerCase()].join(':');
 const request=async payload=>{
  assert.equal(payload.method,'eth_call');assert.equal(payload.params[1],'latest');
  const items=codec.decodeFunctionData('tryAggregate',payload.params[0].data)[1],addresses=[],rows=items.map(item=>{
   const parsed=codec.parseTransaction({data:item.callData}),token=parsed.name==='getEthBalance'?bnb:{address:item.target};
   addresses.push(token.address?.toLowerCase()||'native');
   return failed.has(key(parsed.args[0],token))?[false,'0x']:[true,codec.encodeFunctionResult(parsed.name,[values.get(key(parsed.args[0],token))??0n])];
  });
  calls.push(addresses);const raw=codec.encodeFunctionResult('tryAggregate',[rows]),gate=gates.shift();if(gate)await gate.promise;return raw;
 };
 return{request,calls,gates,clock:()=>now,setTime:value=>now=value,set:(token,value,account=owner)=>values.set(key(account,token),value),fail:(token,value,account=owner)=>value?failed.add(key(account,token)):failed.delete(key(account,token))};
}
test.beforeEach(()=>invalidateWalletBalances());

test('cancellable page reads reuse completed display values without another RPC',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);
 const result=await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal});
 assert.deepEqual(result,{balances:{a:1n},failed:[]});assert.equal(f.calls.length,1);
});

test('cancellable mixed reads send only cache misses and preserve cached zero balances',async()=>{
 const f=fixture();f.set(a,0n);f.set(b,7n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);
 const result=await readWalletBalances(f.request,owner,[a,b],{clock:f.clock,signal:new AbortController().signal});
 assert.deepEqual(result,{balances:{a:0n,b:7n},failed:[]});assert.deepEqual(f.calls,[[a.address],[b.address]]);
});

test('display cache hits do not restart the five second expiry window',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);
 f.setTime(14999);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,1n);
 f.setTime(15000);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,2n);assert.equal(f.calls.length,2);
});

test('a display entry from a future clock is never reused',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);f.setTime(9999);
 assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,2n);assert.equal(f.calls.length,2);
});

test('a cancellable reader joins the normal pending batch without replacing its snapshot',async t=>{
 const f=fixture(),gate=deferred();t.after(gate.resolve);f.gates.push(gate);f.set(a,1n);
 const shared=readWalletBalances(f.request,owner,[a],{clock:f.clock});await flush();f.set(a,2n);
 const own=readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal});let ownDone=false;own.then(()=>ownDone=true);await flush();
 assert.equal(ownDone,false);assert.equal(f.calls.length,1);
 gate.resolve();assert.equal((await shared).balances.a,1n);assert.equal((await own).balances.a,1n);assert.equal(f.calls.length,1);
});

test('aborting one shared balance subscriber cannot cancel or poison another result',async t=>{
 const f=fixture(),gate=deferred(),oneController=new AbortController();t.after(gate.resolve);
 f.set(a,1n);f.gates.push(gate);const one=readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:oneController.signal});const rejected=assert.rejects(one,{name:'AbortError'});await flush();
 const two=readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal});await flush();assert.equal(f.calls.length,1);
 oneController.abort();await rejected;gate.resolve();assert.equal((await two).balances.a,1n);await flush();
 assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,1n);assert.equal(f.calls.length,1);
});

test('abort during a completed cache hit rejects instead of returning cached amounts',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});const controller=new AbortController();
 const pending=readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;assert.equal(f.calls.length,1);
});

test('abort immediately before cache publication neither writes nor returns the fetched value',async()=>{
 const f=fixture(),controller=new AbortController();f.set(a,1n);
 await assert.rejects(readWalletBalances(f.request,owner,[a],{clock:()=>{controller.abort();return f.clock();},signal:controller.signal}),{name:'AbortError'});
 f.set(a,2n);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock})).balances.a,2n);assert.equal(f.calls.length,2);
});

test('account or chain epoch invalidation rejects late amounts and preserves the newer display value',async t=>{
 const f=fixture(),gate=deferred();t.after(gate.resolve);f.set(a,1n);f.gates.push(gate);
 const old=readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal});const rejected=assert.rejects(old,{name:'AbortError'});await flush();
 invalidateWalletBalances();f.set(a,2n);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,2n);
 gate.resolve();await rejected;assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,2n);assert.equal(f.calls.length,2);
});

test('fresh post-transaction reads always invalidate display entries with or without a signal',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);
 assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,fresh:true,signal:new AbortController().signal})).balances.a,2n);assert.equal(f.calls.length,2);
 assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,signal:new AbortController().signal})).balances.a,2n);assert.equal(f.calls.length,2);
 f.set(a,3n);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock,fresh:true})).balances.a,3n);assert.equal(f.calls.length,3);
});

test('completed display cache identity isolates accounts, token addresses and decimals',async()=>{
 const f=fixture();f.set(a,1n);f.set(a,7n,other);f.set(b,9n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});
 const run=(account,token)=>readWalletBalances(f.request,account,[token],{clock:f.clock,signal:new AbortController().signal});
 assert.equal((await run(other,a)).balances.a,7n);assert.equal((await run(owner,{...a,address:b.address})).balances.a,9n);assert.equal((await run(owner,{...a,decimals:6})).balances.a,1n);assert.equal(f.calls.length,4);
});

test('failed misses remain failed and retryable while completed cached tokens remain available',async()=>{
 const f=fixture();f.set(a,0n);f.set(b,7n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);f.fail(b,true);
 assert.deepEqual(await readWalletBalances(f.request,owner,[a,b],{clock:f.clock,signal:new AbortController().signal}),{balances:{a:0n},failed:['b']});
 f.fail(b,false);assert.deepEqual(await readWalletBalances(f.request,owner,[a,b],{clock:f.clock,signal:new AbortController().signal}),{balances:{a:0n,b:7n},failed:[]});assert.deepEqual(f.calls,[[a.address],[b.address],[b.address]]);
});
test('noncancellable display hits retain the original five-second completion window',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});f.set(a,2n);
 for(const time of[13000,14999]){f.setTime(time);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock})).balances.a,1n);}
 f.setTime(15000);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock})).balances.a,2n);assert.equal(f.calls.length,2);
});
test('account or chain invalidation rejects late shared display balances, including joined subscribers',async t=>{
 const f=fixture(),gate=deferred();t.after(gate.resolve);f.set(a,1n);f.gates.push(gate);
 const old=readWalletBalances(f.request,owner,[a],{clock:f.clock});const rejected=assert.rejects(old,{name:'AbortError'});await flush();
 const joined=readWalletBalances(f.request,owner,[a],{clock:f.clock});const alsoRejected=assert.rejects(joined,{name:'AbortError'});
 invalidateWalletBalances();f.set(a,2n);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock})).balances.a,2n);
 gate.resolve();await Promise.all([rejected,alsoRejected]);assert.equal((await readWalletBalances(f.request,owner,[a],{clock:f.clock})).balances.a,2n);assert.equal(f.calls.length,2);
});
test('invalidation before a shared cache-hit promise completes cannot return old display balances',async()=>{
 const f=fixture();f.set(a,1n);await readWalletBalances(f.request,owner,[a],{clock:f.clock});
 const old=readWalletBalances(f.request,owner,[a],{clock:f.clock}),rejected=assert.rejects(old,{name:'AbortError'});invalidateWalletBalances();await rejected;
});
