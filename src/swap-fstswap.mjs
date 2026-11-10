// FstSwap 2.0.0: exact-input only, one fee on the real main route.
import {SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter} from './swap-aggregator.mjs?v=mainnet-20261110-16';
import {readPoolPolicy,createPoolPolicy} from './swap-liquidity.mjs?v=mainnet-20261110-16';
const ZERO='0x'+'00'.repeat(20),BPS=10000n;
const lower=x=>String(x||ZERO).toLowerCase();
export const FST_FEE_ASSETS=Object.freeze({BNB:ZERO,USDT:'0x55d398326f99059ff775485246999027b3197955',FIST:'0xc9882def23bc42d53895b8361d0b1edc7570bc6a',WBNB:'0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',ETH:'0x2170ed0880ac9a755fd29b2688956bd959f933f8',USDC:'0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'});
const fees=new Set(Object.values(FST_FEE_ASSETS));
export const FST_ABI=[
 'function swapExactInput((address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,address recipient,uint256 deadline,address feeToken,uint256 configVersion) params,(address tokenIn,address tokenOut,uint256 minOut,(address adapter,uint8 kind,uint16 weightBps,address[] path,bytes v3Path)[] branches)[] stages) payable returns(uint256 received)',
 'event FeeCharged(address indexed payer,address indexed token,uint256 baseAmount,uint256 amount,uint256 stage)',
];
export function fstFeePolicy(tokenIn,tokenOut,defaultFeeToken=FST_FEE_ASSETS.USDT){
 const input=lower(tokenIn),output=lower(tokenOut),fee=lower(defaultFeeToken);
 if(fees.has(input))return{mode:'input',token:input};
 if(fees.has(output))return{mode:'output',token:output};
 if(!fees.has(fee))throw Error('不支持的默认收费币');
 return{mode:'intermediate',token:fee};
}
const isWrap=(a,b)=>[lower(a),lower(b)].sort().join(':')===[ZERO,FST_FEE_ASSETS.WBNB].sort().join(':');
const minimum=(value,bps)=>value*(BPS-BigInt(bps))/BPS;
function stagesFor(segment,from,to,slippage){
 if(segment.legs[0]?.kind==='wrap')return[{tokenIn:from,tokenOut:to,minOut:segment.out,branches:[{adapter:ZERO,kind:2,weightBps:10000,path:[],v3Path:'0x'}]}];
 const stages=segment.routeStages||segment.legs.map((leg,n)=>{
  const v3=leg.kind==='v3',path=leg.path;
  return{tokenIn:n===0?from:(v3?path.slice(0,42):path[0]),tokenOut:n+1===segment.legs.length?to:(v3?'0x'+path.slice(48):path.at(-1)),out:leg.out,legs:[{...leg,weightBps:10000}]};
 });
 return stages.map(stage=>({tokenIn:stage.tokenIn,tokenOut:stage.tokenOut,minOut:minimum(stage.out,slippage)||1n,
  branches:stage.legs.map(leg=>({adapter:leg.adapter,kind:leg.kind==='v3'?1:0,weightBps:leg.weightBps||10000,path:leg.kind==='v3'?[]:leg.path,v3Path:leg.kind==='v3'?leg.path:'0x'}))}));
}
export async function buildFstQuote({tokenIn,tokenOut,amountIn,config,slippageBps,findRoute}){
 if(config?.version!=='2.0.0'||amountIn<=0n||slippageBps<0||slippageBps>=10000)throw Error('FstSwap 报价配置无效');
 const bps=BigInt(config.platformFeeBps);if(bps<0n||bps>100n)throw Error('费率无效');
 const policy=fstFeePolicy(tokenIn,tokenOut,config.defaultFeeToken),segments=[];let fee=0n,stages=[],out;
 if(policy.mode==='intermediate'){
  const first=await findRoute(tokenIn,policy.token,amountIn,[]),complete=[];
  // Bound network work so completed routes stay inside the 20-second pool snapshot.
  // A better output dominates another quote using the same set of pools.
  const seen=new Set(),choices=(first.candidates||[first]).filter(c=>{const key=c.legs.flatMap(l=>l.poolIds||[]).map(lower).sort().join(':');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,12);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,choices.length)},async()=>{
   while(cursor<choices.length){const before=choices[cursor++],charged=before.out*bps/BPS;
    try{const after=await findRoute(policy.token,tokenOut,before.out-charged,before.legs);complete.push({before,after,charged});}
    catch(e){if(e.code!=='NO_ROUTE')throw e;}
   }
  }));
  complete.sort((a,b)=>a.after.out>b.after.out?-1:a.after.out<b.after.out?1:0);
  if(!complete.length)throw Object.assign(Error('没有可执行的完整收费路线'),{code:'NO_ROUTE'});
  const {before,after,charged}=complete[0];fee=charged;segments.push(before,after);
  stages=[...stagesFor(before,tokenIn,policy.token,slippageBps),...stagesFor(after,policy.token,tokenOut,slippageBps)];out=after.out;
 }else{
  if(policy.mode==='input')fee=amountIn*bps/BPS;
  const segment=await findRoute(tokenIn,tokenOut,amountIn-fee,[]);segments.push(segment);
  if(policy.mode==='output')fee=segment.out*bps/BPS;
  out=segment.out-(policy.mode==='output'?fee:0n);stages=stagesFor(segment,tokenIn,tokenOut,slippageBps);
 }
 if(stages.length>6||!stages.length||out<=0n)throw Error('没有可执行的兑换路线');
 const impact=1-segments.reduce((v,s)=>v*(1-s.impact),1);
 if(!Number.isFinite(impact)||impact<0)throw Error('无法确认兑换价格影响');
 return{kind:'fstswap',tokenIn,tokenOut,amountIn,out,minimum:minimum(out,slippageBps),lpFee:fee,feeToken:policy.token,feeMode:policy.mode,configVersion:config.feeConfigVersion,
  stages,segments,impact,first:segments[0].legs[0],second:segments[0].legs[1],assertFresh(){segments.forEach(s=>s.assertFresh());}};
}
export function fstRequest(Interface,{router,account,quote,deadline}){
 const p={tokenIn:quote.tokenIn,tokenOut:quote.tokenOut,amountIn:quote.amountIn,minOut:quote.minimum,recipient:account,deadline,feeToken:quote.feeToken,configVersion:quote.configVersion};
 return{from:account,to:router,data:new Interface(FST_ABI).encodeFunctionData('swapExactInput',[p,quote.stages]),value:'0x'+(lower(p.tokenIn)===ZERO?p.amountIn:0n).toString(16)};
}

const noRoute=()=>Object.assign(Error('没有符合流动性要求的完整兑换路线'),{code:'NO_ROUTE'});
// Quote only pools admitted by the independent-price/depth policy. Every call uses its snapshot block.
export async function quoteFstRoutes(request,{from,to,amount,policy,used=[],singleHop=false}){
 const input=lower(from),output=lower(to),taken=new Set(used.flatMap(l=>l.poolIds||[]).map(lower));
 const edges=[];
 for(const pool of policy.pools.values()){
  if(taken.has(lower(pool.address)))continue;
  const dex=Object.values(SWAP_ADAPTERS).find(d=>lower(d.adapter)===lower(pool.adapter));if(!dex)continue;
  for(const [a,b] of [[pool.token0,pool.token1],[pool.token1,pool.token0]]){
   const tokenIn=input===ZERO&&lower(a)===lower(dex.weth)?ZERO:lower(a);
   const tokenOut=output===ZERO&&lower(b)===lower(dex.weth)?ZERO:lower(b);
   const path=pool.kind==='v3'?'0x'+a.slice(2)+pool.fee.toString(16).padStart(6,'0')+b.slice(2):[a,b];
   edges.push({adapter:pool.adapter,kind:pool.kind,path,tokenIn,tokenOut,poolIds:[pool.address],pool});
  }
 }
 const routes=[];
 function visit(token,legs,seen){
  if(legs.length>=(singleHop?1:3))return;
  for(const edge of edges){
   if(edge.tokenIn!==token||seen.has(edge.tokenOut)||legs.some(l=>lower(l.poolIds[0])===lower(edge.poolIds[0])))continue;
   const next=[...legs,edge];
   if(edge.tokenOut===output){if(policy.allowsRoute(next))routes.push(next);}
   else visit(edge.tokenOut,next,new Set([...seen,edge.tokenOut]));
  }
 }
 visit(input,[],new Set([input]));if(!routes.length)throw noRoute();
 const E=globalThis.ethers,router=new E.Interface(SWAP_ABI),quoter=new E.Interface(['function quoteExactIn(bytes,uint256) returns(uint256)']);
 const multicall=new E.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
 const quoteKey=(l,a)=>[l.adapter,l.kind,typeof l.path==='string'?l.path:l.path.join(':'),a].join(':').toLowerCase(),cache=new Map();
 async function fill(items){
  const pending=[...new Map(items.filter(({leg,amount})=>amount>0n&&!cache.has(quoteKey(leg,amount))).map(x=>[quoteKey(x.leg,x.amount),x])).values()];
  for(let start=0;start<pending.length;start+=80){
   const batch=pending.slice(start,start+80),calls=batch.map(({leg,amount})=>leg.kind==='v3'?[leg.adapter,quoter.encodeFunctionData('quoteExactIn',[leg.path,amount])]:[swapActiveRouter(),router.encodeFunctionData('getAmountsOutVia',[leg.adapter,amount,leg.path])]);
   const raw=await request({method:'eth_call',params:[{to:'0xcA11bde05977b3631167028862bE2a173976CA11',data:multicall.encodeFunctionData('tryAggregate',[false,calls])},policy.blockNumber]});
   const entries=multicall.decodeFunctionResult('tryAggregate',raw)[0];if(entries.length!==batch.length)throw Error('报价返回不完整');
   batch.forEach(({leg,amount},n)=>{
    let out=0n;try{if(entries[n].success){if(leg.kind==='v3')out=quoter.decodeFunctionResult('quoteExactIn',entries[n].returnData)[0];else{const values=router.decodeFunctionResult('getAmountsOutVia',entries[n].returnData)[0];if(values.length===2&&values[0]===amount)out=values[1];}}}catch{}
    cache.set(quoteKey(leg,amount),out);
   });
  }
 }
 const work=routes.map(legs=>({legs,quoted:[],out:amount}));
 for(let depth=0;depth<3;depth++){
  await fill(work.filter(r=>r.out>0n&&r.legs[depth]).map(r=>({leg:r.legs[depth],amount:r.out})));
  for(const r of work){const leg=r.legs[depth];if(!leg||r.out<=0n)continue;const before=r.out;r.out=cache.get(quoteKey(leg,before))||0n;r.quoted.push({...leg,amountIn:before,out:r.out,weightBps:10000});}
 }
 const candidates=work.filter(r=>r.out>0n).map(r=>({out:r.out,legs:r.quoted,routeStages:r.quoted.map(l=>({tokenIn:l.tokenIn,tokenOut:l.tokenOut,out:l.out,legs:[l]}))}));
 // Parallel direct pools share the same stage; its final branch receives the exact remainder.
 const direct=routes.filter(r=>r.length===1).map(r=>r[0]),splits=[];
 for(let i=0;i<direct.length;i++)for(let j=i+1;j<direct.length;j++)for(const weight of[2500,5000,7500]){
  const a=amount*BigInt(weight)/BPS,b=amount-a;if(a===0n||b===0n)continue;
  splits.push([{leg:direct[i],amount:a,weight},{leg:direct[j],amount:b,weight:10000-weight}]);
 }
 await fill(splits.flat());
 for(const split of splits){
  const legs=split.map(({leg,amount,weight})=>({...leg,amountIn:amount,out:cache.get(quoteKey(leg,amount))||0n,weightBps:weight}));if(legs.some(l=>l.out<=0n))continue;
  const out=legs.reduce((a,l)=>a+l.out,0n);candidates.push({out,legs,routeStages:[{tokenIn:from,tokenOut:to,out,legs}]});
 }
 function spot(leg,amount){const p=leg.pool,forward=lower(p.token0)===(leg.kind==='v3'?lower(leg.path.slice(0,42)):lower(leg.path[0]));return p.kind==='v3'?(forward?amount*p.sqrt*p.sqrt/(2n**192n):amount*(2n**192n)/(p.sqrt*p.sqrt)):amount*p.reserves[forward?1:0]/p.reserves[forward?0:1];}
 for(const c of candidates){
  let expected=amount;
  for(const stage of c.routeStages){let allocated=0n;expected=stage.legs.reduce((sum,l,n)=>{const part=n+1===stage.legs.length?expected-allocated:expected*BigInt(l.weightBps)/BPS;allocated+=part;return sum+spot(l,part);},0n);}
  if(expected<=0n){c.out=0n;c.impact=NaN;continue;}
  c.impact=c.out>=expected?0:Number((expected-c.out)*100000000n/expected)/100000000;
  c.from=from;c.to=to;c.amountIn=amount;c.assertFresh=()=>policy.assertFresh();
 }
 const valid=candidates.filter(c=>c.out>0n&&Number.isFinite(c.impact)).sort((a,b)=>a.out>b.out?-1:a.out<b.out?1:a.legs.length-b.legs.length);
 if(!valid.length)throw noRoute();policy.assertFresh();return{...valid[0],candidates:valid};
}
export async function quoteFstSwap(request,{tokenIn,tokenOut,amountIn,config,slippageBps,singleHop=false}){
 const wrap=isWrap(tokenIn,tokenOut);
 const whole=wrap?null:await readPoolPolicy(request,{tokenIn,tokenOut,config,extraTokens:[config.defaultFeeToken]});
 const findRoute=async(from,to,amount,used)=>{
  if(isWrap(from,to))return{from,to,amountIn:amount,minimum:amount,out:amount,impact:0,legs:[{kind:'wrap',out:amount,amountIn:amount}],assertFresh(){}};
  const policy={...whole,...createPoolPolicy(whole.pools,whole.prices,from,to)};
  const routes=await quoteFstRoutes(request,{from,to,amount,used,policy,singleHop});
  const valid=routes.candidates.filter(c=>{c.minimum=minimum(c.out,slippageBps);try{policy.assertValue(c.amountIn,c.minimum);return true;}catch{return false;}});
  if(!valid.length)throw noRoute();return{...valid[0],candidates:valid};
 };
 const q=await buildFstQuote({tokenIn,tokenOut,amountIn,config,slippageBps,findRoute});
 whole?.assertValue(q.amountIn,q.minimum);q.assertFresh();return q;
}
export function validateFstQuote(quote,config,policy){
 if(config.version!=='2.0.0'||BigInt(config.feeConfigVersion)!==BigInt(quote.configVersion))throw Error('收费配置已变化，请刷新报价');
 const fee=fstFeePolicy(quote.tokenIn,quote.tokenOut,config.defaultFeeToken);
 if(fee.token!==quote.feeToken||fee.mode!==quote.feeMode)throw Error('收费资产已变化，请刷新报价');
 if(isWrap(quote.tokenIn,quote.tokenOut)&&quote.stages.length===1&&quote.stages[0].branches[0].kind===2)return{assert(){},assertValue(){},assertFresh(){}};
 for(const s of quote.segments){
  const part=createPoolPolicy(policy.pools,policy.prices,s.from,s.to);part.assertRoute(s.legs);part.assertValue(s.amountIn,s.minimum);
 }
 policy.assertValue(quote.amountIn,quote.minimum);policy.assertFresh();
 return{assert(){},assertValue:(a,b)=>policy.assertValue(a,b),assertFresh:()=>policy.assertFresh()};
}
export async function recheckFstQuote(request,quote,config){
 const policy=isWrap(quote.tokenIn,quote.tokenOut)?null:await readPoolPolicy(request,{tokenIn:quote.tokenIn,tokenOut:quote.tokenOut,config,extraTokens:[config.defaultFeeToken]});
 return validateFstQuote(quote,config,policy);
}
