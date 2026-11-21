import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ethers} from 'ethers';
import {quoteFstRoutes,fstRequiresLinearV2,FST_FEE_ASSETS,buildFstQuote,fstServiceQuote} from '../src/swap-fstswap.mjs';
import {SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter} from '../src/swap-aggregator.mjs?v=mainnet-20261113-47';

globalThis.ethers=ethers;
const ROOT=new URL('..',import.meta.url);
// Compare complete outputs with the immutable production implementation, rather
// than inferring equivalence only from the number of network requests.
const production=execFileSync('git',['show','55171037d175247a2d3ce52f6982314b906be91d:src/swap-fstswap.mjs'],{cwd:ROOT,encoding:'utf8'});
const productionFunction=production.slice(production.indexOf('export async function quoteFstRoutes('),production.indexOf('\nexport async function quoteFstSwap(')).replace('export async function','async function');
const baseline=new Function('SWAP_ADAPTERS','SWAP_ABI','swapActiveRouter','fstRequiresLinearV2',
 `const ZERO='0x'+'00'.repeat(20),BPS=10000n;const lower=x=>String(x||ZERO).toLowerCase();const noRoute=()=>Object.assign(Error('no route'),{code:'NO_ROUTE'});${productionFunction};return quoteFstRoutes;`)(SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter,fstRequiresLinearV2);

const IN=FST_FEE_ASSETS.USDT,OUT=FST_FEE_ASSETS.USDC,BRIDGE=FST_FEE_ASSETS.WBNB,ALT='0x'+'aa'.repeat(20);
const router=new ethers.Interface(SWAP_ABI);
const quoter=new ethers.Interface(['function quoteExactIn(bytes,uint256) returns(uint256)']);
const multicall=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const addr=n=>'0x'+n.toString(16).padStart(40,'0');

function fixture({output=OUT,v3=false,bad,short=false,stale=false,curve}={}){
 const pools=new Map();
 const add=(n,adapter,token0,token1,kind='v2')=>pools.set(String(n),{address:addr(n),adapter,token0,token1,kind,fee:100,reserves:[1000000n,1000000n],sqrt:2n**96n});
 add(1,SWAP_ADAPTERS.fst.adapter,IN,output);
 add(2,SWAP_ADAPTERS.pancake.adapter,IN,output);
 add(3,SWAP_ADAPTERS.fst.adapter,IN,BRIDGE);
 add(4,SWAP_ADAPTERS.pancake.adapter,BRIDGE,output);
 if(v3)add(5,SWAP_ADAPTERS.v3.adapter,IN,output,'v3');
 const calls=[];
 let freshnessChecks=0;
 const policy={pools,blockNumber:'0x123',allowsRoute:legs=>legs.length>0,assertFresh(){freshnessChecks++;if(stale)throw Object.assign(Error('stale'),{code:'POOL_LIQUIDITY',reason:'stale'});}};
 const request=async({method,params})=>{
  assert.equal(method,'eth_call');assert.equal(params[1],policy.blockNumber);
  assert.equal(params[0].to.toLowerCase(),'0xca11bde05977b3631167028862be2a173976ca11');
  const [requireSuccess,batch]=multicall.decodeFunctionData('tryAggregate',params[0].data);assert.equal(requireSuccess,false);
  const decoded=batch.map(c=>{
   const isV2=c.target.toLowerCase()===swapActiveRouter().toLowerCase();
   const abi=isV2?router:quoter,tx=abi.parseTransaction({data:c.callData});
   const amount=tx.args[1];
   return {kind:isV2?'v2':'v3',adapter:isV2?tx.args[0].toLowerCase():c.target.toLowerCase(),path:isV2?[...tx.args[2]].map(t=>t.toLowerCase()):tx.args[0].toLowerCase(),amount,abi,method:tx.name};
  });
  calls.push(decoded);
  const entries=decoded.map(d=>{
   const failure=bad?.(d);
   if(failure==='revert')return[false,'0x'];
   if(failure==='malformed')return[true,'0x1234'];
   const out=failure==='zero'?0n:(curve?.(d)??(d.amount-d.amount*d.amount/100000n-d.amount*3n/1000n));
   const returnedInput=failure==='wrong-input'?d.amount+1n:d.amount;
   return[true,d.abi.encodeFunctionResult(d.method,[d.kind==='v2'?[returnedInput,out]:out])];
  });
  return multicall.encodeFunctionResult('tryAggregate',[short?entries.slice(1):entries]);
 };
 return {pools,policy,request,calls,get freshnessChecks(){return freshnessChecks;}};
}

// These synthetic route-topology fixtures deliberately model ordinary tokens;
// unverified transfer-tax behavior has its own rejection regression coverage.
const options=(f,extra={})=>({from:IN,to:OUT,amount:10000n,policy:f.policy,configVersion:'2.1.0',transferTaxes:new Map([...f.policy.pools.values()].flatMap(pool=>[pool.token0,pool.token1]).map(token=>[token,{kind:'none'}])),...extra});
function comparable(result){
 const leg=l=>({adapter:l.adapter,kind:l.kind,path:l.path,poolIds:l.poolIds,tokenIn:l.tokenIn,tokenOut:l.tokenOut,amountIn:l.amountIn,out:l.out,weightBps:l.weightBps});
 const candidate=c=>({out:c.out,impact:c.impact,from:c.from,to:c.to,amountIn:c.amountIn,legs:c.legs.map(leg),stages:c.routeStages.map(s=>({tokenIn:s.tokenIn,tokenOut:s.tokenOut,out:s.out,legs:s.legs.map(leg)}))});
 return {winner:candidate(result),candidates:result.candidates.map(candidate)};
}

test('direct split joins the first layer and removes a serial round without changing candidates',async()=>{
 const old=fixture(),next=fixture();
 const before=await baseline(old.request,options(old));
 const after=await quoteFstRoutes(next.request,options(next));
 assert.equal(old.calls.length,3,'immutable production fixture must exercise the former split round');
 assert.deepEqual(old.calls.map(c=>c.length),[3,1,6]);
 assert.equal(next.calls.length,2,'all direct split inputs are known before the first response');
 assert.deepEqual(next.calls.map(c=>c.length),[9,1]);
 assert.deepEqual(comparable(after),comparable(before));
 assert.equal(after.candidates.length,6);
 assert.equal(after.routeStages[0].legs.length,2,'nonlinear outputs must exercise a split winner');
 assert.ok(next.calls[0].some(c=>c.amount===2500n));
 assert.ok(next.calls[0].some(c=>c.amount===5000n));
 assert.ok(next.calls[0].some(c=>c.amount===7500n));
 assert.ok(next.freshnessChecks>0);
});

for(const amount of [1n,3n,10001n])test(`split integer remainder is exact at input ${amount}`,async()=>{
 const old=fixture({v3:true}),next=fixture({v3:true});
 const before=await baseline(old.request,options(old,{amount}));
 const after=await quoteFstRoutes(next.request,options(next,{amount}));
 assert.deepEqual(comparable(after),comparable(before));
 for(const c of after.candidates)for(const stage of c.routeStages)if(stage.legs.length>1){
  assert.equal(stage.legs.reduce((sum,l)=>sum+l.amountIn,0n),amount);
  assert.equal(stage.legs.reduce((sum,l)=>sum+l.weightBps,0),10000);
  assert.equal(stage.legs[0].amountIn,amount*BigInt(stage.legs[0].weightBps)/10000n);
  assert.equal(stage.legs[1].amountIn,amount-stage.legs[0].amountIn);
  assert.ok(stage.legs.every(l=>l.amountIn>0n));
 }
});

for(const failure of ['revert','zero','malformed','wrong-input'])test(`invalid ${failure} split branch cannot become a winner`,async()=>{
 const bad=d=>d.kind==='v2'&&d.adapter===SWAP_ADAPTERS.pancake.adapter.toLowerCase()&&d.path[0]===IN&&d.path[1]===OUT&&d.amount<10000n?failure:null;
 const old=fixture({bad}),next=fixture({bad});
 const before=await baseline(old.request,options(old));
 const after=await quoteFstRoutes(next.request,options(next));
 assert.deepEqual(comparable(after),comparable(before));
 assert.ok(after.candidates.every(c=>c.routeStages.every(s=>s.legs.length===1)));
});

test('eligible V3 and V2 candidates remain identical with early split batching',async()=>{
 const old=fixture({v3:true}),next=fixture({v3:true});
 const before=await baseline(old.request,options(old));
 const after=await quoteFstRoutes(next.request,options(next));
 assert.deepEqual(comparable(after),comparable(before));
 assert.ok(after.candidates.some(c=>c.legs.some(l=>l.kind==='v3')));
 assert.ok(after.candidates.some(c=>c.routeStages.some(s=>s.legs.length===2)));
});

test('complete staged quote preserves fee, minOut, exact budget and execution DTO',async()=>{
 const config={version:'2.1.0',platformFeeBps:30,defaultFeeToken:IN,feeConfigVersion:4n};
 const quote=async(fn,f)=>buildFstQuote({tokenIn:IN,tokenOut:OUT,amountIn:10001n,config,slippageBps:50,
  findRoute:(from,to,amount,used,routeOptions)=>fn(f.request,{from,to,amount,used,policy:f.policy,configVersion:config.version,...routeOptions})});
 const before=await quote(baseline,fixture({v3:true}));
 const after=await quote(quoteFstRoutes,fixture({v3:true}));
 assert.deepEqual(fstServiceQuote(after,{slippageBps:50,poolCheckedAt:1000}),fstServiceQuote(before,{slippageBps:50,poolCheckedAt:1000}));
 assert.equal(after.lpFee,30n);
 assert.equal(after.segments[0].amountIn,9971n);
 assert.equal(after.minimum,after.out*9950n/10000n);
 assert.ok(after.stages.every(s=>s.minOut>0n));
});

test('2.1 unknown tokens retain linear V2 routes and do not generate split calls',async()=>{
 const old=fixture({output:ALT,v3:true}),next=fixture({output:ALT,v3:true});
 const before=await baseline(old.request,options(old,{to:ALT}));
 const after=await quoteFstRoutes(next.request,options(next,{to:ALT}));
 assert.deepEqual(comparable(after),comparable(before));
 assert.ok(after.candidates.every(c=>c.routeStages.every(s=>s.legs.length===1&&s.legs[0].kind==='v2')));
 assert.deepEqual(next.calls[0].map(c=>c.amount),[10000n,10000n,10000n]);
 assert.equal(next.calls.flat().filter(c=>c.kind==='v3').length,0);
});

test('single-hop and disabled adapters retain the original route selection',async()=>{
 for(const extra of [{singleHop:true},{adaptersOff:['pancake']},{linearV2Only:true}]){
  const old=fixture({v3:true}),next=fixture({v3:true});
  const before=await baseline(old.request,options(old,extra));
  const after=await quoteFstRoutes(next.request,options(next,extra));
  assert.deepEqual(comparable(after),comparable(before));
 }
});

test('policy-admitted routes still restrict every split and multi-hop candidate',async()=>{
 const old=fixture({v3:true}),next=fixture({v3:true});
 for(const f of [old,next])f.policy.allowsRoute=legs=>legs.every(l=>l.adapter.toLowerCase()===SWAP_ADAPTERS.fst.adapter.toLowerCase());
 const before=await baseline(old.request,options(old));
 const after=await quoteFstRoutes(next.request,options(next));
 assert.deepEqual(comparable(after),comparable(before));
 assert.equal(after.candidates.length,1);
 assert.ok(next.calls.flat().every(c=>c.adapter===SWAP_ADAPTERS.fst.adapter.toLowerCase()));
});

test('incomplete aggregate response and all-failed calls remain rejected',async()=>{
 for(const build of [()=>fixture({short:true}),()=>fixture({bad:()=> 'malformed'})]){
  const old=build(),next=build();
  await assert.rejects(baseline(old.request,options(old)));
  await assert.rejects(quoteFstRoutes(next.request,options(next)));
 }
});

test('freshness policy still rejects a quote after the same calls',async()=>{
 const next=fixture({stale:true});
 await assert.rejects(quoteFstRoutes(next.request,options(next)),{code:'POOL_LIQUIDITY',reason:'stale'});
});
