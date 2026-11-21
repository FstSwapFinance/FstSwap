import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {readFile} from 'node:fs/promises';
globalThis.ethers=ethers;
const source=await readFile(new URL('../src/swap-fstswap.mjs',import.meta.url),'utf8');
const runtimeQuery=source.match(/swap-aggregator\.mjs([^']*)'/)[1];
const {SWAP_ABI,SWAP_ADAPTERS}=await import('../src/swap-aggregator.mjs'+runtimeQuery);
const {readFstPoolPolicy,quoteFstSwap,FST_FEE_ASSETS}=await import(process.env.FST_VALUE_REJECTION_MODULE||'../src/swap-fstswap.mjs');
const Z=ethers.ZeroAddress,U=FST_FEE_ASSETS.USDT,W=FST_FEE_ASSETS.WBNB,C=FST_FEE_ASSETS.USDC,S=10n**18n;
const FW=SWAP_ADAPTERS.fst.weth.toLowerCase(),bnbFeed='0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee';
const abi=new ethers.Interface([...SWAP_ABI,
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)']);
const key=(a,b)=>[a,b].sort().join(':');
async function fixture({absent=false,zero=false,mixed=false,bridge=false,oracleBnb=600n}={}){
 const now=Date.now(),block={number:'0x100',hash:'0x'+'01'.repeat(32),timestamp:ethers.toQuantity(Math.floor(now/1000))};
 const config={version:'2.1.0',platformFeeBps:30,feeReceiver:'0x'+'66'.repeat(20),defaultFeeToken:U,feeConfigVersion:5n,adaptersOff:['v3'],wbnb:W};
 const pairs=[{adapter:SWAP_ADAPTERS.pancake.adapter.toLowerCase(),a:W,b:U,rateA:600n,rateB:1n,ratio:9975n}];
 if(mixed)pairs.push({adapter:SWAP_ADAPTERS.fst.adapter.toLowerCase(),a:FW,b:U,rateA:600n,rateB:1n,ratio:9700n});
 if(bridge)pairs.push({adapter:SWAP_ADAPTERS.pancake.adapter.toLowerCase(),a:W,b:C,rateA:600n,rateB:1n,ratio:9975n},{adapter:SWAP_ADAPTERS.pancake.adapter.toLowerCase(),a:C,b:U,rateA:1n,rateB:1n,ratio:9975n});
 let routeCalls=0;
 const request=async p=>{
  if(p.method==='eth_getBlockByNumber')return{...block};
  assert.equal(p.method,'eth_call');assert.equal(p.params[1],block.number);
  const batch=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return abi.encodeFunctionResult('tryAggregate',[batch.map(c=>{
   const tx=abi.parseTransaction({data:c.callData}),ok=v=>[true,abi.encodeFunctionResult(tx.name,v)];
   if(tx.name==='latestRoundData')return ok([1n,c.target.toLowerCase()===bnbFeed?oracleBnb*100000000n:100000000n,0n,BigInt(Math.floor(now/1000)),1n]);
   if(tx.name==='decimals')return ok([8]);
   if(tx.name==='getPairInfo'){
    const [adapter,a,b]=tx.args.map(x=>String(x).toLowerCase()),index=pairs.findIndex(r=>r.adapter===adapter&&key(r.a,r.b)===key(a,b)),pair=pairs[index];
    if(absent||!pair)return ok([Z,a,b,0n,0n,0n,0n]);
    // $6m in each side; the actual policy must admit the route above $100k.
    const reserve=t=>6000000n*S/(t===pair.a?pair.rateA:pair.rateB);
    return ok(['0x'+(index+1).toString(16).padStart(40,'0'),a,b,reserve(a),reserve(b),1n,0n]);
   }
   if(tx.name==='getAmountsOutVia'){
    routeCalls++;
    const [adapter,amount,path]=tx.args,from=path[0].toLowerCase(),to=path[1].toLowerCase(),pair=pairs.find(r=>r.adapter===adapter.toLowerCase()&&key(r.a,r.b)===key(from,to));
    assert.ok(pair,'only a discovered fixture pool can be quoted');
    const forward=from===pair.a,out=zero?0n:amount*(forward?pair.rateA:pair.rateB)*pair.ratio/(forward?pair.rateB:pair.rateA)/10000n;
    return ok([[amount,out]]);
   }
   throw Error('Unexpected fixture RPC '+tx.name);
  })]);
 };
 const options={tokenIn:Z,tokenOut:U,config,block,nodeId:'one',clock:()=>now,deferCanonical:true};
 const policy=await readFstPoolPolicy(request,options);
 return{policy,routeCalls:()=>routeCalls,quote:overrides=>quoteFstSwap(request,{tokenIn:Z,tokenOut:U,amountIn:1000000000000000n,config,slippageBps:50,singleHop:false,preparedPolicy:policy,contextNodeId:'one',...overrides})};
}
test('healthy native 0.001 BNB keeps its exact input fee and quote at default 50 bps',async()=>{
 for(const singleHop of[false,true]){
  const f=await fixture(),q=await f.quote({singleHop});
  assert.equal(q.amountIn,1000000000000000n);assert.equal(q.lpFee,3000000000000n);
  assert.equal(q.out,596704500000000000n);assert.equal(q.minimum,593720977500000000n);
  assert.equal(q.stages[0].tokenIn,Z);assert.deepEqual(q.stages[0].branches[0].path.map(x=>x.toLowerCase()),[W,U]);
 }
});
test('all candidates rejected by reference-value protection preserve the price reason',async()=>{
 const f=await fixture();await assert.rejects(f.quote({slippageBps:200}),{code:'POOL_LIQUIDITY',reason:'price',retryable:false});
});
test('a price-aligned deep pool can still fail net minimum at default slippage',async()=>{
 const f=await fixture({oracleBnb:610n});
 assert.equal(f.policy.allowsRoute([{adapter:SWAP_ADAPTERS.pancake.adapter,kind:'v2',path:[W,U]}]),true,'the independent pool policy must admit this deep pool before quoting');
 assert.equal(f.routeCalls(),0);
 let rejection;try{await f.quote();}catch(error){rejection=error;}
 assert.ok(f.routeCalls()>0,'the rejected minOut must come after getAmountsOutVia, not from absent topology');
 assert.deepEqual({code:rejection?.code,reason:rejection?.reason,retryable:rejection?.retryable},{code:'POOL_LIQUIDITY',reason:'price',retryable:false});
});
test('a rejected candidate cannot mask an available healthy route',async()=>{
 const f=await fixture({mixed:true}),q=await f.quote();
 assert.equal(q.out,596704500000000000n);assert.equal(q.minimum,593720977500000000n);
 assert.equal(q.stages[0].branches.length,1);assert.equal(q.stages[0].branches[0].adapter.toLowerCase(),SWAP_ADAPTERS.pancake.adapter.toLowerCase());
 assert.ok(q.segments[0].candidates.length>0);
});
test('an absent topology still reports NO_ROUTE',async()=>{
 const f=await fixture({absent:true});await assert.rejects(f.quote(),{code:'NO_ROUTE'});
});
test('all zero quoter outputs still report NO_ROUTE',async()=>{
 const f=await fixture({zero:true});await assert.rejects(f.quote(),{code:'NO_ROUTE'});
});
test('an unexpected value-check error is propagated rather than disguised as NO_ROUTE',async()=>{
 const f=await fixture(),unexpected=new TypeError('independent-price decoder failed'),original=f.policy.prices.get.bind(f.policy.prices);
 f.policy.prices.get=token=>{if(token===FW)throw unexpected;return original(token);};
 await assert.rejects(f.quote(),error=>error===unexpected);
});
test('when every candidate is rejected the first sorted structured rejection is retained',async()=>{
 const f=await fixture({bridge:true}),first=Object.assign(Error('temporarily missing reference'),{code:'POOL_LIQUIDITY',reason:'oracle',retryable:true}),later=Object.assign(Error('value below reference'),{code:'POOL_LIQUIDITY',reason:'price',retryable:false});
 const original=f.policy.prices.get.bind(f.policy.prices);let checks=0;
 f.policy.prices.get=token=>{if(token===FW)throw checks++===0?first:later;return original(token);};
 await assert.rejects(f.quote(),error=>error===first);assert.ok(checks>1,'the rejection must not stop validation of the remaining candidates');
});
