import {measurePhase,countTiming} from './swap-timing.mjs';
// Server-only read transport. Endpoint URLs remain in this closure and never enter diagnostics.
const METHODS=new Set(['eth_chainId','eth_getBlockByNumber','eth_call','eth_getBalance']);
const TERMINAL=new Set(['INVALID_INPUT','RPC_FORBIDDEN','NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','TAX_UNVERIFIED','PRICE_IMPACT_TOO_HIGH','UNSUPPORTED_VERSION','QUOTE_EXPIRED','SERVICE_BUSY']);
const KNOWN=new Set([...TERMINAL,'STALE_BLOCK','BALANCE_UNAVAILABLE','WRONG_CHAIN','UPSTREAM_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_LIMIT','UPSTREAM_RATE_LIMIT','REQUEST_ABORTED','REQUEST_TIMEOUT']);
const LIMIT=2*1024*1024,MAX_ACTIVE=48,MAX_ATTEMPTS=3;
const SIMULATION_TIMEOUT=1500,SIMULATION_RETRY=10000;
let globalHedges=0;
const INTERNAL_ERROR=Symbol('read-pool-error'),PROBE_READ=Symbol('fixed-background-probe'),CHAIN_GUARD_FAILURE=Symbol('physical-chain-guard-failure');
const PROBE_TOKEN='0x55d398326f99059ff775485246999027b3197955',PROBE_DATA='0x313ce567',MEASUREMENT_TTL=300000;
// The tax model verifies this token's runtime bytecode at the quote block.
const FSTSI_TAX_TOKEN='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e';
function pinnedTaxCodeCall(payload){
 return payload.method==='eth_getCode'&&Array.isArray(payload.params)&&payload.params.length===2
  &&typeof payload.params[0]==='string'&&payload.params[0].toLowerCase()===FSTSI_TAX_TOKEN
  &&typeof payload.params[1]==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(payload.params[1]);
}
const fail=(code,extra)=>Object.assign(new Error(code),{code,[INTERNAL_ERROR]:true},extra);
const terminal=e=>TERMINAL.has(e?.code)||(typeof e?.code==='string'&&e.code.startsWith('POOL')&&e.retryable!==true);
const cancelled=signal=>fail(signal?.reason?.name==='TimeoutError'||signal?.reason?.code==='REQUEST_TIMEOUT'?'REQUEST_TIMEOUT':'REQUEST_ABORTED');
const safeOperationError=e=>KNOWN.has(e?.code)||(typeof e?.code==='string'&&e.code.startsWith('POOL'))?e:fail('UPSTREAM_UNAVAILABLE');
function abortable(promise,signal){
 if(signal.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(cancelled(signal));}
 return new Promise((resolve,reject)=>{
  const onAbort=()=>{cleanup();reject(cancelled(signal));};
  const cleanup=()=>signal.removeEventListener('abort',onAbort);
  signal.addEventListener('abort',onAbort,{once:true});
  Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
}
function metric(){return {samples:0,ewmaMs:0,p90Ms:0,successes:0,failures:0,observedAt:null,values:[]};}
function observe(stats,elapsed,observedAt){
 if(observedAt!==undefined)stats.observedAt=observedAt;
 const value=Math.max(0,elapsed);stats.successes++;stats.samples++;stats.values.push(value);
 if(stats.values.length>20)stats.values.shift();
 stats.ewmaMs=stats.samples===1?value:stats.ewmaMs*0.75+value*0.25;
 const ordered=[...stats.values].sort((a,b)=>a-b);stats.p90Ms=ordered[Math.ceil(ordered.length*0.9)-1];
}
function snapshot(stats){return Object.fromEntries(Object.entries(stats).map(([key,value])=>[key,{samples:value.samples,successes:value.successes,failures:value.failures,ewmaMs:Math.round(value.ewmaMs),p90Ms:Math.round(value.p90Ms),observedAt:value.observedAt}]));}
function retryAfter(response,now){
 const value=response.headers?.get('retry-after');
 if(!value)return 10000;
 const seconds=Number(value),date=Number.isNaN(seconds)?Date.parse(value):NaN;
 const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:10000;
 return Math.max(1000,Math.min(120000,delay));
}

export function createReadPool(endpoints,{fetchImpl=fetch,timeoutMs=4500,clock=Date.now,probeIntervalMs=30000}={}){
 let nextId=0,active=0,eligibleOperations=0,ownHedges=0,probing=false,lastProbeStartedAt=null,activeProbeController=null;
 const probeInterval=Math.max(30000,Number(probeIntervalMs)||30000);
 const operationStats=Object.create(null);
 const states=endpoints.map((url,index)=>({url,id:'upstream-'+(index+1),chainAt:null,chainGuard:null,lastOk:null,failures:0,totalFailures:0,successes:0,cooldown:0,inFlight:0,probeInFlight:0,head:null,headAt:null,lastProbeAt:null,lastProbeOk:null,requests:Object.create(null),probeRequests:Object.create(null),operations:Object.create(null),public:{id:'upstream-'+(index+1),chainAt:0,lastOk:0,failures:0,cooldown:0}}));
 const nodes=states.map(n=>n.public);
 function sync(n){Object.assign(n.public,{id:n.id,chainAt:n.chainAt??0,lastOk:n.lastOk??0,failures:n.failures,cooldown:n.cooldown});}
 function headLag(n){
  const now=clock();
  if(n.head===null||n.headAt===null||now-n.headAt>5000||now<n.headAt)return null;
  // Headers taken many blocks apart in time cannot show relative provider lag.
  const peers=states.filter(peer=>peer!==n&&peer.head!==null&&peer.headAt!==null&&now>=peer.headAt&&now-peer.headAt<=5000&&Math.abs(peer.headAt-n.headAt)<=1000);
  if(!peers.length)return null;
  const highest=peers.reduce((head,peer)=>peer.head>head?peer.head:head,n.head),lag=highest-n.head;
  return Number(lag>1000000n?1000000n:lag);
 }
 function recent(stats){return !!stats?.samples&&stats.observedAt!==null&&clock()>=stats.observedAt&&clock()-stats.observedAt<=MEASUREMENT_TTL;}
 function latency(n,kind='read',rpcClass='call'){
  const method=rpcClass==='header'?'eth_getBlockByNumber':'eth_call';
  const real=recent(n.requests[method])?n.requests[method]:kind==='balances'&&recent(n.requests.eth_getBalance)?n.requests.eth_getBalance:null;
  // A cheap fixed-call probe is an approximation. It never dilutes a recent
  // production measurement, and gets a conservative margin when used alone.
  if(real)return {ms:real.ewmaMs*0.75+real.p90Ms*0.25,source:'real'};
  const probe=n.probeRequests[method];
  if(recent(probe))return {ms:(probe.ewmaMs*0.75+probe.p90Ms*0.25)*1.25,source:'probe'};
  return {ms:1000,source:'unknown'};
 }
 function score(n,kind='read',rpcClass='call'){
  const failureRate=n.totalFailures/Math.max(1,n.totalFailures+n.successes);
  return (n.cooldown>clock()?1e9:0)+latency(n,kind,rpcClass).ms+n.failures*2500+failureRate*1000+Math.max(0,n.inFlight-n.probeInFlight)*100+(headLag(n)??0)*250;
 }
 function ordered(kind,attempted,nodeId,rpcClass){
  const candidates=states.filter(n=>!attempted.has(n)&&n.cooldown<=clock()&&(nodeId===undefined||n.id===nodeId));
  // Until a call has been measured, foreground work can reuse a node whose
  // chain and startup header were just checked. An in-progress warmup must
  // not make an entirely untested provider win that first foreground request.
  const coldForeground=nodeId===undefined&&rpcClass==='call'&&['quote','balances','read'].includes(kind)&&candidates.every(n=>latency(n,kind,rpcClass).source==='unknown');
  const now=clock(),fresh=(at,ttl)=>at!==null&&now>=at&&now-at<ttl;
  const bootstrap=new Set(coldForeground?candidates.filter(n=>n.failures===0&&fresh(n.chainAt,10000)&&n.head!==null&&fresh(n.headAt,5000)&&fresh(n.lastOk,5000)&&(headLag(n)??0)<=2):[]);
  return candidates.sort((a,b)=>Number(bootstrap.has(b))-Number(bootstrap.has(a))||score(a,kind,rpcClass)-score(b,kind,rpcClass)||states.indexOf(a)-states.indexOf(b));
 }
 function call(node,payload,signal,isProbe=false){return measurePhase('rpc',()=>physicalCall(node,payload,signal,isProbe));}
 async function physicalCall(node,payload,signal,isProbe=false,simulation=false){
  if(signal.aborted)throw cancelled(signal);
  if(!payload||(!METHODS.has(payload.method)&&!pinnedTaxCodeCall(payload)))throw fail('RPC_FORBIDDEN');
  if(active>=MAX_ACTIVE)throw fail('SERVICE_BUSY');
  const id=++nextId;
  let body;
  try{body=JSON.stringify({jsonrpc:'2.0',id,method:payload.method,params:payload.params??[]});}catch{throw fail('INVALID_INPUT');}
  if(Buffer.byteLength(body)>LIMIT)throw fail('UPSTREAM_LIMIT');
  const stats=(isProbe?node.probeRequests:node.requests)[simulation?'quoteSimulation':payload.method]??=metric();
  const started=clock(),controller=new AbortController();let timedOut=false;
  const onAbort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},simulation?Math.min(timeoutMs,SIMULATION_TIMEOUT):timeoutMs);
  active++;countTiming('rpc_http');countTiming('rpc_calls');countTiming('rpc_bytes',Buffer.byteLength(body));
  try{
   const response=await abortable(Promise.resolve().then(()=>fetchImpl(node.url,{method:'POST',headers:{'content-type':'application/json'},body,signal:controller.signal})),controller.signal);
   if(!response.ok){
    // Cancel unconsumed bodies so an HTTP failure cannot retain a connection.
    try{await response.body?.cancel();}catch{}
    throw response.status===429||response.status===503&&response.headers?.get('retry-after')?fail('UPSTREAM_RATE_LIMIT',{retryAfterMs:retryAfter(response,clock())}):fail('UPSTREAM_UNAVAILABLE');
   }
   const chunks=[];let bytes=0;
   if(!response.body)throw fail('UPSTREAM_UNAVAILABLE');
   const reader=response.body.getReader();
   try{
    while(true){
     const {done,value}=await abortable(reader.read(),controller.signal);if(done)break;
     bytes+=value.byteLength;if(bytes>LIMIT)throw fail('UPSTREAM_LIMIT');chunks.push(value);
    }
   }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail('UPSTREAM_UNAVAILABLE');}
   if(data?.id!==id||data.error||!Object.hasOwn(data,'result'))throw fail('UPSTREAM_UNAVAILABLE');
   observe(stats,clock()-started,clock());
   if(payload.method==='eth_getBlockByNumber'&&payload.params?.[0]==='latest'&&/^0x[0-9a-f]+$/i.test(data.result?.number)){
    node.head=BigInt(data.result.number);node.headAt=clock();
   }
   return data.result;
  }catch(error){
   if(signal.aborted)throw cancelled(signal);
   stats.failures++;
   if(timedOut)throw fail('UPSTREAM_TIMEOUT');
   if(error?.[INTERNAL_ERROR])throw error;
   throw fail('UPSTREAM_UNAVAILABLE');
  }finally{active--;clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
 }
 // Creation-style eth_call is optional. Keep its failures separate from the
 // ordinary read path, while honoring node-wide rate limits and cancellation.
 async function simulateQuote(node,payload,signal,decode){
  if(signal.aborted)throw cancelled(signal);
  const delay=(node.simulationRetryAt??0)-clock();
  if(delay>0&&delay<=SIMULATION_RETRY)return null;
  countTiming('quote_pipeline_attempts');
  let raw;
  try{raw=await measurePhase('rpc',()=>physicalCall(node,payload,signal,false,true));}
  catch(error){
   if(signal.aborted||!['UPSTREAM_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_LIMIT'].includes(error.code))throw error;
  }
  if(signal.aborted)throw cancelled(signal);
  const result=raw===undefined?null:decode(raw);
  if(result!==null)return result;
  node.simulationRetryAt=clock()+SIMULATION_RETRY;
  countTiming('quote_pipeline_fallbacks');
  return null;
 }
 // One HTTP request may carry the pinned balance call and its canonical header.
 // Two items is the budget. A node that rejects batches is remembered and is not penalized.
 function callMany(node,payloads,signal,isProbe=false){return measurePhase('rpc',()=>physicalCallMany(node,payloads,signal,isProbe));}
 async function physicalCallMany(node,payloads,signal,isProbe=false){
  if(signal.aborted)throw cancelled(signal);
  if(!Array.isArray(payloads)||payloads.length<1||payloads.length>2||payloads.some(payload=>!payload||!METHODS.has(payload.method)))throw fail(payloads?.some?.(payload=>payload&&!METHODS.has(payload.method))?'RPC_FORBIDDEN':'INVALID_INPUT');
  if(node.batchSupported===false)throw fail('BATCH_UNSUPPORTED');
  if(active>=MAX_ACTIVE)throw fail('SERVICE_BUSY');
  const items=payloads.map(payload=>({jsonrpc:'2.0',id:++nextId,method:payload.method,params:payload.params??[]}));
  let body;try{body=JSON.stringify(items);}catch{throw fail('INVALID_INPUT');}
  if(Buffer.byteLength(body)>LIMIT)throw fail('UPSTREAM_LIMIT');
  const stats=items.map(item=>(isProbe?node.probeRequests:node.requests)[item.method]??=metric());
  const started=clock(),controller=new AbortController();let timedOut=false;
  const onAbort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  active++;countTiming('rpc_http');countTiming('rpc_calls',items.length);countTiming('rpc_batches');countTiming('rpc_bytes',Buffer.byteLength(body));
  const unsupported=()=>{const error=fail('BATCH_UNSUPPORTED');node.batchSupported=false;throw error;};
  try{
   const response=await abortable(Promise.resolve().then(()=>fetchImpl(node.url,{method:'POST',headers:{'content-type':'application/json'},body,signal:controller.signal})),controller.signal);
   if(!response.ok){
    try{await response.body?.cancel();}catch{}
    if(response.status===400||response.status===405||response.status===415)unsupported();
    throw response.status===429||response.status===503&&response.headers?.get('retry-after')?fail('UPSTREAM_RATE_LIMIT',{retryAfterMs:retryAfter(response,clock())}):fail('UPSTREAM_UNAVAILABLE');
   }
   const chunks=[];let bytes=0;
   if(!response.body)throw fail('UPSTREAM_UNAVAILABLE');
   const reader=response.body.getReader();
   try{
    while(true){
     const {done,value}=await abortable(reader.read(),controller.signal);if(done)break;
     bytes+=value.byteLength;if(bytes>LIMIT)throw fail('UPSTREAM_LIMIT');chunks.push(value);
    }
   }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail('UPSTREAM_UNAVAILABLE');}
   if(!Array.isArray(data))unsupported();
   const byId=new Map(data.map(item=>[item?.id,item]));
   if(items.some(item=>{const row=byId.get(item.id);return !row||row.error||!Object.hasOwn(row,'result');}))throw fail('UPSTREAM_UNAVAILABLE');
   const elapsed=clock()-started;
   for(const item of stats)observe(item,elapsed,clock());
   node.batchSupported=true;
   const chainItem=items.find(item=>item.method==='eth_chainId');
   const verifiedHead=!chainItem||byId.get(chainItem.id).result==='0x38';
   for(const item of items){
    const result=byId.get(item.id).result;
    if(verifiedHead&&item.method==='eth_getBlockByNumber'&&item.params?.[0]==='latest'&&/^0x[0-9a-f]+$/i.test(result?.number)){node.head=BigInt(result.number);node.headAt=clock();}
   }
   return items.map(item=>byId.get(item.id).result);
  }catch(error){
   if(error?.code==='BATCH_UNSUPPORTED')throw error;
   if(signal.aborted)throw cancelled(signal);
   for(const item of stats)item.failures++;
   if(timedOut)throw fail('UPSTREAM_TIMEOUT');
   if(error?.[INTERNAL_ERROR])throw error;
   throw fail('UPSTREAM_UNAVAILABLE');
  }finally{active--;clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
 }
 const bootstrapResult=(block,observedAt)=>Object.freeze({block:Object.freeze({number:block?.number,hash:block?.hash,timestamp:block?.timestamp}),observedAt});
 async function readBootstrap(node,signal,isProbe){
  const observedAt=clock(),block=await call(node,{method:'eth_getBlockByNumber',params:['latest',false]},signal,isProbe);
  if(signal.aborted)throw cancelled(signal);
  return bootstrapResult(block,observedAt);
 }
 function verifyChain(node,signal,isProbe,wantsBootstrap=false,freshBootstrap=false){
  if(signal.aborted)return Promise.reject(cancelled(signal));
  const age=node.chainAt===null?Infinity:clock()-node.chainAt;
  if(!isProbe&&age>=0&&age<10000)return wantsBootstrap?readBootstrap(node,signal,isProbe):Promise.resolve(null);
  // Ordinary operations share the in-flight guard, with their own right to
  // cancel. An opted-in leader may include a completed primitive latest header;
  // neither the header nor its reader is cached after this guard settles.
  // A fixed background probe always measures a new physical chain read.
  let entry=isProbe?null:node.chainGuard,created=false;
  if(!entry||entry.controller.signal.aborted){
   created=true;
   entry={controller:new AbortController(),consumers:new Set(),settled:false,failureRecorded:false,bootstrap:wantsBootstrap};
   if(!isProbe)node.chainGuard=entry;
   entry.promise=Promise.resolve().then(async()=>{
    let chain,verifiedAt,bootstrap=null;
    if(entry.bootstrap){
     const observedAt=clock();
     try{
      const [value,block]=await callMany(node,[{method:'eth_chainId',params:[]},{method:'eth_getBlockByNumber',params:['latest',false]}],entry.controller.signal,isProbe);
      chain=value;bootstrap=bootstrapResult(block,observedAt);
     }catch(error){
      if(error.code!=='BATCH_UNSUPPORTED')throw error;
      chain=await call(node,{method:'eth_chainId',params:[]},entry.controller.signal,isProbe);
      if(chain!=='0x38')throw fail('WRONG_CHAIN');
      verifiedAt=clock();
      bootstrap=await readBootstrap(node,entry.controller.signal,isProbe);
     }
    }else chain=await call(node,{method:'eth_chainId',params:[]},entry.controller.signal,isProbe);
    if(entry.controller.signal.aborted)throw cancelled(entry.controller.signal);
    if(chain!=='0x38')throw fail('WRONG_CHAIN');
    node.chainAt=verifiedAt??clock();sync(node);
    return bootstrap;
   }).catch(error=>{
    if(!entry.controller.signal.aborted)Object.defineProperty(error,CHAIN_GUARD_FAILURE,{value:entry});
    throw error;
   }).finally(()=>{
    entry.settled=true;if(node.chainGuard===entry)node.chainGuard=null;
   });
   // An upstream implementation may settle after its last consumer canceled.
   entry.promise.catch(()=>{});
  }
  const verified=new Promise((resolve,reject)=>{
   const consumer={},leave=()=>{signal.removeEventListener('abort',abort);return entry.consumers.delete(consumer);};
   const abort=()=>{
    if(!leave())return;
    reject(cancelled(signal));
    if(!entry.settled&&!entry.consumers.size){
     if(node.chainGuard===entry)node.chainGuard=null;
     entry.controller.abort(signal.reason);
    }
   };
   entry.consumers.add(consumer);signal.addEventListener('abort',abort,{once:true});
   entry.promise.then(value=>{if(leave())resolve(value);},error=>{if(leave())reject(error);});
   if(signal.aborted)abort();
  });
  // A fresh reader joining an older guard shares only its chain proof. Its own
  // latest RPC must begin after that reader arrived, even within the same ms.
  return wantsBootstrap?verified.then(bootstrap=>bootstrap&&(!freshBootstrap||created)?bootstrap:readBootstrap(node,signal,isProbe)):verified;
 }
 function recordFailure(node,error){
  const guard=error[CHAIN_GUARD_FAILURE];
  if(guard){if(guard.failureRecorded)return;guard.failureRecorded=true;}
  node.failures++;node.totalFailures++;
  const delay=error.code==='UPSTREAM_RATE_LIMIT'?error.retryAfterMs:Math.min(60000,5000*2**Math.min(node.failures,4));
  node.cooldown=Math.max(node.cooldown,clock()+delay);sync(node);
 }
 const pool={
  nodes,
  run(operation,signal=new AbortController().signal,options={}){
   if(signal.aborted)return Promise.reject(cancelled(signal));
   if(typeof operation!=='function')return Promise.reject(fail('INVALID_INPUT'));
   if(options.bootstrapLatest!==undefined&&typeof options.bootstrapLatest!=='boolean'&&typeof options.bootstrapLatest!=='function')return Promise.reject(fail('INVALID_INPUT'));
   if(options.freshBootstrap!==undefined&&typeof options.freshBootstrap!=='boolean')return Promise.reject(fail('INVALID_INPUT'));
   const nodeId=options.nodeId;
   if(nodeId!==undefined&&!states.some(n=>n.id===nodeId))return Promise.reject(fail('INVALID_INPUT'));
   const isProbe=options[PROBE_READ]===true;
   // Foreground work always takes priority over an in-progress background read.
   if(!isProbe)activeProbeController?.abort();
   const kind=isProbe?'probe':['quote','balances','config','warm'].includes(options.operation)?options.operation:'read';
   const rpcClass=options.rpcClass==='header'?'header':'call';
   const candidates=states.filter(n=>n.cooldown<=clock());
   const hedgeEligible=nodeId===undefined&&options.hedge===true&&candidates.length>=2;
   // Reserving every fifth eligible operation prevents a burst of slow requests
   // from turning all traffic into duplicate RPC work.
   const permitHedge=hedgeEligible&&++eligibleOperations%5===0;
   const history=operationStats[kind];
   const hedgeDelay=history?.samples?Math.max(1500,history.p90Ms*1.5):2500;
   return new Promise((resolve,reject)=>{
    let settled=false,attempts=0,lastError,hedgeTimer,hedgeStarted=false;
    const attempted=new Set(),running=new Map();
    const clearHedge=()=>{clearTimeout(hedgeTimer);hedgeTimer=undefined;};
    function finish(error,result){
     if(settled)return;settled=true;clearHedge();signal.removeEventListener('abort',onAbort);
     for(const entry of running.values())entry.controller.abort();
     if(error)reject(error);else resolve(result);
    }
    const onAbort=()=>finish(cancelled(signal));
    signal.addEventListener('abort',onAbort,{once:true});
    function scheduleHedge(){
     if(!permitHedge||hedgeStarted||hedgeTimer!==undefined||attempts>=MAX_ATTEMPTS)return;
     hedgeTimer=setTimeout(()=>{
      hedgeTimer=undefined;
      if(settled||running.size!==1||globalHedges>=2||attempts>=MAX_ATTEMPTS)return;
      const backup=ordered(kind,attempted,nodeId,rpcClass).find(n=>n.cooldown<=clock());
      if(!backup)return;
      hedgeStarted=true;globalHedges++;ownHedges++;start(backup,true);
     },hedgeDelay);
    }
    function start(node,isHedge=false){
     attempts++;attempted.add(node);node.inFlight++;if(isProbe)node.probeInFlight++;
     const controller=new AbortController(),entry={controller,isHedge};running.set(node,entry);
     const started=clock();
     const attempt=(async()=>{
      const request=payload=>call(node,payload,controller.signal,isProbe);
      request.batch=payloads=>callMany(node,payloads,controller.signal,isProbe);
      if(!isProbe)request.quoteSimulation=(payload,decode=value=>value)=>simulateQuote(node,payload,controller.signal,decode);
      // Opt-in callers receive {block, observedAt} as the fourth argument. The
      // timestamp precedes the physical header RPC, including a cold batch.
      const wantsBootstrap=!isProbe&&(typeof options.bootstrapLatest==='function'?options.bootstrapLatest({id:node.id})===true:options.bootstrapLatest===true);
      const bootstrap=await (wantsBootstrap?measurePhase('bootstrap',()=>verifyChain(node,controller.signal,isProbe,true,options.freshBootstrap===true)):verifyChain(node,controller.signal,isProbe));
      if(controller.signal.aborted)throw cancelled(controller.signal);
      return operation(request,node.public,controller.signal,wantsBootstrap?bootstrap:null);
     })();
     abortable(attempt,controller.signal).then(result=>{
      if(settled)return;
      const elapsed=clock()-started;observe(node.operations[kind]??=metric(),elapsed);observe(operationStats[kind]??=metric(),elapsed);
      node.lastOk=clock();node.successes++;node.failures=0;node.cooldown=0;sync(node);
      finish(null,result);
     },rawError=>{
      if(settled)return;
      const error=safeOperationError(rawError);lastError=error;
      if(signal.aborted){finish(cancelled(signal));return;}
      if(terminal(error)||error.code==='REQUEST_ABORTED'||error.code==='REQUEST_TIMEOUT'){finish(error);return;}
      recordFailure(node,error);
     }).finally(()=>{
      running.delete(node);node.inFlight--;if(isProbe)node.probeInFlight--;if(isHedge){globalHedges--;ownHedges--;}
      if(settled)return;
      if(running.size===0){
       clearHedge();const next=ordered(kind,attempted,nodeId,rpcClass)[0];
       if(attempts<MAX_ATTEMPTS&&next){start(next);scheduleHedge();}else finish(lastError??fail('UPSTREAM_UNAVAILABLE'));
      }
     });
    }
    const primary=ordered(kind,attempted,nodeId,rpcClass)[0];
    if(!primary){finish(fail('UPSTREAM_UNAVAILABLE'));return;}
    start(primary);scheduleHedge();
   });
  },
  async probe(options={}){
   if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['signal','busy'].includes(key)))throw fail('INVALID_INPUT');
   const {signal,busy=false}=options;
   if(signal!==undefined&&!(signal instanceof AbortSignal)||typeof busy!=='boolean')throw fail('INVALID_INPUT');
   if(signal?.aborted)throw cancelled(signal);
   if(probing)return {status:'skipped',reason:'running'};
   if(busy||active||states.some(node=>node.inFlight))return {status:'skipped',reason:'busy'};
   if(lastProbeStartedAt!==null&&clock()-lastProbeStartedAt<probeInterval)return {status:'skipped',reason:'interval'};
   const candidates=states.filter(node=>node.cooldown<=clock());
   if(!candidates.length)return {status:'skipped',reason:states.length?'cooldown':'empty'};
   const measured=node=>recent(node.requests.eth_call)||recent(node.probeRequests.eth_call);
   candidates.sort((a,b)=>Number(measured(a))-Number(measured(b))||(a.lastProbeAt??-Infinity)-(b.lastProbeAt??-Infinity)||states.indexOf(a)-states.indexOf(b));
   const node=candidates[0];probing=true;lastProbeStartedAt=clock();node.lastProbeAt=clock();
   const controller=new AbortController();activeProbeController=controller;
   const timeout=AbortSignal.timeout(Math.min(12000,Math.max(1,timeoutMs*3))),combined=AbortSignal.any([controller.signal,timeout,...(signal?[signal]:[])]);
   try{
    await pool.run(async request=>{
     const block=await request({method:'eth_getBlockByNumber',params:['latest',false]});
     if(!/^0x[0-9a-f]{1,64}$/i.test(block?.number)||!/^0x[0-9a-f]{64}$/i.test(block?.hash)||!/^0x[0-9a-f]{1,64}$/i.test(block?.timestamp)||Math.abs(clock()/1000-Number(BigInt(block.timestamp)))>120)throw fail('STALE_BLOCK');
     const decimals=await request({method:'eth_call',params:[{to:PROBE_TOKEN,data:PROBE_DATA},block.number]});
     if(!/^0x[0-9a-f]{64}$/i.test(decimals)||BigInt(decimals)!==18n)throw fail('UPSTREAM_UNAVAILABLE');
    },combined,{nodeId:node.id,[PROBE_READ]:true});
    node.lastProbeOk=clock();return {status:'ok',id:node.id,checkedAt:node.lastProbeOk};
   }finally{if(activeProbeController===controller)activeProbeController=null;probing=false;}
  },
  health(){
   return {active,activeHedges:ownHedges,probing,providers:states.map(n=>({id:n.id,ready:n.lastOk!==null&&clock()-n.lastOk<60000&&n.cooldown<=clock(),failures:n.failures,totalFailures:n.totalFailures,successes:n.successes,inFlight:n.inFlight,cooldownMs:Math.max(0,n.cooldown-clock()),headLag:headLag(n),headObservedAt:n.headAt,lastProbeAt:n.lastProbeAt,lastProbeOk:n.lastProbeOk,measurementSource:latency(n).source,score:Math.round(score(n)),requests:snapshot(n.requests),probeRequests:snapshot(n.probeRequests),operations:snapshot(n.operations)}))};
  }
 };
 return pool;
}
