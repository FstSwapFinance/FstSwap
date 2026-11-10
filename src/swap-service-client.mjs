import {swapFeePolicy,swapBuyBudget,SWAP_TOKENS} from './swap-aggregator.mjs?v=mainnet-20261111-22';
// Read-only API acceleration. Wallet requests and final transaction preflight stay local.
const ZERO='0x'+'00'.repeat(20),ADDRESS=/^0x[0-9a-f]{40}$/i,HASH=/^0x[0-9a-f]{64}$/i;
const businessErrors=new Set(['NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','POOL_LIQUIDITY']);
const addr=v=>typeof v==='string'&&ADDRESS.test(v),lower=v=>String(v||ZERO).toLowerCase();
function parseWire(text){return JSON.parse(text,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$bigint==='string'&&/^-?[0-9]{1,78}$/.test(v.$bigint)?BigInt(v.$bigint):v);}
function check(value){if(!value)throw Error('INVALID_SERVICE_RESPONSE');}
export function validateServiceQuote(data,input,{router,adapters,clock=Date.now}={}){
 check(data?.schema===1&&data.chainId===56&&lower(data.router)===lower(router));
 check(addr(data.router)&&HASH.test(data.blockHash)&&/^0x[0-9a-f]+$/i.test(data.blockNumber));
 check(data.input&&Object.keys(input).every(k=>data.input[k]===input[k]));
 const q=data.quote,c=data.config,now=clock();
 check(Number.isFinite(data.quotedAt)&&Number.isFinite(data.expiresAt)&&data.quotedAt<=now+2000&&data.expiresAt>now&&data.expiresAt-data.quotedAt<=15000);
 check(c?.version==='1.11'&&Number.isInteger(c.platformFeeBps)&&c.platformFeeBps>=0&&c.platformFeeBps<=100&&addr(c.feeReceiver)&&addr(c.wbnb)&&addr(c.defaultFeeToken)&&typeof c.feeConfigVersion==='bigint'&&Array.isArray(c.adaptersOff));
 check(q&&typeof q.amountIn==='bigint'&&q.amountIn===BigInt(input.amountIn)&&typeof q.out==='bigint'&&q.out>0n&&typeof q.lpFee==='bigint'&&q.lpFee>=0n&&addr(q.feeToken)&&Number.isFinite(q.impact)&&q.impact>=0);
 check(q.poolCheckedAt+15000===data.expiresAt);
 check(q.maxIn==null&&!q.exactOut);
 const entries=Object.entries(adapters),empty=l=>l&&lower(l.adapter)===ZERO&&Array.isArray(l.path)&&l.path.length===0;
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
export function createServiceClient({base='',fetchImpl=globalThis.fetch,clock=Date.now,quoteTimeout=6500,balanceTimeout=3500}={}){
 const cooldown={quote:0,balances:0};
 async function post(action,input,timeout){
  if(!base||clock()<cooldown[action])return null;
  try{
   const r=await fetchImpl(base+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(timeout),credentials:'omit'});
   const text=await r.text();check(text.length<1024*1024);const data=parseWire(text);
   if(!r.ok){if(businessErrors.has(data?.error))throw Object.assign(new Error(data.error),{code:data.error,reason:data.reason,retryable:['data','stale','oracle'].includes(data.reason)});throw Error('SERVICE_UNAVAILABLE');}
   return data;
  }catch(e){if(businessErrors.has(e.code))throw e;cooldown[action]=clock()+30000;return null;}
 }
 return{
  available(){return !!base&&clock()>=cooldown.quote;},
  async quote({tokenIn,tokenOut,amountIn,slippageBps,singleHop},{router,adapters}={}){
   const input={chainId:56,tokenIn:lower(tokenIn),tokenOut:lower(tokenOut),amountIn:amountIn.toString(),slippageBps,singleHop};
   const data=await post('quote',input,quoteTimeout);if(!data)return null;
   try{return validateServiceQuote(data,input,{router,adapters,clock});}catch{cooldown.quote=clock()+30000;return null;}
  },
  async balances(account,tokens){
   if(!tokens.length||tokens.length>64)return null;
   const input={chainId:56,account:lower(account),tokens:[...new Set(tokens.map(t=>lower(t.address)))]};
   const data=await post('balances',input,balanceTimeout);if(!data)return null;
   try{
    check(data.schema===1&&data.chainId===56&&data.account===input.account&&HASH.test(data.blockHash)&&/^0x[0-9a-f]+$/i.test(data.blockNumber));
    check(Number.isFinite(data.readAt)&&clock()-data.readAt<15000&&data.readAt<=clock()+2000);
    check(data.balances&&Array.isArray(data.failedTokens));
    check(Object.entries(data.balances).every(([k,v])=>input.tokens.includes(k)&&typeof v==='string'&&/^[0-9]{1,78}$/.test(v)&&BigInt(v)<(1n<<256n)));
    check(data.failedTokens.every(k=>input.tokens.includes(k)&&data.balances[k]==null));
    check(input.tokens.every(k=>data.balances[k]!=null||data.failedTokens.includes(k)));
    return{balances:Object.fromEntries(tokens.filter(t=>data.balances[lower(t.address)]!=null).map(t=>[t.key,BigInt(data.balances[lower(t.address)])])),failed:tokens.filter(t=>data.failedTokens.includes(lower(t.address))).map(t=>t.key)};
   }catch{cooldown.balances=clock()+30000;return null;}
  }
 };
}
const host=globalThis.location?.hostname,local=['127.0.0.1','localhost'].includes(host);
const enabled=!globalThis.FST_RPC_OVERRIDE&&!globalThis.FST_V10_CONFIG&&(local||host==='fstswap.pro'||host==='www.fstswap.pro'||/^fstswap-live(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host||''));
export const swapService=createServiceClient({base:enabled?'https://logo-api.fstswap.si/api/swap':''});
