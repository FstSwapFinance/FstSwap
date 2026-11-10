// Pool admission policy. All reserves and oracle rounds are read at one BSC block.
import { SWAP_ABI, SWAP_ADAPTERS, SWAP_TOKENS, swapActiveRouter } from './swap-aggregator.mjs?v=mainnet-20261111-22';
const ZERO='0x'+'00'.repeat(20),MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11';
const lower=x=>String(x||ZERO).toLowerCase();
const USDT=lower(SWAP_TOKENS.usdt.address),USDC='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const BTCB='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',ETH='0x2170ed0880ac9a755fd29b2688956bd959f933f8';
const WRAPPED=[...new Set(Object.values(SWAP_ADAPTERS).map(x=>lower(x.weth)))];
export const MAINSTREAM_TOKENS=new Set([ZERO,...WRAPPED,USDT,USDC,BTCB,ETH]);
export const MIN_POOL_USD=100000n;
const SCALE=10n**18n;
const FIST=lower(SWAP_TOKENS.fist.address);
// Chainlink BSC directory, verified 2026-11-10; prices are validated on chain, never inferred from the candidate pool.
const FEEDS=[
 {tokens:WRAPPED,address:'0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',maxAge:180},
 {tokens:[USDT],address:'0xB97Ad0E74fa7d920791E90258A6E2085088b4320',maxAge:2700},
 {tokens:[USDC],address:'0x51597f405303C4377E36123cBc172b13269EA163',maxAge:2700},
 {tokens:[BTCB],address:'0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf',maxAge:180},
 {tokens:[ETH],address:'0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',maxAge:180},
];
const fail=(message,reason='liquidity',retryable=false)=>Object.assign(new Error(message),{code:'POOL_LIQUIDITY',reason,retryable});
const key=(adapter,a,b,fee='v2')=>[lower(adapter),...[lower(a),lower(b)].sort(),String(fee)].join(':');
export function poolLiquidityUsd(pool,prices){
 const values=[pool.token0,pool.token1].map((token,n)=>{const p=prices.get(lower(token));return p?pool.reserves[n]*p/SCALE:null;});
 if([pool.token0,pool.token1].some((token,n)=>MAINSTREAM_TOKENS.has(lower(token))&&values[n]===null))return 0n;
 const known=values.filter(x=>x!==null);if(!known.length)return 0n;
 // Two-sided depth is capped by the smaller independently valued reserve; an unknown altcoin is valued from the known side only.
 return 2n*known.reduce((a,b)=>a<b?a:b);
}
function fistReferencePrice(pools,prices,tokenIn,tokenOut){
 if(![lower(tokenIn),lower(tokenOut)].some(t=>t!==FIST&&!MAINSTREAM_TOKENS.has(t)))return null;
 const reference=pools.get(key(SWAP_ADAPTERS.fst.adapter,FIST,USDT));
 if(!reference||poolLiquidityUsd(reference,prices)<=MIN_POOL_USD*SCALE)return null;
 const fistIndex=reference.token0===FIST?0:1,usdIndex=1-fistIndex,p=prices.get(USDT);
 if(!p||reference.reserves[fistIndex]<=0n)return null;
 const price=reference.reserves[usdIndex]*p/reference.reserves[fistIndex];
 return price>0n?price:null;
}
export function createPoolPolicy(pools,prices,tokenIn,tokenOut,{tradeTokenIn=tokenIn}={}){
 const endpoints=[lower(tokenIn),lower(tokenOut)];
 const references=new Set(MAINSTREAM_TOKENS);
 // Only a separate canonical FstSwap FIST/USDT pool above $100k may value
 // FIST-quoted alts. Never derive this reference recursively from candidate alts.
 const reference=fistReferencePrice(pools,prices,tokenIn,tokenOut);
 if(reference){prices=new Map(prices);prices.set(FIST,reference);references.add(FIST);}
 const alts=endpoints.filter(t=>!references.has(t));
 const main=new Map();
 for(const pool of pools.values()){
  pool.usd=poolLiquidityUsd(pool,prices);
  const p0=prices.get(pool.token0),p1=prices.get(pool.token1);
  pool.priceAligned=!(references.has(pool.token0)&&!p0||references.has(pool.token1)&&!p1);
  if(references.has(pool.token0)&&references.has(pool.token1)&&p0&&p1){
   const a=pool.kind==='v3'?2n**192n*p0:pool.reserves[0]*p0;
   const b=pool.kind==='v3'?pool.sqrt*pool.sqrt*p1:pool.reserves[1]*p1;
   pool.priceAligned=!!p0&&!!p1&&a>0n&&b*100n>=a*98n&&b*100n<=a*102n;
  }
  for(const alt of alts)if([pool.token0,pool.token1].includes(alt)&&pool.usd>0n){
   const other=pool.token0===alt?pool.token1:pool.token0;
   if(references.has(other)&&(!main.has(alt)||pool.usd>main.get(alt).usd))main.set(alt,pool);
  }
 }
 // FIST buys of an FstSwap main-pool token stay on FstSwap for the entire
 // route, including bridges. Use this same admission rule for quote selection
 // and the fresh preflight so a competing quote cannot switch the execution DEX.
 const targetMain=main.get(endpoints[1]);
 const fstOnly=lower(tradeTokenIn)===FIST&&lower(targetMain?.adapter||targetMain?.id?.split(':')[0])===lower(SWAP_ADAPTERS.fst.adapter);
 const edges=leg=>{
  if(!leg)return[];
  if(leg.kind==='v3'){
   if(!/^0x[0-9a-f]{86}$/i.test(leg.path))return[null];
   return[pools.get(key(leg.adapter,leg.path.slice(0,42),'0x'+leg.path.slice(48),parseInt(leg.path.slice(42,48),16)))];
  }
  if(!Array.isArray(leg.path)||leg.path.length<2)return[null];
  return leg.path.slice(1).map((b,n)=>pools.get(key(leg.adapter,leg.path[n],b)));
 };
 const allowsRoute=legs=>{
  if(fstOnly&&legs.some(leg=>lower(leg?.adapter)!==lower(SWAP_ADAPTERS.fst.adapter)))return false;
  const route=legs.flatMap(edges);if(!route.length||route.some(p=>!p||p.usd<=0n||!p.priceAligned||p.depthVerified===false))return false;
  for(const pool of route){
   const a=[pool.token0,pool.token1].filter(t=>!references.has(t));
   if(a.length){if(a.some(t=>!alts.includes(t)||main.get(t)?.id!==pool.id))return false;}
   else if(pool.usd<=MIN_POOL_USD*SCALE)return false;
  }
  return alts.every(t=>route.some(p=>p.id===main.get(t)?.id));
 };
 const allows=(first,second)=>allowsRoute([first,second].filter(Boolean));
 const assertValue=(amountIn,amountOut)=>{
  if(alts.length)return;
  const input=prices.get(endpoints[0]===ZERO?WRAPPED[0]:endpoints[0]),output=prices.get(endpoints[1]===ZERO?WRAPPED[0]:endpoints[1]);
  if(!input||!output||amountIn<=0n||amountOut<=0n)throw fail('无法核对独立参考价格','oracle',true);
  if(amountOut*output*100n<amountIn*input*98n)throw fail('成交下限偏离独立参考价格超过 2%，请减少金额或滑点','price');
 };
 return{pools,prices,main,allows,allowsRoute,assertRoute(legs){if(!allowsRoute(legs))throw fail('池子流动性不足或不是主池，请刷新报价');},assertValue,assert(first,second){if(!allows(first,second))throw fail('池子流动性不足或不是主池，请刷新报价');}};
}

export async function readPoolPolicy(request,{tokenIn,tokenOut,config,extraTokens=[],v3Mode='all',clock=Date.now}){
 const now=clock();
 const E=globalThis.ethers,router=new E.Interface(SWAP_ABI);
 const iface=new E.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
  'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)',
  'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
  'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)',
  'function token0() view returns(address)','function token1() view returns(address)','function balanceOf(address) view returns(uint256)']);
 const block=await request({method:'eth_getBlockByNumber',params:['latest',false]});
 const timestamp=Number(BigInt(block?.timestamp||0));
 if(!block?.number||Math.abs(now/1000-timestamp)>120)throw fail('节点区块过期，无法检查流动性','stale',true);
 const batch=async calls=>{
  if(!calls.length)return[];
  if(calls.length>80){const parts=[];for(let n=0;n<calls.length;n+=80)parts.push(calls.slice(n,n+80));return(await Promise.all(parts.map(batch))).flat();}
  const raw=await request({method:'eth_call',params:[{to:MULTICALL,data:iface.encodeFunctionData('tryAggregate',[false,calls.map(c=>[c.target,c.data])])},block.number]});
  const entries=iface.decodeFunctionResult('tryAggregate',raw)[0];if(entries.length!==calls.length)throw fail('池子数据不完整','data',true);
  return entries.map((r,n)=>{
   if(!r.success)return null;try{return(calls[n].iface||iface).decodeFunctionResult(calls[n].method,r.returnData);}catch{return null;}
  });
 };
 const call=(target,method,args=[],abi=iface)=>({target,method,iface:abi,data:abi.encodeFunctionData(method,args)});
 const needsFistReference=[lower(tokenIn),lower(tokenOut)].some(t=>t!==FIST&&!MAINSTREAM_TOKENS.has(t));
 const anchors=[USDT,USDC,...WRAPPED,BTCB,ETH,...(needsFistReference?[FIST]:[])],tokens=[...new Set([lower(tokenIn),lower(tokenOut),...extraTokens.map(lower),...anchors].filter(t=>t!==ZERO))];
 // The v10 UI executes generic pairs through V2 and only quotes direct BNB/FIST
 // on V3. Still discover every competing V3 main pool for either altcoin.
 const v3Alts=v3Mode==='legacy'?[lower(tokenIn),lower(tokenOut)].filter(t=>!MAINSTREAM_TOKENS.has(t)):null;
 const v3=SWAP_ADAPTERS.v3,includeV3=v3&&!config?.adaptersOff?.includes('v3')&&(!v3Alts||v3Alts.length>0);
 const specs=[],seen=new Set();
 for(const item of Object.values(SWAP_ADAPTERS)){
  if(item.v3||config?.adaptersOff?.includes(item.key))continue;
  for(const a of tokens)for(const b of tokens){if(a===b)continue;const id=key(item.adapter,a,b);if(seen.has(id))continue;seen.add(id);specs.push({id,adapter:item.adapter,a,b});}
 }
 // V3 discovery depends on its factory, not on V2 reserves or oracle responses.
 const readV3State=async()=>{
  const [factoryResult]=await batch([call('0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997','factory')]);
  if(!factoryResult||lower(factoryResult[0])===ZERO)throw fail('无法读取 V3 池列表','data',true);
  const v3Specs=[];
  for(let n=0;n<tokens.length;n++)for(let j=n+1;j<tokens.length;j++)for(const fee of[100,500,2500,10000]){
   const a=tokens[n],b=tokens[j];if(v3Alts&&!v3Alts.includes(a)&&!v3Alts.includes(b))continue;
   v3Specs.push({id:key(v3.adapter,a,b,fee),adapter:v3.adapter,a,b,fee});
  }
  const addresses=await batch(v3Specs.map(p=>call(factoryResult[0],'getPool',[p.a,p.b,p.fee])));
  if(addresses.some(r=>!r))throw fail('V3 池发现不完整','data',true);
  const existing=addresses.flatMap((r,n)=>r&&lower(r[0])!==ZERO?[{...v3Specs[n],address:lower(r[0])}]:[]);
  const states=await batch(existing.flatMap(p=>[call(p.address,'slot0'),call(p.address,'liquidity'),call(p.address,'token0'),call(p.address,'token1'),call(p.a,'balanceOf',[p.address]),call(p.b,'balanceOf',[p.address])]));
  if(states.some(r=>!r))throw fail('部分 V3 池读取失败，无法确定主池','data',true);
  return{existing,states};
 };
 const [oracle,results,v3State]=await Promise.all([
  batch(FEEDS.flatMap(f=>[call(f.address,'latestRoundData'),call(f.address,'decimals')])),
  batch(specs.map(p=>call(swapActiveRouter(),'getPairInfo',[p.adapter,p.a,p.b,ZERO],router))),
  includeV3?readV3State():null,
 ]);
 const prices=new Map(),expiry=[];
 FEEDS.forEach((f,n)=>{
  const round=oracle[n*2],decimals=oracle[n*2+1]?.[0];if(!round||decimals==null)return;
  const updated=Number(round[3]);
  if(round[1]<=0n||round[4]<round[0]||updated<=0||updated>timestamp||timestamp-updated>f.maxAge||decimals>18n)return;
  for(const token of f.tokens)prices.set(token,round[1]*SCALE/10n**decimals);
  expiry.push(updated+f.maxAge);
 });
 // Require independent prices for the liquid anchors used to compare main pools.
 if([...MAINSTREAM_TOKENS].filter(t=>t!==ZERO).some(t=>!prices.has(t)))throw fail('价格数据过期或不可用，暂停报价','oracle',true);
 if(results.some(r=>!r))throw fail('部分池子读取失败，无法确定主池','data',true);
 const pools=new Map();results.forEach((r,n)=>{
  const p=specs[n];if(!r||lower(r[0])===ZERO||r[3]<=0n||r[4]<=0n)return;
  if(![lower(r[1]),lower(r[2])].includes(p.a)||![lower(r[1]),lower(r[2])].includes(p.b))return;
  pools.set(p.id,{...p,address:lower(r[0]),token0:lower(r[1]),token1:lower(r[2]),reserves:[r[3],r[4]],kind:'v2'});
 });
 // V3 depth probes need the same external FIST reference as main-pool ranking.
 const fistPrice=fistReferencePrice(pools,prices,tokenIn,tokenOut);
 if(fistPrice)prices.set(FIST,fistPrice);
 // V3 main pools are discovered as well; never silently choose a thin V2 pool when a stronger V3 pool exists.
 if(includeV3){
  const {existing,states}=v3State;
  existing.forEach((p,n)=>{
   const [s,l,t0,t1,ba,bb]=states.slice(n*6,n*6+6);if(!s||!l||!t0||!t1||!ba||!bb||s[0]<=0n||l[0]<=0n)return;
   const token0=lower(t0[0]),token1=lower(t1[0]);if(![token0,token1].includes(p.a)||![token0,token1].includes(p.b))return;
   const virtual=[l[0]*(2n**96n)/s[0],l[0]*s[0]/(2n**96n)],balances=token0===p.a?[ba[0],bb[0]]:[bb[0],ba[0]];
   pools.set(p.id,{...p,token0,token1,kind:'v3',sqrt:s[0],depthVerified:false,reserves:virtual.map((v,k)=>v<balances[k]?v:balances[k])});
  });
  // A high current-tick L or out-of-range balances alone do not establish executable depth.
  // Probe $500 in both directions through QuoterV2, which traverses initialized ticks.
  const probes=[];
  for(const pool of pools.values())if(pool.kind==='v3'){
   const p0=prices.get(pool.token0),p1=prices.get(pool.token1),usd=500n*SCALE;
   let amount0=p0?usd*SCALE/p0:null,amount1=p1?usd*SCALE/p1:null;
   if(amount0==null&&amount1!=null)amount0=amount1*(2n**192n)/(pool.sqrt*pool.sqrt);
   if(amount1==null&&amount0!=null)amount1=amount0*pool.sqrt*pool.sqrt/(2n**192n);
   if(!amount0||!amount1)continue;
   probes.push({pool,a:pool.token0,b:pool.token1,amount:amount0,spot:amount0*pool.sqrt*pool.sqrt/(2n**192n)},
    {pool,a:pool.token1,b:pool.token0,amount:amount1,spot:amount1*(2n**192n)/(pool.sqrt*pool.sqrt)});
  }
  const quotes=await batch(probes.map(p=>call('0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997','quoteExactInputSingle',[[p.a,p.b,p.amount,p.pool.fee,0n]])));
  for(let n=0;n<probes.length;n+=2){
   const pass=k=>{const p=probes[k],out=quotes[k]?.[0];return out>0n&&p.spot>0n&&out*1000000n*100n>=p.spot*BigInt(1000000-p.pool.fee)*99n;};
   probes[n].pool.depthVerified=pass(n)&&pass(n+1);
  }
 }
 const assertFresh=()=>{const time=clock()/1000;if(clock()-now>20000||Math.abs(time-timestamp)>120||expiry.some(t=>time>t))throw fail('流动性检查已过期，请刷新报价','stale',true);return true;};
 const canonical=await request({method:'eth_getBlockByNumber',params:[block.number,false]});
 if(!block.hash||lower(canonical?.hash)!==lower(block.hash))throw fail('区块状态已变化，请刷新报价','stale',true);
 assertFresh();
 return{...createPoolPolicy(pools,prices,tokenIn,tokenOut),assertFresh,blockNumber:block.number,checkedAt:now};
}
