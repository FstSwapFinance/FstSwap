// Server-only read transport. Endpoint URLs remain in this closure and never enter diagnostics.
const METHODS=new Set(['eth_chainId','eth_getBlockByNumber','eth_call','eth_getBalance']);
const TERMINAL=new Set(['INVALID_INPUT','RPC_FORBIDDEN','NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','UNSUPPORTED_VERSION','QUOTE_EXPIRED','SERVICE_BUSY']);
const KNOWN=new Set([...TERMINAL,'STALE_BLOCK','BALANCE_UNAVAILABLE','WRONG_CHAIN','UPSTREAM_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_LIMIT','UPSTREAM_RATE_LIMIT','REQUEST_ABORTED','REQUEST_TIMEOUT']);
const LIMIT=2*1024*1024,MAX_ACTIVE=48,MAX_ATTEMPTS=3;
let globalHedges=0;
const INTERNAL_ERROR=Symbol('read-pool-error');
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
function metric(){return {samples:0,ewmaMs:0,p90Ms:0,successes:0,failures:0,values:[]};}
function observe(stats,elapsed){
 const value=Math.max(0,elapsed);stats.successes++;stats.samples++;stats.values.push(value);
 if(stats.values.length>20)stats.values.shift();
 stats.ewmaMs=stats.samples===1?value:stats.ewmaMs*0.75+value*0.25;
 const ordered=[...stats.values].sort((a,b)=>a-b);stats.p90Ms=ordered[Math.ceil(ordered.length*0.9)-1];
}
function snapshot(stats){return Object.fromEntries(Object.entries(stats).map(([key,value])=>[key,{samples:value.samples,successes:value.successes,failures:value.failures,ewmaMs:Math.round(value.ewmaMs),p90Ms:Math.round(value.p90Ms)}]));}
function retryAfter(response,now){
 const value=response.headers?.get('retry-after');
 if(!value)return 10000;
 const seconds=Number(value),date=Number.isNaN(seconds)?Date.parse(value):NaN;
 const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:10000;
 return Math.max(1000,Math.min(120000,delay));
}

export function createReadPool(endpoints,{fetchImpl=fetch,timeoutMs=4500,clock=Date.now}={}){
 let nextId=0,active=0,eligibleOperations=0;
 const operationStats=Object.create(null);
 const states=endpoints.map((url,index)=>({url,id:'upstream-'+(index+1),chainAt:null,lastOk:null,failures:0,totalFailures:0,successes:0,cooldown:0,inFlight:0,head:null,headAt:null,requests:Object.create(null),operations:Object.create(null),public:{id:'upstream-'+(index+1),chainAt:0,lastOk:0,failures:0,cooldown:0}}));
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
 function score(n,kind='read',rpcClass='call'){
  // Operation duration includes cache hits, route discovery and CPU work. Only
  // comparable real RPC measurements describe the speed of a provider.
  const method=rpcClass==='header'?'eth_getBlockByNumber':'eth_call';
  const stats=n.requests[method]?.samples?n.requests[method]:kind==='balances'&&n.requests.eth_getBalance?.samples?n.requests.eth_getBalance:null;
  const latency=stats?stats.ewmaMs*0.75+stats.p90Ms*0.25:1000;
  const failureRate=n.totalFailures/Math.max(1,n.totalFailures+n.successes);
  return (n.cooldown>clock()?1e9:0)+latency+n.failures*2500+failureRate*1000+n.inFlight*100+(headLag(n)??0)*250;
 }
 function ordered(kind,attempted,nodeId,rpcClass){return states.filter(n=>!attempted.has(n)&&n.cooldown<=clock()&&(nodeId===undefined||n.id===nodeId)).sort((a,b)=>score(a,kind,rpcClass)-score(b,kind,rpcClass)||states.indexOf(a)-states.indexOf(b));}
 async function call(node,payload,signal){
  if(signal.aborted)throw cancelled(signal);
  if(!payload||!METHODS.has(payload.method))throw fail('RPC_FORBIDDEN');
  if(active>=MAX_ACTIVE)throw fail('SERVICE_BUSY');
  const id=++nextId;
  let body;
  try{body=JSON.stringify({jsonrpc:'2.0',id,method:payload.method,params:payload.params??[]});}catch{throw fail('INVALID_INPUT');}
  if(Buffer.byteLength(body)>LIMIT)throw fail('UPSTREAM_LIMIT');
  const stats=node.requests[payload.method]??=metric();
  const started=clock(),controller=new AbortController();let timedOut=false;
  const onAbort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  active++;
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
   observe(stats,clock()-started);
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
 function recordFailure(node,error){
  node.failures++;node.totalFailures++;
  const delay=error.code==='UPSTREAM_RATE_LIMIT'?error.retryAfterMs:Math.min(60000,5000*2**Math.min(node.failures,4));
  node.cooldown=Math.max(node.cooldown,clock()+delay);sync(node);
 }
 return {
  nodes,
  run(operation,signal=new AbortController().signal,options={}){
   if(signal.aborted)return Promise.reject(cancelled(signal));
   if(typeof operation!=='function')return Promise.reject(fail('INVALID_INPUT'));
   const nodeId=options.nodeId;
   if(nodeId!==undefined&&!states.some(n=>n.id===nodeId))return Promise.reject(fail('INVALID_INPUT'));
   const kind=['quote','balances','config','warm'].includes(options.operation)?options.operation:'read';
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
      hedgeStarted=true;globalHedges++;start(backup,true);
     },hedgeDelay);
    }
    function start(node,isHedge=false){
     attempts++;attempted.add(node);node.inFlight++;
     const controller=new AbortController(),entry={controller,isHedge};running.set(node,entry);
     const started=clock();
     const attempt=(async()=>{
      const request=payload=>call(node,payload,controller.signal);
      if(node.chainAt===null||clock()-node.chainAt>=10000){
       if(await request({method:'eth_chainId',params:[]})!=='0x38')throw fail('WRONG_CHAIN');
       node.chainAt=clock();sync(node);
      }
      if(controller.signal.aborted)throw cancelled(controller.signal);
      return operation(request,node.public,controller.signal);
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
      running.delete(node);node.inFlight--;if(isHedge)globalHedges--;
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
  health(){
   return {active,activeHedges:globalHedges,providers:states.map(n=>({id:n.id,ready:n.lastOk!==null&&clock()-n.lastOk<60000&&n.cooldown<=clock(),failures:n.failures,totalFailures:n.totalFailures,successes:n.successes,inFlight:n.inFlight,cooldownMs:Math.max(0,n.cooldown-clock()),headLag:headLag(n),headObservedAt:n.headAt,score:Math.round(score(n)),requests:snapshot(n.requests),operations:snapshot(n.operations)}))};
  }
 };
}
