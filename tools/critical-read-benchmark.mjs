#!/usr/bin/env node
// Public read-only and explicitly synthetic comparisons remain separate.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {ethers} from 'ethers';
import {benchmarkCodec,createSyntheticServiceFixture,createSyntheticLaneFixture} from './critical-read-benchmark-fixtures.mjs';

globalThis.ethers=ethers;
const here=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),options={};
for(let n=0;n<args.length;n++){
 const [key,inline]=args[n].replace(/^--/,'').split('=');
 options[key]=inline??(args[n+1]&&!args[n+1].startsWith('--')?args[++n]:true);
}
if(options.help){
 console.log('node tools/critical-read-benchmark.mjs --mode public|synthetic|all --baseline /absolute/archive --candidate /absolute/worktree --samples 3 --rpc https://bsc-rpc.publicnode.com --cases balances,quotes,warm,lanes --sides baseline,candidate --output /tmp/fstswap-critical-read.json\nPublic RPC is restricted to https://bsc-rpc.publicnode.com or https://bsc-dataseed.bnbchain.org without credentials, query, fragment or nonstandard port. A fresh genuine header pins each paired sample; wall clocks and quote expiry remain real. Synthetic uses invented responses, fixed --delay-ms 40, plus controlled release gates. No config/env/private endpoints/wallet/signing/transactions are read or used.');process.exit(0);
}
const mode=String(options.mode||'synthetic'),samples=Number(options.samples||3),delayMs=Number(options['delay-ms']??40),output=resolve(String(options.output||'/tmp/fstswap-critical-read-benchmark.json'));
if(!['public','synthetic','all'].includes(mode)||!Number.isInteger(samples)||samples<1||samples>10||!Number.isFinite(delayMs)||delayMs<0||delayMs>1000)throw Error('Invalid benchmark options');
if(!output.endsWith('.json'))throw Error('--output must end in .json');
if(typeof options.baseline!=='string'||!options.baseline)throw Error('An explicit --baseline /absolute/archive is required; see --help');
const baselineRoot=resolve(options.baseline),candidateRoot=resolve(String(options.candidate||here));
const cases=new Set(String(options.cases||'balances,quotes,warm,lanes').split(',')),sides=String(options.sides||'baseline,candidate').split(',');
if(sides.some(x=>!['baseline','candidate'].includes(x)))throw Error('Invalid sides');
if([...cases].some(x=>!['balances','quotes','warm','lanes'].includes(x)))throw Error('Invalid cases');
const publicEndpoint=new URL(String(options.rpc||'https://bsc-rpc.publicnode.com'));
if(publicEndpoint.protocol!=='https:'||!['bsc-rpc.publicnode.com','bsc-dataseed.bnbchain.org'].includes(publicEndpoint.hostname)||publicEndpoint.username||publicEndpoint.password||publicEndpoint.search||publicEndpoint.hash||publicEndpoint.port||publicEndpoint.pathname!=='/')throw Error('Only the supported public HTTPS RPC origins are allowed');
const ACCOUNT='0x3D91889209f9ca69b7Cb73D7a8C463f4deFB5c15',ZERO=ethers.ZeroAddress;
const storage=new AsyncLocalStorage(),wire=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():typeof v==='function'?undefined:v));
const stable=value=>JSON.stringify(wire(value)),sha=value=>createHash('sha256').update(value).digest('hex'),hash=value=>sha(stable(value)),round=n=>Math.round(n*100)/100;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),turn=()=>new Promise(resolve=>setImmediate(resolve));
const report={schema:1,createdAt:new Date().toISOString(),baselineCommit:'d22667a',mode,samples,delayMs,roots:{baseline:baselineRoot,candidate:candidateRoot},publicEndpoint:mode==='synthetic'?null:publicEndpoint.origin,scope:{public:'Genuine public BSC read-only RPC. A fresh paired sample pins an actual block; Date.now, snapshot ages and quote expiry are never changed. Errors and incomplete balances are excluded from valid-result latency statistics.',synthetic:'Invented contract responses and balances with real production reader/engine/route code, fixed transport delay, and an independent controlled gate experiment. Not public-network speed or mainnet readiness.',cold:'Cold means a new engine and provider pool, not a new Node process, TCP/TLS connection, OS DNS cache or zero ABI codec cache. Each quote pair gets its own cold engine before completed/new-amount/fresh variants.',warmup:'Both versions receive the same explicit USDT/FIST, BNB/USDT, USDT/BNB warmup pair list. Baseline native default warms only USDT/FIST; the candidate native default warms all three. The benchmark fixes this variable for a fair shared-snapshot comparison.',instrumentation:'Both sides buffer actual transport bodies for matching diagnostics. Stage callback durations and overlapping RPC durations are separate; phase sums are not end-to-end latency.',wallet:'No wallet, private key, signing, broadcast, deployment, remote config, .env or SSH access.'},runs:[],laneRuns:[],comparisons:[]};

const sourceFiles=['server/fstswap-service.mjs','server/swap-read-pool.mjs','server/swap-snapshot-cache.mjs','server/swap-balance-header.mjs','server/swap-timing.mjs','src/swap-aggregator.mjs','src/swap-fstswap.mjs','src/swap-liquidity.mjs','src/swap-balances.mjs','src/swap-transfer-tax.mjs','src/swap-read-codec.mjs','src/swap-service-client.mjs'];
async function sourceHashes(root){
 const pairs=await Promise.all(sourceFiles.map(async file=>{try{return[file,sha(await readFile(resolve(root,file)))];}catch(error){if(error.code==='ENOENT')return[file,null];throw error;}}));
 return Object.fromEntries(pairs);
}
async function load(root){
 const serviceSource=await readFile(resolve(root,'server/fstswap-service.mjs'),'utf8'),query=serviceSource.match(/swap-fstswap\.mjs([^']*)'/)?.[1]||'';
 const [service,aggregator,fst]=await Promise.all([import(pathToFileURL(resolve(root,'server/fstswap-service.mjs')).href),import(pathToFileURL(resolve(root,'src/swap-aggregator.mjs')).href+query),import(pathToFileURL(resolve(root,'src/swap-fstswap.mjs')).href+query)]);
 let timing=null;try{timing=await import(pathToFileURL(resolve(root,'server/swap-timing.mjs')).href);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 return {service,aggregator,fst,timing,sourceSha256:sha(serviceSource),sourceHashes:await sourceHashes(root)};
}
const modules={};for(const side of sides)modules[side]=await load(side==='baseline'?baselineRoot:candidateRoot);
report.serviceHashes=Object.fromEntries(sides.map(side=>[side,modules[side].sourceSha256]));
report.sourceHashesAtImport=Object.fromEntries(sides.map(side=>[side,modules[side].sourceHashes]));
async function persist(){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}

function decodeChildren(codec,payload){
 if(payload.method!=='eth_call')return [];
 try{return Array.from(codec.decodeFunctionData('tryAggregate',payload.params[0].data)[1],call=>({target:call.target.toLowerCase(),data:call.callData,method:codec.parseTransaction({data:call.callData})?.name||'unknown'}));}catch{return [];}
}
function classify(items,children){
 const names=new Set(children.map(c=>c.method));
 if(items.some(p=>p.method==='eth_getBlockByNumber'))return items.length>1?'balance_and_canonical':items[0].params[0]==='latest'?'latest_header':'canonical';
 if(names.has('platformFeeBps'))return 'config';
 if(names.has('latestRoundData'))return 'oracle';
 if(names.has('getPairInfo'))return 'v2';
 if(names.has('getPool')||names.has('factory'))return 'v3_discovery';
 if(names.has('slot0'))return 'v3_state';
 if(names.has('quoteExactInputSingle'))return 'v3_depth';
 if(names.has('getAmountsOutVia')||names.has('quoteExactIn'))return 'route';
 if(names.has('balanceOf')||names.has('getEthBalance'))return 'balance_read';
 return items[0].method;
}
function makeTransport(module,{network,block,fixture}){
 const codec=benchmarkCodec(module.aggregator),events=[];let active=0,maxActive=0;
 const fetchImpl=async(url,request)=>{
  const parsed=JSON.parse(request.body),items=Array.isArray(parsed)?parsed:[parsed],children=items.flatMap(p=>decodeChildren(codec,p)),category=classify(items,children);
  const start=performance.now(),event={startMs:start,methods:items.map(p=>p.method),category,innerCalls:children.length,childMethods:[...new Set(children.map(c=>c.method))],childQueryHash:hash(children.map(c=>[c.target,c.data]).sort()),quoteQueries:category==='route'?children.map(c=>[c.target,c.data]):[],requestBytes:Buffer.byteLength(request.body),batch:items.length>1,logicalParams:items.filter(p=>p.method==='eth_getBlockByNumber').map(p=>p.params[0]),phase:storage.getStore()||null};
  events.push(event);active++;maxActive=Math.max(maxActive,active);
  try{
   let body,status=200,headers={'content-type':'application/json'};
   if(network==='public'){
    const fixed=items.map(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='latest'?{...p,params:[block.number,false]}:p);
    const response=await fetch(url,{...request,body:JSON.stringify(Array.isArray(parsed)?fixed:fixed[0])});
    status=response.status;headers=Object.fromEntries(response.headers);body=await response.text();
   }else{
    await pause(delayMs);
    if(request.signal?.aborted)throw request.signal.reason;
    const rows=items.map(p=>({jsonrpc:'2.0',id:p.id,result:fixture.result(p)}));body=JSON.stringify(Array.isArray(parsed)?rows:rows[0]);
   }
   event.status=status;event.responseBytes=Buffer.byteLength(body);
   try{const data=JSON.parse(body);event.errors=(Array.isArray(data)?data:[data]).filter(p=>p.error).map(p=>({code:p.error.code,message:p.error.message}));}catch{event.invalidJson=true;}
   return new Response(body,{status,headers});
  }catch(error){event.error=error.message;throw error;}finally{event.elapsedMs=round(performance.now()-start);event.endMs=performance.now();active--;}
 };
 return {events,fetchImpl,get maxActive(){return maxActive;}};
}
async function genuineHeader(){
 const start=performance.now(),response=await fetch(publicEndpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['latest',false]}),signal:AbortSignal.timeout(10000)}),body=await response.json();
 if(!response.ok||body.error||!/^0x[0-9a-f]{64}$/i.test(body.result?.hash||'')||Math.abs(Date.now()/1000-Number(BigInt(body.result?.timestamp||0)))>120)throw Error('Public header unavailable or stale');
 return {block:body.result,acquisitionMs:round(performance.now()-start),acquiredAt:new Date().toISOString()};
}
function summarize(events){
 const intervals=events.map(e=>[e.startMs,e.endMs]).filter(e=>e.every(Number.isFinite)).sort((a,b)=>a[0]-b[0]);let occupied=0,end=-Infinity;
 for(const [start,stop]of intervals){occupied+=Math.max(0,stop-Math.max(start,end));end=Math.max(end,stop);}
 const stages={};for(const event of events){const s=stages[event.category]??={http:0,rpc:0,inner:0,requestBytes:0,elapsedSumMs:0};s.http++;s.rpc+=event.methods.length;s.inner+=event.innerCalls;s.requestBytes+=event.requestBytes;s.elapsedSumMs=round(s.elapsedSumMs+event.elapsedMs);}
 const boundaries=events.flatMap(e=>[[e.startMs,1],[e.endMs,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,max=0;for(const [,delta]of boundaries){active+=delta;max=Math.max(max,active);}
 const routeBoundaries=events.filter(e=>e.category==='route').flatMap(e=>[[e.startMs,1],[e.endMs,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let routeActive=0,routeMax=0;for(const [,delta]of routeBoundaries){routeActive+=delta;routeMax=Math.max(routeMax,routeActive);}
 const quoted=events.flatMap(e=>e.quoteQueries||[]).sort((a,b)=>stable(a).localeCompare(stable(b)));
 return {http:events.length,rpc:events.reduce((n,e)=>n+e.methods.length,0),innerCalls:events.reduce((n,e)=>n+e.innerCalls,0),httpBatches:events.filter(e=>e.batch).length,requestBytes:events.reduce((n,e)=>n+e.requestBytes,0),maxActiveHttp:max,maxActiveRouteBatches:routeMax,networkOccupiedMs:round(occupied),quoteQueryCount:quoted.length,quoteQueryHash:hash(quoted),latestHeaderHttp:events.filter(e=>e.logicalParams.includes('latest')).length,stages};
}
function extract(value,operation){
 if(operation==='warmup')return {warmed:value===true};
 if(operation==='balances'){
  if(value.failedTokens?.length||Object.keys(value.balances||{}).length!==3)throw Error('Incomplete three-token balances');
  return {blockNumber:value.blockNumber,blockHash:value.blockHash,balances:value.balances,failedTokens:value.failedTokens};
 }
 const q=value.quote,now=Date.now();
 if(!q||BigInt(q.out||0)<=0n||BigInt(q.minimum||0)<=0n||value.expiresAt<=now)throw Error('Missing, zero or expired quote');
 if(BigInt(q.minimum)!==BigInt(q.out)*(10000n-BigInt(value.input.slippageBps))/10000n)throw Error('Minimum does not match the original input slippage');
 const legs=(q.segments||[]).flatMap(s=>s.legs||[]),selected=legs.map(l=>({adapter:l.adapter,kind:l.kind,path:l.path,poolIds:l.poolIds,amountIn:l.amountIn,out:l.out,weightBps:l.weightBps}));
 return wire({blockNumber:value.blockNumber,blockHash:value.blockHash,netOut:q.out,minimum:q.minimum,lpFee:q.lpFee,feeToken:q.feeToken,feeMode:q.feeMode,expiresAt:value.expiresAt,remainingTtlMs:value.expiresAt-now,selected,selectedHash:hash(selected)});
}
function makeEngine(module,transport){
 const phases={},wrap=(name,fn)=>async(...args)=>{const started=performance.now();try{return await storage.run(name,()=>fn(...args));}finally{phases[name]=(phases[name]||0)+performance.now()-started;}};
 const pool=module.service.createReadPool([publicEndpoint.origin],{fetchImpl:transport.fetchImpl,timeoutMs:7000});
 const U=module.aggregator.SWAP_TOKENS.usdt.address.toLowerCase(),F=module.aggregator.SWAP_TOKENS.fist.address.toLowerCase();
 const pairs=[{tokenIn:U,tokenOut:F},{tokenIn:ZERO,tokenOut:U},{tokenIn:U,tokenOut:ZERO}];
 const engine=module.service.createEngine(pool,{readConfig:wrap('config',module.aggregator.readSwapConfig),readPolicy:wrap('policy',module.fst.readFstPoolPolicy),calculate:wrap('route',module.service.computeQuote),warmup:{enabled:true,pairs}});
 return {engine,phases};
}
async function measure({side,network,sample,scenario,operation,input,options,context,anchor}){
 const from=context.transport.events.length,prior={...context.phases},started=performance.now(),scope=modules[side].timing?.createTimingScope(),row={side,network,sample,scenario,operation,anchor:anchor?{number:anchor.number,hash:anchor.hash,timestamp:anchor.timestamp}:null,input};
 try{
  const task=()=>operation==='warmup'?context.engine.warmupOnce():context.engine[operation](input,options);
  const value=await(scope?scope.run(task):task());row.result=extract(value,operation);row.ok=operation!=='warmup'||value===true;
 }catch(error){row.ok=false;row.error={code:error.code||error.name,message:error.message,reason:error.reason};}
 row.elapsedMs=round(performance.now()-started);row.rpc=summarize(context.transport.events.slice(from));row.wrapperStagesMs=Object.fromEntries(Object.entries(context.phases).map(([name,n])=>[name,round(n-(prior[name]||0))]));row.runtimeTiming=scope?.snapshot()||null;
 row.events=context.transport.events.slice(from).map(({startMs,endMs,quoteQueries,...e})=>({...e,startOffsetMs:round(startMs-started),endOffsetMs:round(endMs-started)}));
 report.runs.push(row);console.log(JSON.stringify({network,side,sample,scenario,ok:row.ok,ms:row.elapsedMs,http:row.rpc.http,rpc:row.rpc.rpc,inner:row.rpc.innerCalls,error:row.error?.code}));await persist();return row;
}
async function flow(side,network,sample,group,anchor){
 const module=modules[side],fixture=network==='synthetic'?createSyntheticServiceFixture(module.aggregator):null,transport=makeTransport(module,{network,block:anchor,fixture});let context={...makeEngine(module,transport),transport};
 const U=module.aggregator.SWAP_TOKENS.usdt.address.toLowerCase(),F=module.aggregator.SWAP_TOKENS.fist.address.toLowerCase();
 const input=(a,b,n='1000000000000000000')=>({chainId:56,tokenIn:a,tokenOut:b,amountIn:n,slippageBps:50,singleHop:false});
 const run=(scenario,operation,body,opts)=>measure({side,network,sample,scenario,operation,input:body,options:opts,context,anchor});
 try{
  if(group==='balances'){
   const body={chainId:56,account:ACCOUNT,tokens:[ZERO,U,F]};
   await run('balance-cold','balances',body);await run('balance-hot','balances',body);await run('balance-fresh','balances',body,{fresh:true});
  }else if(group==='quotes'){
   for(const [id,body]of [['usdt-fist',input(U,F)],['bnb-usdt',input(ZERO,U,'1000000000000000')]]){
    if(id==='bnb-usdt'){context.engine.stopWarmup();context={...makeEngine(module,transport),transport};}
    await run('quote-'+id+'-cold','quote',body);await run('quote-'+id+'-completed','quote',body);
    await run('quote-'+id+'-new-amount','quote',{...body,amountIn:(BigInt(body.amountIn)+1n).toString()});
    await run('quote-'+id+'-fresh','quote',body,{fresh:true});
   }
   await run('quote-usdt-bnb-reverse','quote',input(U,ZERO));
  }else if(group==='warm'){
   await run('warm-three-configured-pairs','warmup');
   for(const [id,body]of [['usdt-fist',input(U,F)],['bnb-usdt',input(ZERO,U,'1000000000000000')],['usdt-bnb',input(U,ZERO)]])await run('quote-'+id+'-prewarmed','quote',body);
  }
 }finally{context.engine.stopWarmup();}
}

async function laneRun(side,sample,kind){
 const module=modules[side],fixture=createSyntheticLaneFixture(module.aggregator),events=[];let active=0,maxActive=0,done=false,rounds=0,value,error;
 const request=async payload=>{
  const rows=fixture.decode(payload),depth=rows[0].depth;
  if(rows.length>80||rows.some(r=>r.depth!==depth))throw Error('Invalid physical lane batch');
  if(events.some(e=>!e.settled&&e.depth<depth))throw Error('A dependent depth started before its predecessor settled');
  const started=performance.now(),event={depth,inner:rows.length,lanes:rows.map(r=>r.lane),startMs:started,settled:false};events.push(event);active++;maxActive=Math.max(maxActive,active);
  try{
   if(kind==='gate')await new Promise(resolve=>event.release=resolve);else await pause(delayMs);
   return fixture.encode(rows);
  }finally{event.elapsedMs=round(performance.now()-started);event.settled=true;active--;}
 };
 const started=performance.now(),task=module.fst.quoteFstRoutes(request,fixture.args).then(v=>{value=v;done=true;},e=>{error=e;done=true;});
 if(kind==='gate')for(let n=0;n<40&&!done;n++){await turn();const held=events.filter(e=>!e.settled);if(held.length){rounds++;held.forEach(e=>e.release());}await turn();}
 await task;
 const candidates=value?.candidates.map(c=>wire({out:c.out,legs:c.legs.map(l=>({kind:l.kind,path:l.path,poolIds:l.poolIds,amountIn:l.amountIn,out:l.out}))}));
 const row={side,sample,kind,ok:!error,elapsedMs:round(performance.now()-started),error:error?{code:error.code,message:error.message}:null,http:events.length,innerCalls:events.reduce((n,e)=>n+e.inner,0),maxActiveQuoteBatches:maxActive,gateReleaseRounds:kind==='gate'?rounds:null,candidates:candidates?.length,candidateHash:candidates?hash(candidates):null,out:value?.out.toString(),events:events.map(({release,startMs,...e})=>({...e,startOffsetMs:round(startMs-started)}))};
 report.laneRuns.push(row);console.log(JSON.stringify({network:'synthetic-'+kind,side,sample,ms:row.elapsedMs,http:row.http,maxActive,candidates:row.candidates,rounds:row.gateReleaseRounds}));await persist();
}

for(const network of mode==='all'?['synthetic','public']:[mode]){
 for(let sample=0;sample<samples;sample++){
  const order=sample%2?sides.slice().reverse():sides;
  for(const group of ['balances','quotes','warm'].filter(x=>cases.has(x))){
   let header;
   try{header=network==='public'?await genuineHeader():null;}catch(error){report.runs.push({network,sample,scenario:group+'-anchor',ok:false,error:{message:error.message}});await persist();continue;}
   if(header)report.anchors??=[];if(header)report.anchors.push({network,sample,group,...wire(header)});
   for(const side of order)await flow(side,network,sample,group,header?.block);
  }
  if(network==='synthetic'&&cases.has('lanes'))for(const kind of ['gate','delay'])for(const side of order)await laneRun(side,sample,kind);
 }
}
const keys=[...new Set(report.runs.filter(r=>r.side).map(r=>[r.network,r.scenario,r.sample].join('|')))];
for(const key of keys){
 const rows=report.runs.filter(r=>[r.network,r.scenario,r.sample].join('|')===key),before=rows.find(r=>r.side==='baseline'),after=rows.find(r=>r.side==='candidate');if(!before||!after)continue;
 const a=before.result,b=after.result,bothValid=before.ok&&after.ok;
 report.comparisons.push({key,bothValid,httpDelta:after.rpc.http-before.rpc.http,rpcDelta:after.rpc.rpc-before.rpc.rpc,elapsedDeltaMs:round(after.elapsedMs-before.elapsedMs),sameBlock:bothValid&&a.blockHash? a.blockHash===b.blockHash:null,sameNet:bothValid&&a.netOut?a.netOut===b.netOut:null,sameMinimum:bothValid&&a.minimum?a.minimum===b.minimum:null,sameFee:bothValid&&a.lpFee?stable([a.lpFee,a.feeToken,a.feeMode])===stable([b.lpFee,b.feeToken,b.feeMode]):null,sameSelected:bothValid&&a.selectedHash?a.selectedHash===b.selectedHash:null,sameBalances:bothValid&&a.balances?stable(a.balances)===stable(b.balances):null,quoteQueryFootprintEqual:before.rpc.quoteQueryHash===after.rpc.quoteQueryHash});
}
for(const kind of ['gate','delay'])for(let sample=0;sample<samples;sample++){
 const a=report.laneRuns.find(r=>r.side==='baseline'&&r.kind===kind&&r.sample===sample),b=report.laneRuns.find(r=>r.side==='candidate'&&r.kind===kind&&r.sample===sample);if(a&&b)report.comparisons.push({key:'synthetic-lanes-'+kind+'|'+sample,bothValid:a.ok&&b.ok,sameCandidates:a.candidateHash===b.candidateHash,sameNet:a.out===b.out,httpDelta:b.http-a.http,innerDelta:b.innerCalls-a.innerCalls,elapsedDeltaMs:round(b.elapsedMs-a.elapsedMs)});
}
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
report.summary=[];
for(const key of [...new Set(report.runs.filter(r=>r.side).map(r=>[r.network,r.side,r.scenario].join('|')))]){
 const rows=report.runs.filter(r=>[r.network,r.side,r.scenario].join('|')===key),valid=rows.filter(r=>r.ok),times=valid.map(r=>r.elapsedMs);
 report.summary.push({key,valid:valid.length,attempts:rows.length,medianMs:times.length?percentile(times,.5):null,p95Ms:times.length?percentile(times,.95):null,http:valid.map(r=>r.rpc.http),rpc:valid.map(r=>r.rpc.rpc),errors:rows.filter(r=>!r.ok).map(r=>r.error)});
}
report.sourceHashesAtFinish=Object.fromEntries(await Promise.all(sides.map(async side=>[side,await sourceHashes(side==='baseline'?baselineRoot:candidateRoot)])));
report.sourceStateUnchanged=sides.every(side=>stable(report.sourceHashesAtImport[side])===stable(report.sourceHashesAtFinish[side]));
report.findings={validRuns:report.runs.filter(r=>r.ok).length,failedRuns:report.runs.filter(r=>!r.ok).length,validPublicRuns:report.runs.filter(r=>r.network==='public'&&r.ok).length,failedPublicRuns:report.runs.filter(r=>r.network==='public'&&!r.ok).length,validSyntheticRuns:report.runs.filter(r=>r.network==='synthetic'&&r.ok).length,failedSyntheticRuns:report.runs.filter(r=>r.network==='synthetic'&&!r.ok).length,invariantFailures:report.comparisons.filter(c=>c.bothValid&&['sameBlock','sameNet','sameMinimum','sameFee','sameSelected','sameBalances','sameCandidates'].some(k=>c[k]===false))};
report.finishedAt=new Date().toISOString();await persist();
const md=['# FstSwap 关键只读路径基准','',`生成时间：${report.createdAt}。基线：\`d22667a\`。每侧样本：${samples}。`, '',
 '真实公网与合成延迟结果分别列出。公网每组使用新取得的真实区块固定读取高度，仍向原节点读取 canonical hash；没有替换 Date.now 或延长 quote expiry。失败和余额缺项不计为有效样本。阶段耗时会重叠，不能相加解释为总耗时。冷态指新 engine/provider pool，进程、TCP/TLS、DNS 和纯 ABI 缓存可能已热；各报价 pair 独立冷起。', '',
 `关键源码在测试期间保持不变：${report.sourceStateUnchanged}。SHA256 清单在 JSON 的 sourceHashesAtImport / sourceHashesAtFinish。样本量仅 ${samples}，表中 p95 是经验分位数，3 个样本时等于最大值，不能推断总体尾延迟。`, '',
 '| 网络 | 版本 | 场景 | 有效/尝试 | 中位 ms | p95 ms | HTTP | JSON-RPC |','|---|---|---|---:|---:|---:|---|---|',
 ...report.summary.map(r=>{const [network,side,scenario]=r.key.split('|');return`| ${network} | ${side} | ${scenario} | ${r.valid}/${r.attempts} | ${r.medianMs??'—'} | ${r.p95Ms??'—'} | ${r.http.join(',')} | ${r.rpc.join(',')} |`;}),'',
 '## 合成路线并发与候选一致性','',
 '| 类型 | 版本 | 样本 | ms | HTTP | 子调用 | 并发峰值 | gate 释放轮数 | 候选数 |','|---|---|---:|---:|---:|---:|---:|---:|---:|',
 ...report.laneRuns.map(r=>`| ${r.kind} | ${r.side} | ${r.sample+1} | ${r.elapsedMs} | ${r.http} | ${r.innerCalls} | ${r.maxActiveQuoteBatches} | ${r.gateReleaseRounds??'—'} | ${r.candidates??'—'} |`),'',
 '路线夹具使用 170 条独立三跳路线，每层 80/80/10，外部响应完全模拟。gate 结果说明依赖和并发预算，固定延迟结果只说明该延迟模型的关键路径。两者均不代表公网速度。', '',
 '## 对比检查','',
 '```json',JSON.stringify(report.comparisons,null,2),'```','',
 `原始 JSON：\`${output}\`。所有 RPC trace、区块、真实剩余有效期、阶段计时、调用数量、失败原因都保留在 JSON。`, '',
 '公网不存在通用速度承诺。500 ms 余额头缓存如果被公网 RTT 消耗，热样本仍可能重新读取 header；此结果应如实保留。fresh 余额应绕过头缓存且仍执行 canonical 核对。新数量和反向报价保留原始快照过期时间。', ''];
await writeFile(output.replace(/\.json$/,'.md'),md.join('\n'));
console.log(JSON.stringify({output,markdown:output.replace(/\.json$/,'.md'),runs:report.runs.length,laneRuns:report.laneRuns.length,findings:report.findings,comparisons:report.comparisons.length,sourceStateUnchanged:report.sourceStateUnchanged}));
if(report.findings.invariantFailures.length||!report.sourceStateUnchanged)process.exitCode=1;
