import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/swap-pool.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function txHelpers('),source.indexOf('// —— 结果弹窗'));
const account='0x'+'ab'.repeat(20),destination='0x'+'cd'.repeat(20),hash='0x'+'ef'.repeat(32);
function fixture({estimate=120001n,price=50000000n,balance=10000000000000000n,pendingGas=false}={}){
 const calls=[],sends=[];let resolve;
 const gate=pendingGas?new Promise(r=>resolve=r):null;
 const provider={request:async payload=>{sends.push(payload);return hash;}};
 const wallet={account,provider};
 const read=async payload=>{calls.push(payload);if(payload.method==='eth_estimateGas'){if(gate)await gate;if(estimate instanceof Error)throw estimate;return '0x'+estimate.toString(16);}if(payload.method==='eth_gasPrice'){if(price instanceof Error)throw price;return '0x'+price.toString(16);}if(payload.method==='eth_getBalance')return '0x'+balance.toString(16);throw Error('Unexpected '+payload.method);};
 const context={wallet,read,swapPublicRpc:()=>read,globalThis:{fetch:()=>{}},tr:(_zh,en)=>en,BigInt,Promise,Error,Object,String,setTimeout};vm.createContext(context);vm.runInContext(code+'\nthis.helper=txHelpers(wallet,read);',context);
 return{...context,calls,sends,wallet,resolve,transaction:{from:account,to:destination,data:'0x1234',value:'0x100'}};
}
test('pool send uses a ceil-rounded estimate and live gas price in the actual wallet transaction',async()=>{
 const f=fixture();assert.equal(await f.helper.send(f.transaction),hash);
 assert.equal(f.sends.length,1);const sent=f.sends[0].params[0];
 assert.equal(BigInt(sent.gas),156002n);assert.equal(BigInt(sent.gasPrice),50000000n);
 assert.equal(sent.value,'0x100');assert.equal(sent.to,destination);
 assert.deepEqual(f.calls.map(c=>c.method),['eth_estimateGas','eth_gasPrice','eth_getBalance']);
 assert.equal(f.calls[2].params[1],'latest');
});
test('pool send rejects when current native balance cannot fund both value and the explicit gas budget',async()=>{
 const limit=156002n,price=50000000n,value=256n;
 const f=fixture({balance:value+limit*price-1n});await assert.rejects(f.helper.send(f.transaction),/Insufficient BNB/);assert.equal(f.sends.length,0);
 const exact=fixture({balance:value+limit*price});await exact.helper.send(exact.transaction);assert.equal(exact.sends.length,1);
});
test('estimate failure can use the operation limit, but missing or zero live gas price cannot send',async()=>{
 const f=fixture({estimate:Error('reverted')});await f.helper.send(f.transaction,400000n);assert.equal(BigInt(f.sends[0].params[0].gas),400000n);
 for(const price of[0n,Error('no live price')]){
  const f=fixture({price});await assert.rejects(f.helper.send(f.transaction));assert.equal(f.sends.length,0);
 }
});
test('account or provider changes while public gas is pending cannot send an obsolete liquidity transaction',async()=>{
 for(const change of['account','provider']){
  const f=fixture({pendingGas:true}),job=f.helper.send(f.transaction);
  f.wallet[change]=change==='account'?'0x'+'11'.repeat(20):{request:async()=>{throw Error('Must not call replacement wallet');}};
  f.resolve();await assert.rejects(job,/Selection changed/);assert.equal(f.sends.length,0);
 }
});
test('supply intent is checked again after reads and before a wallet request',async()=>{
 const f=fixture({pendingGas:true});let current=true,checks=0;
 const job=f.helper.send(f.transaction,400000n,{assertCurrent(){checks++;if(!current)throw Error('Supply input changed');}});
 current=false;f.resolve();await assert.rejects(job,/Supply input changed/);assert.equal(checks,2);assert.equal(f.sends.length,0);
});
