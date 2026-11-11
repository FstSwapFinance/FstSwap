import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {isIP} from 'node:net';
import {ethers} from 'ethers';
import {SWAP_TOKENS,SWAP_ADAPTERS,SWAP_RPC_ENDPOINTS,swapActiveRouter,readSwapConfig,swapFeePolicy,quoteSwap,v10BestAmountsOut,v10PlanFeeConversion,v10RouteImpact,swapBuyBudget,swapSellNet,assertQuoteSafety} from '../src/swap-aggregator.mjs?v=mainnet-20261111-32';
import {readFstPoolPolicy,quoteFstSwap,fstServiceQuote} from '../src/swap-fstswap.mjs?v=mainnet-20261111-32';
import {readTokenBalances} from '../src/swap-balances.mjs';
import {createReadPool} from './swap-read-pool.mjs';
export {createReadPool};

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

function assertBlock(block,clock){
 if(!block?.hash||!block.number||!block.timestamp||Math.abs(clock()/1000-Number(BigInt(block.timestamp)))>120)throw fail('STALE_BLOCK');
}
function pinned(request,block){return p=>{
 // Nested policy readers need this exact header, not another network round trip.
 // Explicit-height reads still go upstream for independent reorg checks.
 if(p.method==='eth_getBlockByNumber'&&p.params[0]==='latest')return Promise.resolve({...block});
 return request({...p,params:p.method==='eth_call'?[p.params[0],block.number]:p.method==='eth_getBalance'?[p.params[0],block.number]:p.params});
};}
export async function computeQuote(request,input,config,poolPolicy,{nodeId}={}){
 const {tokenIn,tokenOut,slippageBps,singleHop}=input,amountIn=BigInt(input.amountIn),feeBps=config.platformFeeBps;
 if(config.version==='2.0.0'){
  const q=await quoteFstSwap(request,{tokenIn,tokenOut,amountIn,config,slippageBps,singleHop,preparedPolicy:poolPolicy,contextNodeId:nodeId});
  assertQuoteSafety({tokenIn,tokenOut,amountIn,amountOut:q.minimum,impact:q.impact,quotedAmountIn:q.amountIn,quotedAmountOut:q.out});
  poolPolicy.assertFresh();poolPolicy.assertValue(amountIn,q.minimum);
  return fstServiceQuote(q,{slippageBps,poolCheckedAt:poolPolicy.checkedAt});
 }
 if(config.version!=='1.11')throw fail('UNSUPPORTED_VERSION');
 const policy=swapFeePolicy(tokenIn,tokenOut,config.defaultFeeToken);
 const agg=(tokenIn===ZERO&&tokenOut===FIST)||(tokenIn===FIST&&tokenOut===ZERO);
 let q;
 if(agg){
  const route=await quoteSwap(request,{side:tokenIn===ZERO?'buy':'sell',amountIn,feeBps,poolPolicy,singleHop});
  q={kind:'agg',route,amountIn,out:route.estimateOut,lpFee:route.platformFee,feeToken:policy.token};
  q.impact=await v10RouteImpact(request,[route.first,route.second].filter(Boolean),route.swapBudget,q.out,{poolPolicy,blockNumber:poolPolicy.blockNumber});
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
  q={kind:'v10',method,path:best.first.path,amountIn,out,impact:await v10RouteImpact(request,[best.first,best.second].filter(Boolean),swapIn,gross,{poolPolicy,blockNumber:poolPolicy.blockNumber}),feeToken:policy.token,adapterKey:best.key,lpFee:(policy.mode==='output'?gross:amountIn)*BigInt(feeBps)/BPS,first:best.first,second:best.second};
  if(feePlan){q.method='swapTokenToTokenWithFee';q.conversion=feePlan.conversion;q.lpFee=feePlan.fee;}
 }
 const minimum=q.out*(BPS-BigInt(slippageBps))/BPS;
 assertQuoteSafety({tokenIn,tokenOut,amountIn,amountOut:minimum,impact:q.impact,quotedAmountIn:amountIn,quotedAmountOut:q.out});
 poolPolicy.assertFresh();poolPolicy.assertValue(amountIn,minimum);
 q.poolCheckedAt=poolPolicy.checkedAt;
 return q;
}
// Each subscriber owns cancellation. A shared read owns its upstream signal and
// abandons that read only after every subscriber has left.
const abortError=signal=>fail(signal?.reason?.name==='TimeoutError'?'REQUEST_TIMEOUT':'REQUEST_ABORTED');
function assertRunning(signal){if(signal?.aborted)throw abortError(signal);}
function untilAborted(work,signal){
 if(signal.aborted)return Promise.reject(abortError(signal));
 return new Promise((resolve,reject)=>{
  const abort=()=>{cleanup();reject(abortError(signal));},cleanup=()=>signal.removeEventListener('abort',abort);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(work).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
}
function sharedRead(start,{timeoutMs,onSettled,onAbandoned}={}){
 const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]);
 const entry={controller,signal,consumers:new Set(),settled:false};
 entry.promise=untilAborted(Promise.resolve().then(()=>{assertRunning(signal);return start(signal);}),signal).then(value=>{
  entry.settled=true;onSettled?.(null);return value;
 },error=>{entry.settled=true;onSettled?.(error);throw error;});
 // A provider that ignores cancellation may finish after all its subscribers left.
 // Keep its rejection handled; canceled results never enter a retained cache.
 entry.promise.catch(()=>{});
 entry.subscribe=consumerSignal=>{
  if(consumerSignal?.aborted)return Promise.reject(abortError(consumerSignal));
  return new Promise((resolve,reject)=>{
   const consumer={},leave=()=>{consumerSignal?.removeEventListener('abort',abort);entry.consumers.delete(consumer);};
   const abort=()=>{leave();reject(abortError(consumerSignal));if(!entry.settled&&!entry.consumers.size){onAbandoned?.();controller.abort();}};
   entry.consumers.add(consumer);consumerSignal?.addEventListener('abort',abort,{once:true});
   entry.promise.then(value=>{leave();resolve(value);},error=>{leave();reject(error);});
  });
 };
 return entry;
}
export function createEngine(pool,{balancePool=pool,clock=Date.now,readConfig=readSwapConfig,readPolicy=readFstPoolPolicy,calculate=computeQuote,readBalances=readTokenBalances,warmup={}}={}){
 const contexts=new Map(),inflight=new Map(),recentPairs=new Map();
 const warmOptions={enabled:true,intervalMs:6000,activeTtlMs:60000,maxPairs:4,...warmup};
 warmOptions.intervalMs=Math.max(1000,Number(warmOptions.intervalMs)||6000);
 warmOptions.maxPairs=Math.max(1,Math.min(4,Number(warmOptions.maxPairs)||4));
 const defaults=(warmOptions.pairs||[{tokenIn:SWAP_TOKENS.usdt.address.toLowerCase(),tokenOut:FIST}]).slice(0,warmOptions.maxPairs);
 let foreground=0,warming=null,warmTimer=null;
 const pairKey=input=>[input.tokenIn,input.tokenOut].join(':');
 function boundedSet(map,key,value,max){
  if(!map.has(key)&&map.size>=max){const evict=[...map].find(([,entry])=>entry.settled);if(evict)map.delete(evict[0]);else throw fail('SERVICE_BUSY');}
  map.set(key,value);
 }
 function touchPair(input){
  const key=pairKey(input);if(defaults.some(pair=>pairKey(pair)===key))return;recentPairs.delete(key);recentPairs.set(key,{tokenIn:input.tokenIn,tokenOut:input.tokenOut,seenAt:clock()});
  while(recentPairs.size>3)recentPairs.delete(recentPairs.keys().next().value);
 }
 function activePairs(){
  for(const[key,pair]of recentPairs)if(clock()-pair.seenAt>=warmOptions.activeTtlMs)recentPairs.delete(key);
  const pairs=new Map(defaults.map(pair=>[pairKey(pair),pair]));
  for(const[key,pair]of [...recentPairs].reverse())if(!pairs.has(key)&&pairs.size<warmOptions.maxPairs)pairs.set(key,pair);
  return[...pairs.values()];
 }
 function context(input,consumerSignal,{warm=false,node}={}){
  const nodeId=node?.id||'primary',key=[nodeId,pairKey(input)].join(':'),old=contexts.get(key);
  // Prewarmed data is useful until the next refresh, while its original policy
  // deadline remains authoritative. Ordinary foreground reuse stays at 2.5 s.
  if(old&&!old.signal.aborted&&(!old.settled||clock()-old.completedAt<(warm?2500:old.warmed?warmOptions.intervalMs+2500:2500))){
   if(!warm||old.warmed)return old.subscribe(consumerSignal);
   return old.subscribe(consumerSignal).then(snapshot=>untilAborted(pool.run(async request=>{
    const canonical=await request({method:'eth_getBlockByNumber',params:[snapshot.block.number,false]});assertRunning(consumerSignal);
    if(canonical?.hash!==snapshot.block.hash)throw fail('STALE_BLOCK');snapshot.policy.assertFresh();if(clock()>=snapshot.policy.checkedAt+15000)throw fail('QUOTE_EXPIRED');old.warmed=true;return snapshot;
   },consumerSignal,{operation:'warm',nodeId}),consumerSignal)).catch(error=>{if(contexts.get(key)===old)contexts.delete(key);throw error;});
  }
  let entry;
  entry=sharedRead(signal=>pool.run(async request=>{
   const block=await request({method:'eth_getBlockByNumber',params:['latest',false]});assertRunning(signal);assertBlock(block,clock);
   const read=pinned(request,block),config=await readConfig(read,{block});assertRunning(signal);
   const policy=await readPolicy(read,{tokenIn:input.tokenIn,tokenOut:input.tokenOut,config,v3Mode:config.version==='2.0.0'?'all':'legacy',extraTokens:config.version==='2.0.0'?[config.defaultFeeToken]:[],block,nodeId,clock,deferCanonical:true});assertRunning(signal);policy.assertFresh();
   if(warm){const canonical=await request({method:'eth_getBlockByNumber',params:[block.number,false]});assertRunning(signal);if(canonical?.hash!==block.hash)throw fail('STALE_BLOCK');policy.assertFresh();if(clock()>=policy.checkedAt+15000)throw fail('QUOTE_EXPIRED');}
   entry.completedAt=clock();entry.warmed=warm;return{block,config,policy};
  },signal,{operation:warm?'warm':'config',nodeId}),{timeoutMs:18000,
   onSettled:error=>{if(error&&contexts.get(key)===entry)contexts.delete(key);},
   onAbandoned:()=>{if(contexts.get(key)===entry)contexts.delete(key);}});
  try{boundedSet(contexts,key,entry,32);}catch(error){entry.controller.abort();return Promise.reject(error);}return entry.subscribe(consumerSignal);
 }
 const engine={
  quote(raw,{signal}={}){
   const input=quoteInput(raw),key=JSON.stringify([input.chainId,input.tokenIn,input.tokenOut,input.amountIn,input.slippageBps,input.singleHop]);if(signal?.aborted)return Promise.reject(abortError(signal));touchPair(input);
   const old=inflight.get(key);if(old&&!old.signal.aborted)return old.subscribe(signal);
   if(warming&&warming.key!==pairKey(input))warming.controller.abort();
   foreground++;let entry;
   entry=sharedRead(sharedSignal=>pool.run(async(request,node,attemptSignal)=>{
    // Consumers share the quote lifetime; each provider attempt owns its context
    // subscription so a hedge winner releases only the losing attempt's work.
    const activeSignal=attemptSignal||sharedSignal;
    if(warming&&warming.nodeId!==(node?.id||'primary'))warming.controller.abort();
    const {block,config,policy}=await context(input,activeSignal,{node});assertRunning(activeSignal);policy.assertFresh();
    const q=await untilAborted(calculate(pinned(request,block),input,config,policy,{signal:activeSignal,nodeId:node?.id||'primary',block}),activeSignal);assertRunning(activeSignal);
    const canonical=await request({method:'eth_getBlockByNumber',params:[block.number,false]});assertRunning(activeSignal);
    if(canonical?.hash!==block.hash)throw fail('STALE_BLOCK');policy.assertFresh();
    const expiresAt=policy.checkedAt+15000;if(clock()>=expiresAt)throw fail('QUOTE_EXPIRED');
    return{schema:1,chainId:56,router:swapActiveRouter(),input,config,quote:q,blockNumber:block.number,blockHash:block.hash,quotedAt:clock(),expiresAt};
   },sharedSignal,{hedge:true,operation:'quote'}),{timeoutMs:18000,
    onSettled:()=>{foreground--;if(inflight.get(key)===entry)inflight.delete(key);},
    onAbandoned:()=>{if(inflight.get(key)===entry)inflight.delete(key);}});
   try{boundedSet(inflight,key,entry,32);}catch(error){entry.controller.abort();return Promise.reject(error);}
   return entry.subscribe(signal);
  },
  balances(raw,{signal}={}){
   const input=balanceInput(raw);if(signal?.aborted)return Promise.reject(abortError(signal));
   const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000);
   return untilAborted(balancePool.run(async request=>{
    const block=await request({method:'eth_getBlockByNumber',params:['latest',false]});assertRunning(combined);assertBlock(block,clock);
    const tokens=input.tokens.map(a=>({key:a===ZERO?'bnb':a,address:a===ZERO?null:a}));
    const result=await readBalances(pinned(request,block),input.account,tokens);assertRunning(combined);
    if(!Object.keys(result.balances).length)throw fail('BALANCE_UNAVAILABLE');
    const canonical=await request({method:'eth_getBlockByNumber',params:[block.number,false]});assertRunning(combined);if(canonical?.hash!==block.hash)throw fail('STALE_BLOCK');
    return{schema:1,chainId:56,account:input.account,blockNumber:block.number,blockHash:block.hash,readAt:clock(),balances:Object.fromEntries(tokens.filter(t=>result.balances[t.key]!=null).map(t=>[t.address||ZERO,result.balances[t.key].toString()])),failedTokens:tokens.filter(t=>result.failed.includes(t.key)).map(t=>t.address||ZERO)};
   },combined,{operation:'balances'}),combined);
  },
  async warmupOnce(){
   if(!warmOptions.enabled||foreground||warming)return false;
   const pairs=activePairs();if(!pairs.length)return false;const controller=new AbortController(),run={key:null,controller};warming=run;
   let completed=false;
   try{
    for(const input of pairs){if(foreground||controller.signal.aborted)break;run.key=pairKey(input);await pool.run((_request,node)=>{run.nodeId=node?.id||'primary';return context(input,controller.signal,{warm:true,node});},controller.signal,{operation:'warm'});completed=true;}
    return completed&&!controller.signal.aborted;
   }catch{return false;}finally{if(warming===run)warming=null;}
  },
  startWarmup(){
   if(!warmOptions.enabled||warmTimer)return;
   void engine.warmupOnce();warmTimer=setInterval(()=>{void engine.warmupOnce();},warmOptions.intervalMs);warmTimer.unref();
  },
  stopWarmup(){if(warmTimer)clearInterval(warmTimer);warmTimer=null;warming?.controller.abort();},
  isBusy(){return foreground>0||warming!==null;}
 };
 return engine;
}
const publicErrors=new Set(['INVALID_INPUT','NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','POOL_LIQUIDITY','UNSUPPORTED_VERSION','QUOTE_EXPIRED','STALE_BLOCK','BALANCE_UNAVAILABLE','SERVICE_BUSY','RATE_LIMIT','BODY_LIMIT','BODY_TIMEOUT']);
export function createApi({engine,pool,balancePool=pool,clock=Date.now,maxActive=12,rateLimit=240,allowedOrigins=['http://127.0.0.1:8124','http://localhost:8124','https://fstswap-live.vercel.app','https://fstswap-live-haocutbabas.vercel.app','https://fstswap.pro','https://www.fstswap.pro']}={}){
 const rates=new Map(),activeByRole={quote:0,balances:0},roleLimits={quote:Math.min(8,maxActive),balances:Math.min(4,maxActive)};let active=0;
 const server=createServer({headersTimeout:5000,requestTimeout:22000,maxHeaderSize:8192},async(req,res)=>{
  const origin=req.headers.origin;if(allowedOrigins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Max-Age','600');}
  const reply=(status,body)=>{if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(encode(body));};
  const routes={'/api/swap/quote':'quote','/api/swap/balances':'balances'};
  if(req.url==='/api/swap/health'&&req.method==='GET'){const health=pool.health();return reply(200,{service:'fstswap-api',version:'1',chainId:56,readOnly:true,router:swapActiveRouter(),adapters:Object.keys(SWAP_ADAPTERS),ready:health.providers.some(p=>p.ready),active,activeByRole:{...activeByRole},pool:health,balancePool:balancePool===pool?health:balancePool.health(),roles:{quote:'pool',balances:'balancePool',shared:balancePool===pool}});}
  const action=routes[req.url];if(action&&req.method==='OPTIONS'){res.writeHead(204);return res.end();}if(!action)return reply(404,{error:'NOT_FOUND'});
  if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(!/^application\/json(?:;.*)?$/i.test(req.headers['content-type']||''))return reply(415,{error:'CONTENT_TYPE'});
  const remote=req.socket.remoteAddress,header=req.headers['x-fstswap-client-ip'];
  const ip=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof header==='string'&&isIP(header)?header:remote;
  let rate=rates.get(ip);if(!rate||clock()-rate.at>60000){rate={at:clock(),count:0};if(rates.size>4096)rates.delete(rates.keys().next().value);rates.set(ip,rate);}
  if(++rate.count>rateLimit)return reply(429,{error:'RATE_LIMIT'});
  if(active>=maxActive||activeByRole[action]>=roleLimits[action])return reply(503,{error:'SERVICE_BUSY'});
  const controller=new AbortController(),disconnected=()=>{if(!res.writableEnded)controller.abort();};
  req.once('aborted',disconnected);res.once('close',disconnected);
  active++;activeByRole[action]++;let timer;
  try{
   if(Number(req.headers['content-length'])>16384)throw fail('BODY_LIMIT');
   const chunks=[];let length=0;
   timer=setTimeout(()=>req.destroy(),2000);
   for await(const chunk of req){length+=chunk.length;if(length>16384)throw fail('BODY_LIMIT');chunks.push(chunk);}
   clearTimeout(timer);let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{throw fail('INVALID_INPUT');}
   reply(200,await engine[action](body,{signal:controller.signal}));
  }catch(e){const code=publicErrors.has(e.code)?e.code:'SERVICE_UNAVAILABLE';reply(code==='INVALID_INPUT'?400:code==='BODY_LIMIT'?413:422,{error:code,...(e.code==='POOL_LIQUIDITY'&&['data','stale','oracle','price'].includes(e.reason)?{reason:e.reason}:{})});}
  finally{clearTimeout(timer);req.removeListener('aborted',disconnected);res.removeListener('close',disconnected);active--;activeByRole[action]--;}
 });
 server.keepAliveTimeout=5000;server.once('close',()=>engine.stopWarmup?.());return server;
}
export function endpointsFromEnv(env,{role='quote'}={}){
 const configured=role==='balances'&&env.FSTSWAP_BALANCE_RPC_URLS?env.FSTSWAP_BALANCE_RPC_URLS.split(','):env.FSTSWAP_RPC_URLS?env.FSTSWAP_RPC_URLS.split(','):[env.FSTSI_ROUTE_RPC_DRPC,env.FSTSI_ROUTE_RPC_BLOCKRAZOR,env.FSTSI_ROUTE_RPC_BINANCE,env.FSTSI_ROUTE_RPC_PUBLICNODE].filter(Boolean);
 const endpoints=configured.length?configured:SWAP_RPC_ENDPOINTS.slice(0,4);
 return endpoints.map(value=>{let u;try{u=new URL(value);}catch{throw fail('RPC_CONFIG');}if(u.protocol!=='https:'||u.username||u.password||u.hash)throw fail('RPC_CONFIG');return u.href;});
}
// Background measurements use separate role pools and one timer, so they never
// compete with each other. Each pool also checks its own in-flight foreground work.
export function createProbeScheduler({pool,balancePool=pool,engine,signal,timers=globalThis}={}){
 const roles=balancePool===pool?[pool]:[pool,balancePool],controller=new AbortController();
 const activeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let next=0,running=false,timer=null;
 async function probe(target){
  if(activeSignal.aborted)return;
  try{await target.probe({signal:activeSignal,busy:target===pool&&!!engine?.isBusy?.()});}catch{/* Probe failures never block foreground reads or startup. */}
 }
 async function initial(){if(running||activeSignal.aborted)return false;running=true;try{for(const target of roles){if(activeSignal.aborted)break;await probe(target);}return !activeSignal.aborted;}finally{running=false;}}
 async function tick(){if(running||activeSignal.aborted)return false;running=true;const target=roles[next];next=(next+1)%roles.length;try{await probe(target);return !activeSignal.aborted;}finally{running=false;}}
 return{initial,tick,start(){if(timer!==null||activeSignal.aborted)return;timer=timers.setInterval(()=>{void tick();},31000);timer?.unref?.();},stop(){if(timer!==null)timers.clearInterval(timer);timer=null;controller.abort();}};
}
if(process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url){
 const pool=createReadPool(endpointsFromEnv(process.env)),balancePool=process.env.FSTSWAP_BALANCE_RPC_URLS?createReadPool(endpointsFromEnv(process.env,{role:'balances'})):pool;
 const engine=createEngine(pool,{balancePool,warmup:{enabled:process.env.FSTSWAP_CONTEXT_WARMUP!=='0'}}),server=createApi({engine,pool,balancePool});
 const shutdown=new AbortController();
 const warm=()=>pool.run(async r=>{const b=await r({method:'eth_getBlockByNumber',params:['latest',false]});assertBlock(b,Date.now);},AbortSignal.any([shutdown.signal,AbortSignal.timeout(12000)]),{operation:'warm',rpcClass:'header'}).catch(()=>{});
 await warm();
 const probes=createProbeScheduler({pool,balancePool,engine,signal:shutdown.signal});
 const timer=setInterval(warm,20000);timer.unref();engine.startWarmup();
 const port=Number(process.env.FSTSWAP_API_PORT||4375);server.listen(port,'127.0.0.1',()=>{console.log('FstSwap read API ready on loopback port '+port);void probes.initial();probes.start();});
 for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>{shutdown.abort();clearInterval(timer);probes.stop();engine.stopWarmup();server.close();});
}
