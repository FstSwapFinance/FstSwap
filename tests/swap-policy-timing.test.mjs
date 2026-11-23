import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {SWAP_ABI,SWAP_TOKENS} from '../src/swap-aggregator.mjs';
import {readPoolPolicy} from '../src/swap-liquidity.mjs';
import {createTimingScope,measurePhase} from '../server/swap-timing.mjs';
globalThis.ethers=ethers;
const abi=new ethers.Interface([...SWAP_ABI,'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)']);
function fixture({badOracle=false}={}){
 const now=Date.now(),block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:ethers.toQuantity(Math.floor(now/1000))};
 const request=async p=>{
  if(p.method==='eth_getBlockByNumber')return block;
  const calls=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return abi.encodeFunctionResult('tryAggregate',[calls.map(call=>{
   const tx=abi.parseTransaction({data:call.callData});let out;
   if(tx.name==='latestRoundData'){if(badOracle)return[false,'0x'];out=[1n,100000000n,0n,BigInt(block.timestamp),1n];}
   else if(tx.name==='decimals')out=[8];
   else if(tx.name==='getPairInfo')out=[ethers.ZeroAddress,tx.args[1],tx.args[2],0n,0n,0n,0n];
   else throw Error('Unexpected timing fixture call');
   return[true,abi.encodeFunctionResult(tx.name,out)];
  })]);
 };
 return{request,options:{tokenIn:SWAP_TOKENS.usdt.address,tokenOut:SWAP_TOKENS.fist.address,config:{adaptersOff:['v3']},clock:()=>now,measure:measurePhase}};
}
test('real policy execution reports Oracle and V2 phases without changing its admitted pools',async()=>{
 const f=fixture(),scope=createTimingScope();
 const policy=await scope.run(()=>readPoolPolicy(f.request,f.options));
 assert.equal(policy.pools.size,0);assert.equal(policy.prices.size>0,true);
 const durations=scope.snapshot().durations;assert.equal(typeof durations.oracle,'number');assert.equal(typeof durations.v2,'number');
});
test('a failed Oracle phase is measured while the original policy rejection remains fatal',async()=>{
 const f=fixture({badOracle:true}),scope=createTimingScope();
 await assert.rejects(scope.run(()=>readPoolPolicy(f.request,f.options)),e=>e.code==='POOL_LIQUIDITY'&&e.reason==='oracle');
 assert.equal(typeof scope.snapshot().durations.oracle,'number');assert.equal(typeof scope.snapshot().durations.v2,'number');
});
