import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {isIP} from 'node:net';
import {ethers} from 'ethers';
import {SWAP_TOKENS,SWAP_ADAPTERS,SWAP_RPC_ENDPOINTS,swapActiveRouter,readSwapConfig,swapFeePolicy,quoteSwap,v10BestAmountsOut,v10PlanFeeConversion,v10RouteImpact,swapBuyBudget,swapSellNet,assertQuoteSafety} from '../src/swap-aggregator.mjs?v=mainnet-20261111-21';
import {readPoolPolicy} from '../src/swap-liquidity.mjs?v=mainnet-20261111-21';
import {readTokenBalances} from '../src/swap-balances.mjs';

globalThis.ethers=ethers;
const ZERO=ethers.ZeroAddress,FIST=SWAP_TOKENS.fist.address.toLowerCase(),BPS=10000n,MAX=(1n<<256n)-1n;
const ADDRESS=/^0x[0-9a-f]{40}$/i,RAW=/^[1-9][0-9]{0,77}$/;
const fail=code=>Object.assign(new Error(code),{code});
const object=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export function quoteInput(b){
 if(!object(b,['chainId','tokenIn','tokenOut','amountIn','slippageBps','singleHop'])||b.chainId!==56||typeof b.tokenIn!=='string'||typeof b.tokenOut!=='string'||!ADDRESS.test(b.tokenIn)||!ADDRESS.test(b.tokenOut)||b.tokenIn.toLowerCase()===b.tokenOut.toLowerCase()||typeof b.amountIn!=='string'||!RAW.test(b.amountIn)||BigInt(b.amountIn)>MAX||!Number.isInteger(b.slippageBps)||b.slippageBps<0||b.slippageBps>5000||typeof b.singleHop!=='boolean')throw fail('INVALID_INPUT');
 return{...b,tokenIn:b.tokenIn.toLowerCase(),tokenOut:b.tokenOut.toLowerCase()};
}
export function balanceInput(b){
 if(!object(b,['chainId','account','tokens'])||b.chainId!==56||typeof b.account!=='string'||!ADDRESS.test(b.account)||!Array.isArray(b.tokens)||b.tokens.length<1||b.tokens.length>64||b.tokens.some(t=>typeof t!=='string'||!ADDRESS.test(t)))throw fail('INVALID_INPUT');
 return{chainId:56,account:b.account.toLowerCase(),tokens:[...new Set(b.tokens.map(t=>t.toLowerCase()))]};
}
export const encode=(v)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$bigint:x.toString()}:x);
// The API never takes an RPC method, URL, calldata, private key or signed transaction.
export function createReadPool(endpoints,{fetchImpl=fetch,timeoutMs=4500,clock=Date.now}={}){
 let nextId=0,active=0;
 const nodes=endpoints.map((url,n)=>({url,id:'upstream-'+(n+1),chainAt:0,lastOk:0,failures:0,cooldown:0}));
 async function call(node,payload,signal){
  if(!['eth_chainId','eth_getBlockByNumber','eth_call','eth_getBalance'].includes(payload.method))throw fail('RPC_FORBIDDEN');
  if(active>=48)throw fail('SERVICE_BUSY');active++;
  try{
   const id=++nextId,response=await fetchImpl(node.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,...payload}),signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])});
   if(!response.ok)throw fail('UPSTREAM_UNAVAILABLE');
   const chunks=[];let bytes=0;
   for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw fail('UPSTREAM_LIMIT');chunks.push(chunk);}
   const data=JSON.parse(Buffer.concat(chunks).toString());
   if(data.id!==id||data.error||!Object.hasOwn(data,'result'))throw fail('UPSTREAM_UNAVAILABLE');
   return data.result;
  }finally{active--;}
 }
 return{
  nodes,
  async run(operation,signal){
   const ordered=[...nodes].sort((a,b)=>Number(a.cooldown>clock())-Number(b.cooldown>clock())||b.lastOk-a.lastOk);
   let last;
   for(const node of ordered.slice(0,3)){
    if(signal.aborted)throw fail('REQUEST_TIMEOUT');
    try{
     const request=p=>call(node,p,signal);
     if(clock()-node.chainAt>10000){if(await request({method:'eth_chainId',params:[]})!=='0x38')throw fail('WRONG_CHAIN');node.chainAt=clock();}
     const result=await operation(request,node);node.lastOk=clock();node.failures=0;node.cooldown=0;return result;
    }catch(e){last=e;if(['INVALID_INPUT','NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','UNSUPPORTED_VERSION'].includes(e.code)||e.code==='POOL_LIQUIDITY'&&!e.retryable)throw e;node.failures++;node.cooldown=clock()+10000;}
   }
   throw last||fail('UPSTREAM_UNAVAILABLE');
  },
  health(){return{active,providers:nodes.map(n=>({id:n.id,ready:clock()-n.lastOk<60000,failures:n.failures}))};}
 };
}
function assertBlock(block,clock){
 if(!block?.hash||!block.number||!block.timestamp||Math.abs(clock()/1000-Number(BigInt(block.timestamp)))>120)throw fail('STALE_BLOCK');
}
function pinned(request,block){return p=>request({...p,params:p.method==='eth_call'?[p.params[0],block.number]:p.method==='eth_getBalance'?[p.params[0],block.number]:p.method==='eth_getBlockByNumber'&&p.params[0]==='latest'?[block.number,false]:p.params});}
export async function computeQuote(request,input,config,poolPolicy){
 const {tokenIn,tokenOut,slippageBps,singleHop}=input,amountIn=BigInt(input.amountIn),feeBps=config.platformFeeBps;
 if(config.version!=='1.11')throw fail('UNSUPPORTED_VERSION');
 const policy=swapFeePolicy(tokenIn,tokenOut,config.defaultFeeToken);
 const agg=(tokenIn===ZERO&&tokenOut===FIST)||(tokenIn===FIST&&tokenOut===ZERO);
 let q;
 if(agg){
  const route=await quoteSwap(request,{side:tokenIn===ZERO?'buy':'sell',amountIn,feeBps,poolPolicy,singleHop});
  q={kind:'agg',route,amountIn,out:route.estimateOut,lpFee:route.platformFee,feeToken:policy.token};
  q.impact=await v10RouteImpact(request,[route.first,route.second].filter(Boolean),route.swapBudget,q.out);
 }else{
  let swapIn,method;
  if(tokenIn===ZERO){swapIn=swapBuyBudget(amountIn,feeBps).budget;method='swapBnbToToken';}
  else if(tokenOut===ZERO){swapIn=policy.mode==='input'?amountIn-amountIn*BigInt(feeBps)/BPS:amountIn;method='swapTokenToBnb';}
  else{swapIn=policy.mode==='output'?amountIn:amountIn-amountIn*BigInt(feeBps)/BPS;method='swapTokenToToken';}
  let best=await v10BestAmountsOut(request,{tokenIn,tokenOut,amountIn:swapIn,singleHop,config,poolPolicy}),feePlan;
  if(policy.mode==='convert'){
   let lastError;
   for(const candidate of best.candidates){try{feePlan=await v10PlanFeeConversion(request,{input:tokenIn,feeBudget:amountIn*BigInt(feeBps)/BPS,config,slippageBps,mainLegs:[candidate.first,candidate.second].filter(Boolean)});best=candidate;break;}catch(e){if(e.code!=='NO_FEE_ROUTE')throw e;lastError=e;}}
   if(!feePlan)throw lastError||fail('NO_FEE_ROUTE');
  }
  const gross=best.out,out=policy.mode==='output'?swapSellNet(gross,feeBps).net:gross;
  q={kind:'v10',method,path:best.first.path,amountIn,out,impact:await v10RouteImpact(request,[best.first,best.second].filter(Boolean),swapIn,gross),feeToken:policy.token,adapterKey:best.key,lpFee:(policy.mode==='output'?gross:amountIn)*BigInt(feeBps)/BPS,first:best.first,second:best.second};
  if(feePlan){q.method='swapTokenToTokenWithFee';q.conversion=feePlan.conversion;q.lpFee=feePlan.fee;}
 }
 const minimum=q.out*(BPS-BigInt(slippageBps))/BPS;
 assertQuoteSafety({tokenIn,tokenOut,amountIn,amountOut:minimum,impact:q.impact,quotedAmountIn:amountIn,quotedAmountOut:q.out});
 poolPolicy.assertFresh();poolPolicy.assertValue(amountIn,minimum);
 q.poolCheckedAt=poolPolicy.checkedAt;
 return q;
}
export function createEngine(pool,{clock=Date.now,readConfig=readSwapConfig,readPolicy=readPoolPolicy,calculate=computeQuote,readBalances=readTokenBalances}={}){
 const contexts=new Map(),inflight=new Map();
 function boundedSet(map,key,value,max){if(map.size>=max)map.delete(map.keys().next().value);map.set(key,value);}
 async function context(request,node,input){
  const key=[node.id,input.tokenIn,input.tokenOut].join(':'),old=contexts.get(key);
  if(old&&clock()-old.started<2500)return old.promise;
  const entry={started:clock()};
  entry.promise=(async()=>{
   const block=await request({method:'eth_getBlockByNumber',params:['latest',false]});assertBlock(block,clock);
   const read=pinned(request,block),config=await readConfig(read);
   const policy=await readPolicy(read,{tokenIn:input.tokenIn,tokenOut:input.tokenOut,config,v3Mode:'legacy',clock});
   return{block,config,policy};
  })();boundedSet(contexts,key,entry,32);
  try{return await entry.promise;}catch(e){if(contexts.get(key)===entry)contexts.delete(key);throw e;}
 }
 return{
  quote(raw){
   const input=quoteInput(raw),key=JSON.stringify(input);if(inflight.has(key))return inflight.get(key);
   const signal=AbortSignal.timeout(18000);
   const promise=pool.run(async(request,node)=>{
    const {block,config,policy}=await context(request,node,input);policy.assertFresh();
    const q=await calculate(pinned(request,block),input,config,policy);
    const canonical=await request({method:'eth_getBlockByNumber',params:[block.number,false]});
    if(canonical?.hash!==block.hash)throw fail('STALE_BLOCK');policy.assertFresh();
    const expiresAt=policy.checkedAt+15000;if(clock()>=expiresAt)throw fail('QUOTE_EXPIRED');
    return{schema:1,chainId:56,router:swapActiveRouter(),input,config,quote:q,blockNumber:block.number,blockHash:block.hash,quotedAt:clock(),expiresAt};
   },signal).finally(()=>{if(inflight.get(key)===promise)inflight.delete(key);});
   boundedSet(inflight,key,promise,32);return promise;
  },
  balances(raw){
   const input=balanceInput(raw);
   return pool.run(async request=>{
    const block=await request({method:'eth_getBlockByNumber',params:['latest',false]});assertBlock(block,clock);
    const tokens=input.tokens.map(a=>({key:a===ZERO?'bnb':a,address:a===ZERO?null:a}));
    const result=await readBalances(pinned(request,block),input.account,tokens);
    if(!Object.keys(result.balances).length)throw fail('BALANCE_UNAVAILABLE');
    const canonical=await request({method:'eth_getBlockByNumber',params:[block.number,false]});if(canonical?.hash!==block.hash)throw fail('STALE_BLOCK');
    return{schema:1,chainId:56,account:input.account,blockNumber:block.number,blockHash:block.hash,readAt:clock(),balances:Object.fromEntries(tokens.filter(t=>result.balances[t.key]!=null).map(t=>[t.address||ZERO,result.balances[t.key].toString()])),failedTokens:tokens.filter(t=>result.failed.includes(t.key)).map(t=>t.address||ZERO)};
   },AbortSignal.timeout(12000));
  }
 };
}
const publicErrors=new Set(['INVALID_INPUT','NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','POOL_LIQUIDITY','UNSUPPORTED_VERSION','QUOTE_EXPIRED','STALE_BLOCK','BALANCE_UNAVAILABLE','SERVICE_BUSY','RATE_LIMIT','BODY_LIMIT','BODY_TIMEOUT']);
export function createApi({engine,pool,clock=Date.now,maxActive=12,rateLimit=240,allowedOrigins=['http://127.0.0.1:8124','http://localhost:8124','https://fstswap-live.vercel.app','https://fstswap-live-haocutbabas.vercel.app','https://fstswap.pro','https://www.fstswap.pro']}={}){
 const rates=new Map();let active=0;
 const server=createServer({headersTimeout:5000,requestTimeout:22000,maxHeaderSize:8192},async(req,res)=>{
  const origin=req.headers.origin;if(allowedOrigins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Max-Age','600');}
  const reply=(status,body)=>{if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(encode(body));};
  const routes={'/api/swap/quote':'quote','/api/swap/balances':'balances'};
  if(req.url==='/api/swap/health'&&req.method==='GET'){const health=pool.health();return reply(200,{service:'fstswap-api',version:'1',chainId:56,readOnly:true,router:swapActiveRouter(),ready:health.providers.some(p=>p.ready),active,pool:health});}
  const action=routes[req.url];if(action&&req.method==='OPTIONS'){res.writeHead(204);return res.end();}if(!action)return reply(404,{error:'NOT_FOUND'});
  if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(!/^application\/json(?:;.*)?$/i.test(req.headers['content-type']||''))return reply(415,{error:'CONTENT_TYPE'});
  const remote=req.socket.remoteAddress,header=req.headers['x-fstswap-client-ip'];
  const ip=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof header==='string'&&isIP(header)?header:remote;
  let rate=rates.get(ip);if(!rate||clock()-rate.at>60000){rate={at:clock(),count:0};if(rates.size>4096)rates.delete(rates.keys().next().value);rates.set(ip,rate);}
  if(++rate.count>rateLimit)return reply(429,{error:'RATE_LIMIT'});
  if(active>=maxActive)return reply(503,{error:'SERVICE_BUSY'});
  active++;let timer;
  try{
   if(Number(req.headers['content-length'])>16384)throw fail('BODY_LIMIT');
   const chunks=[];let length=0;
   timer=setTimeout(()=>req.destroy(),2000);
   for await(const chunk of req){length+=chunk.length;if(length>16384)throw fail('BODY_LIMIT');chunks.push(chunk);}
   clearTimeout(timer);let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{throw fail('INVALID_INPUT');}
   reply(200,await engine[action](body));
  }catch(e){const code=publicErrors.has(e.code)?e.code:'SERVICE_UNAVAILABLE';reply(code==='INVALID_INPUT'?400:code==='BODY_LIMIT'?413:422,{error:code,...(e.code==='POOL_LIQUIDITY'&&['data','stale','oracle','price'].includes(e.reason)?{reason:e.reason}:{})});}
  finally{clearTimeout(timer);active--;}
 });
 server.keepAliveTimeout=5000;return server;
}
export function endpointsFromEnv(env){
 const configured=env.FSTSWAP_RPC_URLS?env.FSTSWAP_RPC_URLS.split(','):[env.FSTSI_ROUTE_RPC_DRPC,env.FSTSI_ROUTE_RPC_BLOCKRAZOR,env.FSTSI_ROUTE_RPC_BINANCE,env.FSTSI_ROUTE_RPC_PUBLICNODE].filter(Boolean);
 const endpoints=configured.length?configured:SWAP_RPC_ENDPOINTS.slice(0,4);
 return endpoints.map(value=>{let u;try{u=new URL(value);}catch{throw fail('RPC_CONFIG');}if(u.protocol!=='https:'||u.username||u.password||u.hash)throw fail('RPC_CONFIG');return u.href;});
}
if(process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url){
 const pool=createReadPool(endpointsFromEnv(process.env)),engine=createEngine(pool),server=createApi({engine,pool});
 const warm=()=>pool.run(async r=>{const b=await r({method:'eth_getBlockByNumber',params:['latest',false]});assertBlock(b,Date.now);},AbortSignal.timeout(12000)).catch(()=>{});
 await warm();const timer=setInterval(warm,20000);timer.unref();
 const port=Number(process.env.FSTSWAP_API_PORT||4375);server.listen(port,'127.0.0.1',()=>console.log('FstSwap read API ready on loopback port '+port));
 for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>{clearInterval(timer);server.close();});
}
