import {FSTSWAP_CONFIG} from './fstswap-config.mjs?v=mainnet-20261111-34';
import {swapFeePolicy,swapBuyBudget,SWAP_TOKENS} from './swap-aggregator.mjs?v=mainnet-20261111-34';
import {fstRequiresLinearV2} from './swap-fstswap.mjs?v=mainnet-20261111-34';
// Read-only API acceleration. Wallet requests and final transaction preflight stay local.
const ZERO='0x'+'00'.repeat(20),ADDRESS=/^0x[0-9a-f]{40}$/i,HASH=/^0x[0-9a-f]{64}$/i;
const businessErrors=new Set(['NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','POOL_LIQUIDITY']);
const addr=v=>typeof v==='string'&&ADDRESS.test(v),lower=v=>String(v||ZERO).toLowerCase();
function parseWire(text){return JSON.parse(text,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$bigint==='string'&&/^-?[0-9]{1,78}$/.test(v.$bigint)?BigInt(v.$bigint):v);}
function check(value){if(!value)throw Error('INVALID_SERVICE_RESPONSE');}
function checkCallerSignal(signal){if(signal?.aborted)throw new DOMException('Service request canceled','AbortError');}
async function waitForSignal(promise,signal){
 let onAbort;
 const canceled=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();});
 // Keep handlers on both promises after the race, including ignored late failures.
 try{return await Promise.race([canceled,promise]);}
 finally{signal.removeEventListener('abort',onAbort);}
}
// The staged 2.0 wire format binds every executable branch to its quoted amount
// graph. UI-only annotations are ignored; alternate executable forms are not.
function validateFstServiceQuote(q,c,input,adapters){
 const BPS=10000n,MAX=(1n<<256n)-1n,WBNB='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
 const feeAssets=new Set([ZERO,WBNB,'0x55d398326f99059ff775485246999027b3197955','0xc9882def23bc42d53895b8361d0b1edc7570bc6a','0x2170ed0880ac9a755fd29b2688956bd959f933f8','0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d']);
 const fields=(o,allowed)=>check(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k)));
 const uint=(v,positive=false)=>check(typeof v==='bigint'&&v>=(positive?1n:0n)&&v<=MAX);
 const same=(a,b)=>addr(a)&&addr(b)&&lower(a)===lower(b);
 const impact=v=>check(Number.isFinite(v)&&v>=0&&v<=1);
 check(addr(input.tokenIn)&&addr(input.tokenOut)&&!same(input.tokenIn,input.tokenOut)&&Number.isInteger(input.slippageBps)&&input.slippageBps>=0&&input.slippageBps<=5000&&typeof input.singleHop==='boolean');
 fields(q,['kind','tokenIn','tokenOut','amountIn','out','minimum','lpFee','feeToken','feeMode','configVersion','impact','poolCheckedAt','stages','segments','serviceMeta','serviceExpiresAt','feeAsset']);
 check(q.kind==='fstswap'&&same(q.tokenIn,input.tokenIn)&&same(q.tokenOut,input.tokenOut)&&Number.isSafeInteger(q.poolCheckedAt)&&q.poolCheckedAt>=0);
 fields(c,['version','platformFeeBps','feeReceiver','wbnb','defaultFeeToken','feeConfigVersion','adaptersOff','v3Factory']);
 check(feeAssets.has(lower(c.defaultFeeToken))&&same(c.wbnb,WBNB));
 uint(c.feeConfigVersion,true);uint(q.configVersion,true);check(q.configVersion===c.feeConfigVersion);
 uint(q.amountIn,true);uint(q.out,true);uint(q.minimum,true);uint(q.lpFee);impact(q.impact);
 const minimum=v=>v*(BPS-BigInt(input.slippageBps))/BPS;
 check(q.minimum===minimum(q.out));
 const from=lower(input.tokenIn),to=lower(input.tokenOut),mode=feeAssets.has(from)?'input':feeAssets.has(to)?'output':'intermediate',fee=mode==='input'?from:mode==='output'?to:lower(c.defaultFeeToken);
 check(q.feeMode===mode&&lower(q.feeToken)===fee);
 check(Array.isArray(q.segments)&&q.segments.length===(mode==='intermediate'?2:1)&&Array.isArray(q.stages)&&q.stages.length>0&&q.stages.length<=6);
 const dexes=Object.entries(adapters).filter(([key])=>['fst','pancake','v3'].includes(key)),pools=new Set(),expectedStages=[];
 const wrapPair=(a,b)=>[lower(a),lower(b)].sort().join(':')===[ZERO,WBNB].sort().join(':');
 const signature=l=>JSON.stringify([lower(l.adapter),l.kind,Array.isArray(l.path)?l.path.map(lower):String(l.path).toLowerCase(),lower(l.tokenIn),lower(l.tokenOut),String(l.amountIn),String(l.out),l.weightBps,l.poolIds.map(lower)]);
 function checkLeg(l){
  fields(l,['adapter','kind','path','tokenIn','tokenOut','amountIn','out','weightBps','poolIds']);
  check(addr(l.adapter)&&addr(l.tokenIn)&&addr(l.tokenOut)&&!same(l.tokenIn,l.tokenOut));uint(l.amountIn,true);uint(l.out,true);
  check(Number.isInteger(l.weightBps)&&l.weightBps>0&&l.weightBps<=10000&&Array.isArray(l.poolIds));
  if(l.kind==='wrap'){
   check(wrapPair(l.tokenIn,l.tokenOut)&&wrapPair(from,to)&&q.segments.length===1&&q.stages.length===1&&lower(l.adapter)===ZERO&&Array.isArray(l.path)&&l.path.length===0&&l.poolIds.length===0&&l.weightBps===10000&&l.amountIn===l.out);
  }else{
   const entry=dexes.find(([,a])=>same(a.adapter,l.adapter));check(entry&&!c.adaptersOff.includes(entry[0])&&addr(entry[1].weth));
   check(l.poolIds.length===1&&addr(l.poolIds[0])&&lower(l.poolIds[0])!==ZERO);
   let path;
   if(l.kind==='v3'){
    check(entry[0]==='v3'&&typeof l.path==='string'&&/^0x[0-9a-f]{86}$/i.test(l.path)&&[100,500,2500,10000].includes(parseInt(l.path.slice(42,48),16)));
    path=[l.path.slice(0,42),'0x'+l.path.slice(48)];
   }else{check(l.kind==='v2'&&entry[0]!=='v3'&&Array.isArray(l.path)&&l.path.length===2&&l.path.every(t=>addr(t)&&lower(t)!==ZERO));path=l.path;}
   check(!same(path[0],path[1])&&same(path[0],lower(l.tokenIn)===ZERO?entry[1].weth:l.tokenIn)&&same(path[1],lower(l.tokenOut)===ZERO?entry[1].weth:l.tokenOut));
  }
 }
 for(let index=0;index<q.segments.length;index++){
  const s=q.segments[index];fields(s,['from','to','amountIn','out','minimum','impact','legs','routeStages']);
  check(addr(s.from)&&addr(s.to)&&!same(s.from,s.to));uint(s.amountIn,true);uint(s.out,true);uint(s.minimum);impact(s.impact);
  check(same(s.from,index===0?from:fee)&&same(s.to,index+1===q.segments.length?to:fee));
  check(Array.isArray(s.legs)&&s.legs.length>0&&s.legs.length<=9&&Array.isArray(s.routeStages)&&s.routeStages.length>0&&s.routeStages.length<=3&&(!input.singleHop||s.routeStages.length===1));
  s.legs.forEach(checkLeg);
  const flat=s.routeStages.flatMap(stage=>{check(Array.isArray(stage?.legs));return stage.legs;});flat.forEach(checkLeg);
  check(flat.length===s.legs.length&&flat.every((l,n)=>signature(l)===signature(s.legs[n])));
  const wrapped=s.legs[0].kind==='wrap';check(s.minimum===(wrapped?s.out:minimum(s.out))&&(!wrapped||s.impact===0));
  let budget=s.amountIn,token=s.from;const seenTokens=new Set([lower(token)]);
  for(const stage of s.routeStages){
   fields(stage,['tokenIn','tokenOut','out','legs']);check(same(stage.tokenIn,token)&&addr(stage.tokenOut)&&!seenTokens.has(lower(stage.tokenOut)));seenTokens.add(lower(stage.tokenOut));uint(stage.out,true);
   check(stage.legs.length>0&&stage.legs.length<=3&&stage.legs.reduce((n,l)=>n+l.weightBps,0)===10000);
   let allocated=0n,total=0n;
   for(let n=0;n<stage.legs.length;n++){
    const l=stage.legs[n],part=n+1===stage.legs.length?budget-allocated:budget*BigInt(l.weightBps)/BPS;allocated+=part;
    check(same(l.tokenIn,stage.tokenIn)&&same(l.tokenOut,stage.tokenOut)&&l.amountIn===part);total+=l.out;
    for(const pool of l.poolIds){check(!pools.has(lower(pool)));pools.add(lower(pool));}
   }
   check(total===stage.out);
   expectedStages.push({tokenIn:stage.tokenIn,tokenOut:stage.tokenOut,minOut:wrapped?stage.out:minimum(stage.out)||1n,branches:stage.legs.map(l=>({adapter:l.adapter,kind:l.kind==='wrap'?2:l.kind==='v3'?1:0,weightBps:l.weightBps,path:l.kind==='v2'?l.path:[],v3Path:l.kind==='v3'?l.path:'0x'}))});
   budget=stage.out;token=stage.tokenOut;
  }
  check(same(token,s.to)&&budget===s.out);
 }
 check(q.stages.length===expectedStages.length);
 for(let i=0;i<q.stages.length;i++){
  const stage=q.stages[i],expected=expectedStages[i];fields(stage,['tokenIn','tokenOut','minOut','branches']);
  check(same(stage.tokenIn,expected.tokenIn)&&same(stage.tokenOut,expected.tokenOut)&&stage.minOut===expected.minOut&&Array.isArray(stage.branches)&&stage.branches.length===expected.branches.length);
  for(let n=0;n<stage.branches.length;n++){
   const branch=stage.branches[n],want=expected.branches[n];fields(branch,['adapter','kind','weightBps','path','v3Path']);
   check(same(branch.adapter,want.adapter)&&branch.kind===want.kind&&branch.weightBps===want.weightBps&&Array.isArray(branch.path)&&branch.path.length===want.path.length&&branch.path.every((a,k)=>same(a,want.path[k]))&&typeof branch.v3Path==='string'&&branch.v3Path.toLowerCase()===want.v3Path.toLowerCase());
  }
 }
 const tokens=[q.tokenIn,q.tokenOut,...q.stages.flatMap(s=>[s.tokenIn,s.tokenOut,...s.branches.flatMap(b=>b.kind===1?[b.v3Path.slice(0,42),'0x'+b.v3Path.slice(48)]:b.path)])];
 if(fstRequiresLinearV2(c.version,tokens,adapters,c.adaptersOff))check(q.stages.every(s=>s.branches.length===1&&s.branches[0].kind===0));
 const rate=BigInt(c.platformFeeBps),first=q.segments[0],last=q.segments.at(-1),base=mode==='input'?q.amountIn:first.out;
 check(q.lpFee===base*rate/BPS);
 check(first.amountIn===(mode==='input'?q.amountIn-q.lpFee:q.amountIn));
 if(mode==='intermediate')check(last.amountIn===first.out-q.lpFee);
 check(q.out===(mode==='output'?last.out-q.lpFee:last.out));
 check(Math.abs(q.impact-(1-q.segments.reduce((v,s)=>v*(1-s.impact),1)))<=1e-12);
}
export function validateServiceQuote(data,input,{router,adapters,clock=Date.now,expectedVersion}={}){
 check(data?.schema===1&&data.chainId===56&&lower(data.router)===lower(router));
 check(addr(data.router)&&HASH.test(data.blockHash)&&/^0x[0-9a-f]+$/i.test(data.blockNumber));
 check(data.input&&Object.keys(input).every(k=>data.input[k]===input[k]));
 const q=data.quote,c=data.config,now=clock();
 check(Number.isFinite(data.quotedAt)&&Number.isFinite(data.expiresAt)&&data.quotedAt<=now+2000&&data.expiresAt>now&&data.expiresAt-data.quotedAt<=15000);
 check(['1.11','2.0.0','2.1.0'].includes(c?.version)&&Number.isInteger(c.platformFeeBps)&&c.platformFeeBps>=0&&c.platformFeeBps<=100&&addr(c.feeReceiver)&&addr(c.wbnb)&&addr(c.defaultFeeToken)&&typeof c.feeConfigVersion==='bigint'&&Array.isArray(c.adaptersOff));
 if(expectedVersion!==undefined)check(c.version===expectedVersion);
 check(c.adaptersOff.every(key=>['fst','pancake','v3'].includes(key))&&new Set(c.adaptersOff).size===c.adaptersOff.length);
 check(q&&typeof q.amountIn==='bigint'&&q.amountIn===BigInt(input.amountIn)&&typeof q.out==='bigint'&&q.out>0n&&typeof q.lpFee==='bigint'&&q.lpFee>=0n&&addr(q.feeToken)&&Number.isFinite(q.impact)&&q.impact>=0);
 check(q.poolCheckedAt+15000===data.expiresAt);
 check(q.maxIn==null&&!q.exactOut);
 if(['2.0.0','2.1.0'].includes(c.version)){check(data.quotedAt<data.expiresAt);validateFstServiceQuote(q,c,input,adapters);return data;}
 const entries=Object.entries(adapters).filter(([key])=>['fst','pancake','v3'].includes(key)),empty=l=>l&&lower(l.adapter)===ZERO&&Array.isArray(l.path)&&l.path.length===0;
 const leg=l=>{
  const entry=entries.find(([,a])=>lower(a.adapter)===lower(l?.adapter));check(entry&&!c.adaptersOff.includes(entry[0]));
  let path;
  if(l.kind==='v3'){check(entry[0]==='v3'&&typeof l.path==='string'&&/^0x[0-9a-f]{86}$/i.test(l.path));path=[l.path.slice(0,42),'0x'+l.path.slice(48)];}
  else{check(Array.isArray(l.path)&&l.path.length>=2&&l.path.length<=5&&l.path.every(t=>addr(t)&&lower(t)!==ZERO));path=l.path;}
  path=path.map(lower);check(new Set(path).size===path.length);
  return{path,weth:lower(entry[1].weth),kind:l.kind};
 };
 const route=(first,second,tokenIn,tokenOut,singleHop)=>{
  const one=leg(first),two=second&&!empty(second)?leg(second):null,last=two||one;
  check(one.path[0]===(tokenIn===ZERO?one.weth:tokenIn));
  check(last.path.at(-1)===(tokenOut===ZERO?last.weth:tokenOut));
  if(two)check(one.path.at(-1)===two.path[0]&&one.kind!=='v3'&&two.kind!=='v3');
  if(singleHop)check(!two&&one.path.length===2);
 };
 const policy=swapFeePolicy(input.tokenIn,input.tokenOut,c.defaultFeeToken);
 check(lower(q.feeToken)===lower(policy.token));
 if(policy.mode!=='convert')check(q.lpFee===(policy.mode==='input'?q.amountIn:q.out+q.lpFee)*BigInt(c.platformFeeBps)/10000n);
 if(q.kind==='agg'){
  const fist=lower(SWAP_TOKENS.fist.address),buy=input.tokenIn===ZERO&&input.tokenOut===fist,sell=input.tokenIn===fist&&input.tokenOut===ZERO;
  check((buy||sell)&&q.route&&q.route.legs==null&&q.route.amountsIn==null&&q.route.side===(buy?'buy':'sell')&&!q.conversion);
  route(q.route.first,q.route.second,input.tokenIn,input.tokenOut,input.singleHop);
  check(q.route.estimateOut===q.out&&q.route.platformFee===q.lpFee&&q.route.feeBps===c.platformFeeBps);
  const expected=buy?swapBuyBudget(q.amountIn,c.platformFeeBps):{budget:q.amountIn-q.lpFee,reserve:0n};
  check(q.route.swapBudget===expected.budget&&q.route.reserve===expected.reserve);
 }else{
  const method=input.tokenIn===ZERO?'swapBnbToToken':input.tokenOut===ZERO?'swapTokenToBnb':policy.mode==='convert'?'swapTokenToTokenWithFee':'swapTokenToToken';
  check(q.kind==='v10'&&!q.route&&q.method===method&&q.first?.kind!=='v3'&&q.second?.kind!=='v3');
  route(q.first,q.second,input.tokenIn,input.tokenOut,input.singleHop);
  if(policy.mode==='convert'){
   const f=q.conversion;check(f&&lower(f.feeToken)===lower(c.defaultFeeToken)&&f.configVersion===c.feeConfigVersion);
   route(f.first,f.second,input.tokenIn,lower(f.feeToken),false);
   check(f.minOut===(q.lpFee*(10000n-BigInt(input.slippageBps))/10000n||1n));
  }else check(!q.conversion);
 }

 return data;
}
export function createServiceClient({base='',fetchImpl=globalThis.fetch,clock=Date.now,quoteTimeout=6500,balanceTimeout=3500,expectedVersion}={}){
 const cooldown={quote:0,balances:0};
 async function post(action,input,timeout,signal){
  checkCallerSignal(signal);
  if(!base||clock()<cooldown[action])return null;
  try{
   const timeoutSignal=AbortSignal.timeout(timeout),activeSignal=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;
   const r=await waitForSignal(fetchImpl(base+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:activeSignal,credentials:'omit'}),activeSignal);
   checkCallerSignal(signal);
   const text=await waitForSignal(r.text(),activeSignal);checkCallerSignal(signal);check(text.length<1024*1024);const data=parseWire(text);checkCallerSignal(signal);
   if(!r.ok){if(businessErrors.has(data?.error))throw Object.assign(new Error(data.error),{code:data.error,reason:data.reason,retryable:['data','stale','oracle'].includes(data.reason)});throw Error('SERVICE_UNAVAILABLE');}
   return data;
  }catch(e){checkCallerSignal(signal);if(businessErrors.has(e.code))throw e;cooldown[action]=clock()+30000;return null;}
 }
 return{
  available(){return !!base&&clock()>=cooldown.quote;},
  async quote({tokenIn,tokenOut,amountIn,slippageBps,singleHop},{router,adapters,signal}={}){
   checkCallerSignal(signal);
   const input={chainId:56,tokenIn:lower(tokenIn),tokenOut:lower(tokenOut),amountIn:amountIn.toString(),slippageBps,singleHop};
   const data=await post('quote',input,quoteTimeout,signal);checkCallerSignal(signal);if(!data)return null;
   try{const result=validateServiceQuote(data,input,{router,adapters,clock,expectedVersion});checkCallerSignal(signal);return result;}catch{checkCallerSignal(signal);cooldown.quote=clock()+30000;return null;}
  },
  async balances(account,tokens,{signal}={}){
   checkCallerSignal(signal);
   if(!tokens.length||tokens.length>64)return null;
   const input={chainId:56,account:lower(account),tokens:[...new Set(tokens.map(t=>lower(t.address)))]};
   const data=await post('balances',input,balanceTimeout,signal);checkCallerSignal(signal);if(!data)return null;
   try{
    check(data.schema===1&&data.chainId===56&&data.account===input.account&&HASH.test(data.blockHash)&&/^0x[0-9a-f]+$/i.test(data.blockNumber));
    check(Number.isFinite(data.readAt)&&clock()-data.readAt<15000&&data.readAt<=clock()+2000);
    check(data.balances&&Array.isArray(data.failedTokens));
    check(Object.entries(data.balances).every(([k,v])=>input.tokens.includes(k)&&typeof v==='string'&&/^[0-9]{1,78}$/.test(v)&&BigInt(v)<(1n<<256n)));
    check(data.failedTokens.every(k=>input.tokens.includes(k)&&data.balances[k]==null));
    check(input.tokens.every(k=>data.balances[k]!=null||data.failedTokens.includes(k)));
    const result={balances:Object.fromEntries(tokens.filter(t=>data.balances[lower(t.address)]!=null).map(t=>[t.key,BigInt(data.balances[lower(t.address)])])),failed:tokens.filter(t=>data.failedTokens.includes(lower(t.address))).map(t=>t.key)};
    checkCallerSignal(signal);return result;
   }catch{checkCallerSignal(signal);cooldown.balances=clock()+30000;return null;}
  }
 };
}
const host=globalThis.location?.hostname,local=['127.0.0.1','localhost'].includes(host);
const enabled=!globalThis.FST_RPC_OVERRIDE&&!globalThis.FST_V10_CONFIG&&(local||host==='fstswap.pro'||host==='www.fstswap.pro'||/^fstswap-live(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host||''));
export const swapService=createServiceClient({base:enabled?'https://logo-api.fstswap.si/api/swap':'',expectedVersion:FSTSWAP_CONFIG.version});
