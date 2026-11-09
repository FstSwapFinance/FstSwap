import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
globalThis.ethers = ethers;
const addr = n => '0x' + n.toString(16).padStart(40, '0');
globalThis.FST_V10_CONFIG = { router: addr(1), adapters: { fst: addr(2), pancake: addr(3), v3: addr(4), biswap: addr(5) } };
const { swapFeePolicy, SWAP_TOKENS: t, SWAP_ABI, SWAP_ADAPTERS, v10PlanFeeConversion, readV10Receipt, readSwapConfig } = await import('../swap-aggregator.mjs?v10-fees-unit');
const iface = new ethers.Interface(SWAP_ABI);
const zero = ethers.ZeroAddress;
const multi = new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
test('v10 fee identity uses addresses, input priority and distinguishes wrapped BNB', () => {
  assert.deepEqual(swapFeePolicy(t.fist.address, t.usdt.address), {mode:'input',token:t.fist.address});
  assert.deepEqual(swapFeePolicy(t.usdt.address, null), {mode:'input',token:t.usdt.address});
  assert.deepEqual(swapFeePolicy(null, t.fist.address), {mode:'input',token:zero});
  assert.deepEqual(swapFeePolicy(t.wbnb.address, t.fist.address), {mode:'output',token:t.fist.address});
  assert.deepEqual(swapFeePolicy(addr(88), null), {mode:'output',token:zero});
  assert.deepEqual(swapFeePolicy(addr(88), addr(99), t.fist.address), {mode:'convert',token:t.fist.address});
});
test('frontend v10 fee signatures match compiled source ABI', () => {
  const artifact=JSON.parse(readFileSync(new URL('../contracts/fstsi-v10/deployment/mainnet-manifest.json',import.meta.url))).contracts.AggregatedRouterV10;
  const compiled=new ethers.Interface(artifact.abi);
  for(const name of ['swapTokenToTokenWithFee','swapTokenForExactTokenWithFee','quoteExactOutputWithFee','quoteFeeConversion','defaultFeeToken','feeConfigVersion']) assert.equal(iface.getFunction(name).selector,compiled.getFunction(name).selector);
  assert.equal(iface.getEvent('PlatformFeePaid').topicHash,compiled.getEvent('PlatformFeePaid').topicHash);
});
test('fee planner excludes shared main pools and applies fee slippage separately', async () => {
  const input=addr(88), main={adapter:SWAP_ADAPTERS.fst.adapter,path:[input,t.usdt.address,addr(99)]};
  const request=async ({params})=>{
    const decoded=multi.decodeFunctionData('tryAggregate',params[0].data);
    return multi.encodeFunctionResult('tryAggregate',[decoded.calls.map(c=>{
      const p=iface.decodeFunctionData('quoteFeeConversion',c.callData);
      if(p.conversion.first.adapter.toLowerCase()===main.adapter.toLowerCase()) {
        const path=[...p.conversion.first.path].map(x=>x.toLowerCase());
        for(let i=1;i<path.length;i++) assert.notDeepEqual([path[i-1],path[i]].sort(),[input,t.usdt.address.toLowerCase()].sort());
      }
      return [true,iface.encodeFunctionResult('quoteFeeConversion',[1000n])];
    })]);
  };
  const plan=await v10PlanFeeConversion(request,{input,feeBudget:30n,config:{defaultFeeToken:t.usdt.address,feeConfigVersion:2n,adaptersOff:[]},slippageBps:50,mainLegs:[main]});
  assert.equal(plan.fee,1000n);assert.equal(plan.conversion.minOut,995n);assert.equal(plan.conversion.configVersion,2n);
});
test('v10 config reads fee currency and version after adapter metadata', async()=>{
 const request=async ({method,params})=>{
  if(method==='eth_chainId') return '0x38';
  const decoded=multi.decodeFunctionData('tryAggregate',params[0].data);
  return multi.encodeFunctionResult('tryAggregate',[decoded.calls.map(c=>{
   const name=iface.parseTransaction({data:c.callData}).name;
   const values={platformFeeBps:[30],feeReceiver:[addr(6)],WBNB:[t.wbnb.address],adapters:[true],aggregator:[addr(1)],VERSION:['1.11'],defaultFeeToken:[t.usdt.address],feeConfigVersion:[7]};
   return [true,iface.encodeFunctionResult(name,values[name])];
  })]);
 };
 const config=await readSwapConfig(request);assert.equal(config.defaultFeeToken.toLowerCase(),t.usdt.address.toLowerCase());assert.equal(config.feeConfigVersion,7n);
});
function receiptFixture() {
 const hash='0x'+'11'.repeat(32), blockHash='0x'+'22'.repeat(32), account=addr(77), expectedRequest={to:addr(1),data:'0x1234',value:'0x0'};
 const log=(name,args)=>({address:addr(1),...iface.encodeEventLog(iface.getEvent(name),args)});
 const receipt={transactionHash:hash,blockHash,blockNumber:'0x1',from:account,to:addr(1),status:'0x1',gasUsed:'0x100',logs:[log('SwapExecuted',[account,t.fist.address,t.usdt.address,1000n,500n,3n]),log('PlatformFeePaid',[account,t.fist.address,3n])]};
 const tx={hash,blockHash,from:account,to:addr(1),input:expectedRequest.data,value:'0x0'};
 const request=async({method})=>method==='eth_getTransactionReceipt'?receipt:method==='eth_getTransactionByHash'?tx:{hash:blockHash};
 return {receipt,tx,request,hash,options:{account,expectedRequest,tokenIn:t.fist.address,tokenOut:t.usdt.address,minOut:499n,maxIn:1000n,feeToken:t.fist.address}};
}
test('v10 receipt verifies canonical block, input cap, output and fee asset',async()=>{
 const f=receiptFixture();const r=await readV10Receipt(f.request,f.hash,f.options);assert.equal(r.amountOut,500n);assert.equal(r.fee,3n);
 f.options.maxIn=999n;await assert.rejects(readV10Receipt(f.request,f.hash,f.options),{code:'INVALID_RECEIPT'});
});
test('v10 receipt rejects duplicate fee collection and unexpected fee currency',async()=>{
 const f=receiptFixture();f.receipt.logs.push(f.receipt.logs[1]);await assert.rejects(readV10Receipt(f.request,f.hash,f.options),{code:'INVALID_RECEIPT'});
 f.receipt.logs.pop();f.options.feeToken=t.usdt.address;await assert.rejects(readV10Receipt(f.request,f.hash,f.options),{code:'INVALID_RECEIPT'});
});

test('v10 receipt rejects missing or inconsistent fee evidence',async()=>{
 const f=receiptFixture();f.options.expectedFee=3n;f.receipt.logs.pop();await assert.rejects(readV10Receipt(f.request,f.hash,f.options),{code:'INVALID_RECEIPT'});
 const g=receiptFixture();g.receipt.logs[1]={address:addr(1),...iface.encodeEventLog(iface.getEvent('PlatformFeePaid'),[g.options.account,t.fist.address,888n])};await assert.rejects(readV10Receipt(g.request,g.hash,g.options),{code:'INVALID_RECEIPT'});
 const h=receiptFixture();h.options.minFeeOut=4n;await assert.rejects(readV10Receipt(h.request,h.hash,h.options),{code:'INVALID_RECEIPT'});
});
