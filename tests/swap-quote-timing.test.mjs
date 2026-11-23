import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {SWAP_ADAPTERS,SWAP_ABI} from '../src/swap-aggregator.mjs';
import {quoteFstRoutes,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {createTimingScope,countTiming} from '../server/swap-timing.mjs';
globalThis.ethers=ethers;
const input=FST_FEE_ASSETS.USDT,output=FST_FEE_ASSETS.FIST;
const multi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']),router=new ethers.Interface(SWAP_ABI);
test('actual route calculation reports contract-batch work and candidates without changing its exact net output',async()=>{
 const pool={address:'0x'+'11'.repeat(20),adapter:SWAP_ADAPTERS.fst.adapter,token0:input,token1:output,reserves:[1000000000n,1000000000n],kind:'v2'};
 const scope=createTimingScope(),policy={pools:new Map([['one',pool]]),blockNumber:'0x100',allowsRoute:()=>true,assertFresh(){}};
 const read=async request=>{
  const calls=multi.decodeFunctionData('tryAggregate',request.params[0].data)[1];
  return multi.encodeFunctionResult('tryAggregate',[calls.map(call=>{const tx=router.parseTransaction({data:call.callData});return[true,router.encodeFunctionResult(tx.name,[[tx.args[1],900n]])];})]);
 };
 const q=await scope.run(()=>quoteFstRoutes(read,{from:input,to:output,amount:1000n,policy,configVersion:'2.1.0',transferTaxes:new Map([[input,{kind:'none'}],[output,{kind:'none'}]]),count:countTiming}));
 assert.equal(q.out,900n);assert.equal(q.candidates.length,1);
 assert.deepEqual(scope.snapshot().counts,{quote_batches:1,quote_subcalls:1,quote_candidates:1});
});
