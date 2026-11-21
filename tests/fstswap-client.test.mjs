import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {fstSwapReady,FSTSWAP_CONFIG} from '../src/fstswap-config.mjs';
import {fstFeePolicy,buildFstQuote,fstRequest,FST_ABI,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
globalThis.ethers=ethers;
const zero=ethers.ZeroAddress,usdt=FST_FEE_ASSETS.USDT,a='0x'+'aa'.repeat(20),b='0x'+'bb'.repeat(20),adapter='0x'+'cc'.repeat(20),router='0x'+'dd'.repeat(20),account='0x'+'ee'.repeat(20);
const config={version:'2.0.0',platformFeeBps:30,defaultFeeToken:usdt,feeConfigVersion:5n};
const route=(from,to,amount,out)=>({legs:[{adapter,kind:'v2',path:[from,to],amountIn:amount,out}],out,impact:0,assertFresh(){}});
test('unverified deployment cannot become the active mainnet router',()=>{
 assert.equal(fstSwapReady({...FSTSWAP_CONFIG,status:'awaiting-deployment'}),false);
 assert.equal(fstSwapReady({...FSTSWAP_CONFIG,status:'awaiting-deployment',router}),false);
 assert.equal(fstSwapReady({...FSTSWAP_CONFIG,adapters:{...FSTSWAP_CONFIG.adapters,v3:zero}}),false);
 assert.equal(fstSwapReady({...FSTSWAP_CONFIG,chainId:97}),false);
});
test('verified mainnet deployment activates the recorded router and currently supported adapters',()=>{
 assert.equal(fstSwapReady(),true);
 assert.equal(FSTSWAP_CONFIG.version,'2.1.0');
 assert.equal(FSTSWAP_CONFIG.router,'0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7');
 assert.deepEqual(FSTSWAP_CONFIG.adapters,{
  fst:'0xdFabF87EE3A9A4cEdda43D3f8035C89E1C9438b7',
  pancake:'0x9De342bDFFB5da04D9865f4cd9846D22560D253a',
  v3:'0xE381c967c14b0c6ef82944E0e4b4272D24dd8957'
 });
});
test('each of the six assets charges input first and others charge eligible output',()=>{
 for(const t of Object.values(FST_FEE_ASSETS)){
  assert.deepEqual(fstFeePolicy(t,usdt),{mode:'input',token:t});
  assert.deepEqual(fstFeePolicy(a,t),{mode:'output',token:t});
 }
});
test('intermediate fee uses the entire first-stage output and pays remaining budget onward',async()=>{
 const calls=[];
 const q=await buildFstQuote({tokenIn:a,tokenOut:b,amountIn:1000n,config,slippageBps:50,findRoute:async(from,to,amount)=>{
  calls.push([from,to,amount]);return route(from,to,amount,to===usdt?2000n:3988n);
 }});
 assert.deepEqual(calls,[[a,usdt,1000n],[usdt,b,1994n]]);assert.equal(q.lpFee,6n);assert.equal(q.out,3988n);assert.equal(q.minimum,3968n);
 assert.equal(q.stages.length,2);assert.equal(q.stages[0].tokenOut,usdt);
 const tx=fstRequest(ethers.Interface,{router,account,quote:q,deadline:12345});const decoded=new ethers.Interface(FST_ABI).parseTransaction(tx);
 assert.equal(decoded.name,'swapExactInput');assert.equal(decoded.args[0].amountIn,1000n);assert.equal(decoded.args[0].minOut,3968n);assert.equal(decoded.args[0].feeToken.toLowerCase(),usdt);
 assert.equal(decoded.args[1][0].tokenOut.toLowerCase(),usdt);assert.equal(tx.value,'0x0');
});
test('native input uses all post-fee funds without a fixed reserve or refund',async()=>{
 const q=await buildFstQuote({tokenIn:zero,tokenOut:usdt,amountIn:10000n,config,slippageBps:50,findRoute:async(from,to,amount)=>{assert.equal(amount,9970n);return route(from,to,amount,9970n);}});
 assert.equal(q.lpFee,30n);assert.equal(fstRequest(ethers.Interface,{router,account,quote:q,deadline:12345}).value,'0x2710');
});
test('browser null native addresses become canonical zero addresses before quoting and encoding',async()=>{
 for(const [tokenIn,tokenOut]of[[null,usdt],[usdt,null]]){
  const q=await buildFstQuote({tokenIn,tokenOut,amountIn:10000n,config,slippageBps:50,findRoute:async(from,to,amount)=>{
   assert.equal(from,tokenIn||zero);assert.equal(to,tokenOut||zero);return route(from,to,amount,9970n);
  }});
  const decoded=new ethers.Interface(FST_ABI).parseTransaction(fstRequest(ethers.Interface,{router,account,quote:q,deadline:12345}));
  assert.equal(decoded.args[0].tokenIn.toLowerCase(),tokenIn||zero);assert.equal(decoded.args[0].tokenOut.toLowerCase(),tokenOut||zero);
 }
});
test('output fee minimum is net of the one platform fee',async()=>{
 const q=await buildFstQuote({tokenIn:a,tokenOut:usdt,amountIn:1000n,config,slippageBps:50,findRoute:async(from,to,amount)=>route(from,to,amount,2000n)});
 assert.equal(q.lpFee,6n);assert.equal(q.out,1994n);assert.equal(q.minimum,1984n);
});

test('canonical native wrap and unwrap need no liquidity pool and charge input once',async()=>{
 const {quoteFstSwap,recheckFstQuote}=await import('../src/swap-fstswap.mjs');
 const request=async()=>{throw Error('a direct wrap must not query DEX liquidity');};
 for(const [tokenIn,tokenOut] of [[zero,FST_FEE_ASSETS.WBNB],[FST_FEE_ASSETS.WBNB,zero]]){
  const q=await quoteFstSwap(request,{tokenIn,tokenOut,amountIn:10000n,config,slippageBps:50});
  assert.equal(q.out,9970n);assert.equal(q.lpFee,30n);assert.equal(q.stages[0].branches[0].kind,2);
  assert.equal(q.stages[0].branches[0].adapter,zero);assert.equal(q.feeToken,tokenIn);
  const p=await recheckFstQuote(request,q,config);p.assertFresh();
 }
});

test('other/other falls back to a complete route instead of fixing a dead-end fee segment',async()=>{
 const best=route(a,usdt,1000n,2100n),fallback=route(a,usdt,1000n,2000n);best.legs[0].poolIds=['blocked'];fallback.legs[0].poolIds=['available'];
 const q=await buildFstQuote({tokenIn:a,tokenOut:b,amountIn:1000n,config,slippageBps:50,findRoute:async(from,to,amount,used)=>{
  if(from===a)return{...best,candidates:[best,fallback]};
  if(used[0].poolIds.includes('blocked'))throw Object.assign(Error('pool reused'),{code:'NO_ROUTE'});
  assert.equal(amount,1994n);return route(from,to,amount,3988n);
 }});
 assert.equal(q.out,3988n);assert.equal(q.lpFee,6n);
});
test('eligible V3 alt main pool can connect to V2 and split direct mainstream pools',async()=>{
 const {quoteFstRoutes}=await import('../src/swap-fstswap.mjs');
 const {SWAP_ABI,SWAP_ADAPTERS}=await import('../src/swap-aggregator.mjs?v=mainnet-20261110-15');
 const w=FST_FEE_ASSETS.WBNB,ps=new Map(),v3=SWAP_ADAPTERS.v3.adapter,v2=SWAP_ADAPTERS.pancake.adapter;
 ps.set('1',{address:'0x'+'11'.repeat(20),adapter:v3,kind:'v3',fee:100,token0:a,token1:w,reserves:[1000000n,1000000n],sqrt:2n**96n});
 ps.set('2',{address:'0x'+'22'.repeat(20),adapter:v2,kind:'v2',token0:w,token1:usdt,reserves:[1000000n,1000000n]});
 const policy={pools:ps,allowsRoute:legs=>legs.length>0,assertFresh(){},blockNumber:'0x1'};
 // Topology fixture assets have an explicitly trusted no-tax model. Tax-model
 // verification and rejection are exercised separately, not by this RPC stub.
 const transferTaxes=new Map([a,w,usdt].map(token=>[token,{kind:'none'}]));
 const ri=new ethers.Interface(SWAP_ABI),qi=new ethers.Interface(['function quoteExactIn(bytes,uint256) returns(uint256)']);
 const mi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
 const request=async({method,params})=>{
  assert.equal(method,'eth_call');assert.equal(params[1],'0x1');
  const calls=mi.decodeFunctionData('tryAggregate',params[0].data)[1];
  return mi.encodeFunctionResult('tryAggregate',[calls.map(c=>{
   let abi=ri,t;try{t=ri.parseTransaction({data:c.callData});}catch{}if(!t){abi=qi;t=qi.parseTransaction({data:c.callData});}
   const amount=t.name==='getAmountsOutVia'?t.args[1]:t.args[1];
   const out=amount-(amount*amount/10000n);
   return[true,abi.encodeFunctionResult(t.name,[t.name==='getAmountsOutVia'?[amount,out]:out])];
  })]);
 };
 const routed=await quoteFstRoutes(request,{from:a,to:usdt,amount:100n,policy,used:[],transferTaxes});
 assert.deepEqual(routed.legs.map(x=>x.kind),['v3','v2']);
 ps.set('3',{address:'0x'+'33'.repeat(20),adapter:v3,kind:'v3',fee:100,token0:w,token1:usdt,reserves:[1000000n,1000000n],sqrt:2n**96n});
 const split=await quoteFstRoutes(request,{from:w,to:usdt,amount:1000n,policy,used:[],transferTaxes});
 assert.equal(split.out,950n);assert.equal(split.routeStages[0].legs.length,2);
 assert.equal(split.routeStages[0].legs.reduce((v,l)=>v+l.amountIn,0n),1000n);
});

test('whole-input net-output protection includes the platform fee at submission',async()=>{
 const {validateFstQuote}=await import('../src/swap-fstswap.mjs');const {createPoolPolicy}=await import('../src/swap-liquidity.mjs?v=mainnet-20261110-15');
 const output=FST_FEE_ASSETS.USDC,scale=10n**18n,ad=(await import('../src/swap-aggregator.mjs?v=mainnet-20261110-15')).SWAP_ADAPTERS.pancake.adapter.toLowerCase();
 const id=[ad,...[usdt,output].sort(),'v2'].join(':');
 const pools=new Map([[id,{id,address:'0x'+'11'.repeat(20),adapter:ad,kind:'v2',token0:usdt,token1:output,reserves:[1000000n*scale,1000000n*scale]}]]),prices=new Map([[usdt,scale],[output,987n*scale/1000n]]);
 const q=await buildFstQuote({tokenIn:usdt,tokenOut:output,amountIn:100000n,config,slippageBps:50,findRoute:async(from,to,amount)=>({...route(from,to,amount,99700n),from,to,amountIn:amount,minimum:99201n,legs:[{adapter:ad,kind:'v2',path:[from,to],out:99700n}]})});
 const policy={...createPoolPolicy(pools,prices,usdt,output),assertFresh(){}};
 assert.throws(()=>validateFstQuote(q,config,policy),{code:'POOL_LIQUIDITY',reason:'price'});
});
