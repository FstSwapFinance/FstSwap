import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBalanceFraction } from '../src/swap-native-max.mjs';

const baseBalance=15966673100000001n;
const txFor=amount=>({from:'0x'+'11'.repeat(20),to:'0x'+'22'.repeat(20),value:'0x'+amount.toString(16),data:'0x1234'});
function scenario(overrides={}) {
 const built=[],estimated=[];
 return {built,estimated,options:{balance:baseBalance,percent:100,readGasPrice:async()=>50000000n,
  buildTransaction:async amount=>{built.push(amount);return txFor(amount);},
  estimate:async tx=>{estimated.push(tx);return 150000n;},...overrides}};
}

test('Max keeps 18-decimal BNB precision and reserves the real route gas plus explicit headroom',async()=>{
 const s=scenario(),r=await nativeBalanceFraction(s.options);
 assert.equal(r.amount,15954973100000001n);
 assert.equal(r.reserve,11700000000000n);
 assert.equal(r.gasLimit,195000n);
 assert.equal(r.gasPrice,50000000n);
 assert.equal(r.estimated,true);
 assert.equal(BigInt(r.transaction.value),r.amount);
 assert.ok(s.built.length>=2&&s.built.length<=3,'probe and final amount must both get a transaction');
 assert.ok(s.built.every(value=>value>0n&&value<baseBalance),'the estimator never receives the whole balance as value');
 assert.equal(BigInt(s.estimated.at(-1).value),r.amount,'returned amount was actually estimated');
 assert.equal(r.amount+r.reserve,baseBalance);
});

test('standard RPC hex quantities are normalized without losing wei',async()=>{
 const r=await nativeBalanceFraction(scenario({readGasPrice:async()=>'0x2faf080',estimate:async()=>'0x249f0'}).options);
 assert.equal(r.gasPrice,50000000n);assert.equal(r.gasLimit,195000n);
 assert.equal(r.reserve,11700000000000n);assert.equal(r.amount,15954973100000001n);
});

test('25%, 50%, 75% and Max use spendable balance without Number rounding',async()=>{
 const expected=new Map([[25,249998050000000001n],[50,499996100000000003n],[75,749994150000000005n],[100,999992200000000007n]]);
 for(const [percent,amount]of expected){
  const s=scenario({balance:1000000000000000007n,percent,estimate:async()=>100000n});
  const r=await nativeBalanceFraction(s.options);
  assert.equal(r.amount,amount,percent+'%');assert.equal(r.reserve,7800000000000n);
  assert.equal(BigInt(r.transaction.value),r.amount);
 }
});

test('Gas units and gas-price headroom round upwards at smallest-unit boundaries',async()=>{
 const s=scenario({balance:1000000000000000001n,readGasPrice:async()=>1n,estimate:async()=>21001n});
 const r=await nativeBalanceFraction(s.options);
 assert.equal(r.gasLimit,27302n);assert.equal(r.gasPrice,1n);assert.equal(r.reserve,54604n);
 assert.equal(r.amount,999999999999945397n);
});

test('pending approval budget is kept in BNB and does not subtract token units',async()=>{
 const s=scenario({extraGasLimit:150000n}),r=await nativeBalanceFraction(s.options);
 assert.equal(r.gasLimit,195000n);assert.equal(r.reserve,20700000000000n);
 assert.equal(r.amount,15945973100000001n);
});

test('gas-price failure or an unaffordable gas budget never fills all native balance',async()=>{
 for(const priced of [0n,-1n,'0x0',null,undefined]){
  const s=scenario({readGasPrice:async()=>priced});
  await assert.rejects(nativeBalanceFraction(s.options));assert.equal(s.built.length,0);
 }
 const expensive=scenario({balance:1000000000000000n,readGasPrice:async()=>3000000000n,estimate:async()=>1000000n});
 await assert.rejects(nativeBalanceFraction(expensive.options));
 assert.ok(expensive.built.every(value=>value>0n&&value<1000000000000000n));
 const stillAffordable=await nativeBalanceFraction(scenario({balance:1000000000000000n,readGasPrice:async()=>3000000000n}).options);
 assert.equal(stillAffordable.amount,298000000000000n);assert.equal(stillAffordable.reserve,702000000000000n);
 const offline=scenario({readGasPrice:async()=>{throw Error('RPC offline');},allowEstimateFallback:true});
 await assert.rejects(nativeBalanceFraction(offline.options),/RPC offline/);
});

test('malformed RPC booleans and arrays cannot become one-wei gas quotes',async()=>{
 for(const malformed of [true,false,[1],[],{},1.5,NaN,Infinity]){
  const s=scenario({readGasPrice:async()=>malformed});
  await assert.rejects(nativeBalanceFraction(s.options));assert.equal(s.built.length,0);
  await assert.rejects(nativeBalanceFraction(scenario({estimate:async()=>malformed}).options));
 }
});

test('failed actual estimation rejects unless a caller explicitly permits a priced gas budget',async()=>{
 const failure=()=>{throw Error('TRANSFER_FROM_FAILED');};
 await assert.rejects(nativeBalanceFraction(scenario({estimate:failure}).options),/TRANSFER_FROM_FAILED/);
 const r=await nativeBalanceFraction(scenario({estimate:failure,allowEstimateFallback:true,fallbackGasLimit:400000n}).options);
 assert.equal(r.estimated,false);assert.equal(r.gasPrice,50000000n);
 assert.ok(r.gasLimit>=400000n);assert.ok(r.reserve>0n&&r.reserve<10000000000000000n);
 assert.equal(r.amount+r.reserve,baseBalance);
 assert.equal(BigInt(r.transaction.value),r.amount);
 for(const invalid of [0n,-1n])await assert.rejects(nativeBalanceFraction(scenario({estimate:async()=>invalid}).options));
});

test('an increased route estimate tightens Max and the final transaction fits its own reserve',async()=>{
 let calls=0;
 const s=scenario({estimate:async()=>++calls===1?150000n:200000n});
 const r=await nativeBalanceFraction(s.options);
 assert.equal(r.gasLimit,260000n);assert.equal(r.reserve,15600000000000n);
 assert.equal(r.amount,15951073100000001n);assert.equal(BigInt(r.transaction.value),r.amount);
 assert.ok(calls<=3&&calls>=2);
});

test('a lower later estimate cannot expand Max again and oscillate indefinitely',async()=>{
 let calls=0;
 const r=await nativeBalanceFraction(scenario({estimate:async()=>++calls===1?200000n:150000n}).options);
 assert.equal(r.reserve,15600000000000n);assert.equal(r.amount,15951073100000001n);
 assert.ok(calls<=3);
});

test('aborted reads and stale account assertions cannot publish a native amount',async()=>{
 const controller=new AbortController();controller.abort();
 const s=scenario({signal:controller.signal});
 await assert.rejects(nativeBalanceFraction(s.options),e=>e.name==='AbortError');assert.equal(s.built.length,0);
 let current=true;
 const stale=scenario({readGasPrice:async()=>{current=false;return 50000000n;},assertCurrent:()=>{if(!current)throw Error('STALE_ACCOUNT');}});
 await assert.rejects(nativeBalanceFraction(stale.options),/STALE_ACCOUNT/);assert.equal(stale.built.length,0);
 const mid=new AbortController();
 const delayed=scenario({signal:mid.signal,estimate:async()=>{mid.abort();return 150000n;}});
 await assert.rejects(nativeBalanceFraction(delayed.options),e=>e.name==='AbortError');
});

test('unknown balances, invalid fractions, and malformed budgets never reach an estimate',async()=>{
 for(const balance of [undefined,null,0n,-1n,1,'1'])await assert.rejects(nativeBalanceFraction(scenario({balance}).options));
 for(const percent of [undefined,0,-1,101,25.5,NaN,'25',25n])await assert.rejects(nativeBalanceFraction(scenario({percent}).options));
 for(const fallbackGasLimit of [0n,-1n,null])await assert.rejects(nativeBalanceFraction(scenario({fallbackGasLimit}).options));
 for(const extraGasLimit of [-1n,null,1])await assert.rejects(nativeBalanceFraction(scenario({extraGasLimit}).options));
});
