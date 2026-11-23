import { swapService } from './swap-service-client.mjs?v=mainnet-20261113-50';
const MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11';
const ABI=['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function getEthBalance(address) view returns(uint256)','function balanceOf(address) view returns(uint256)'];
const abortError=()=>new DOMException('Balance read canceled','AbortError');
function checkSignal(signal){if(signal?.aborted)throw abortError();}
function untilAborted(work,signal){
 if(!signal)return work;
 return new Promise((resolve,reject)=>{
  const finish=(fn,value)=>{signal.removeEventListener('abort',onAbort);fn(value);};
  const onAbort=()=>finish(reject,abortError());
  signal.addEventListener('abort',onAbort,{once:true});
  Promise.resolve(work).then(value=>finish(resolve,value),error=>finish(reject,error));
  if(signal.aborted)onAbort();
 });
}

// A single BSC read for native BNB and token balances. Do not cache balances:
// every post-transaction refresh must see chain state, not a pre-send value.
export async function readTokenBalances(request,account,tokens,{signal}={}) {
 if(!/^0x[0-9a-f]{40}$/i.test(account||''))throw new Error('Invalid balance account');
 checkSignal(signal);
 const codec=new globalThis.ethers.Interface(ABI),balances={},failed=[];
 const entries=[...new Map(tokens.filter(Boolean).map(t=>[t.key,t])).values()];
 for(let start=0;start<entries.length;start+=64){
  checkSignal(signal);
  const group=entries.slice(start,start+64),calls=group.map(t=>{
   const native=t.key==='bnb'&&!t.address,method=native?'getEthBalance':'balanceOf';
   return[native?MULTICALL:t.address,codec.encodeFunctionData(method,[account])];
  });
  let results;
  try {
   const raw=await untilAborted(request({method:'eth_call',params:[{to:MULTICALL,data:codec.encodeFunctionData('tryAggregate',[false,calls])},'latest']},{signal}),signal);
   checkSignal(signal);
   results=codec.decodeFunctionResult('tryAggregate',raw)[0];
   if(results.length!==group.length)throw new Error('Incomplete balance response');
  } catch { checkSignal(signal);failed.push(...group.map(t=>t.key));continue; }
  group.forEach((token,n)=>{
   const r=results[n],method=token.key==='bnb'&&!token.address?'getEthBalance':'balanceOf';
   try{if(!r.success)throw new Error('Balance unavailable');balances[token.key]=codec.decodeFunctionResult(method,r.returnData)[0];}
   catch{failed.push(token.key);}
  });
 }
 return{balances,failed};
}

// Five-second display snapshots and physical batches are shared by the header,
// pages and token lists. Each caller owns only its subscription, not the batch.
const balanceSnapshots=new Map(),balanceBatches=new Set();
const DISPLAY_TTL_MS=5000;
const balanceMonotonic=()=>globalThis.performance?.now?.()??Date.now();
let balanceEpoch=0;
export function invalidateWalletBalances(){
 balanceEpoch++;balanceSnapshots.clear();
 for(const batch of balanceBatches)batch.controller.abort();
 balanceBatches.clear();
}
function remember(key,entry){
 balanceSnapshots.set(key,entry);
 while(balanceSnapshots.size>384)balanceSnapshots.delete(balanceSnapshots.keys().next().value);
}
function removeBatchEntries(batch){
 for(const entry of batch.entries)if(balanceSnapshots.get(entry.key)===entry)balanceSnapshots.delete(entry.key);
}
function checkBatch(batch){
 checkSignal(batch.controller.signal);
 if(batch.epoch!==balanceEpoch)throw abortError();
}
// The service remains the first read. One public read may start only after this
// wait, and only while that service request is still open. It is not a second
// hedge and it cannot replace a result whose block hash changed.
export const serviceBalanceHeadStartMs=350;
function freshHeader(block){
 if(!block||typeof block.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(block.hash)||block.number==null||block.timestamp==null)return false;
 try{const stamp=Number(BigInt(block.timestamp));return Number.isFinite(stamp)&&Math.abs(Date.now()/1000-stamp)<=120;}catch{return false;}
}
async function readAnchoredTokenBalances(request,account,tokens,{signal}={}){
 checkSignal(signal);
 const header=await untilAborted(request({method:'eth_getBlockByNumber',params:['latest',false]},{signal}),signal);
 checkSignal(signal);
 if(!freshHeader(header))throw new Error('STALE_BLOCK');
 const pinned=(payload,options)=>{
  const params=payload.method==='eth_call'?[payload.params[0],header.number]:payload.method==='eth_getBalance'?[payload.params[0],header.number]:payload.params;
  return request({...payload,params},options);
 };
 const result=await readTokenBalances(pinned,account,tokens,{signal});
 checkSignal(signal);
 if(!Object.keys(result.balances).length||result.failed.length)throw new Error('BALANCE_UNAVAILABLE');
 const canonical=await untilAborted(request({method:'eth_getBlockByNumber',params:[header.number,false]},{signal}),signal);
 checkSignal(signal);
 if(canonical?.hash!==header.hash)throw new Error('STALE_BLOCK');
 return result;
}
async function fetchBalances(request,account,tokens,signal,fresh){
 checkSignal(signal);
 const serviceAbort=new AbortController(),publicAbort=new AbortController();
 const onCallerAbort=()=>{serviceAbort.abort(signal.reason);publicAbort.abort(signal.reason);};
 signal?.addEventListener('abort',onCallerAbort,{once:true});
 const serviceSignal=serviceAbort.signal,publicSignal=signal?AbortSignal.any([signal,publicAbort.signal]):publicAbort.signal;
 const remoteTask=untilAborted(swapService.balances(account,tokens,{signal:serviceSignal,fresh}),serviceSignal).then(value=>({source:'service',ok:true,value}),error=>({source:'service',ok:false,error}));
 remoteTask.catch(()=>{});
 let publicStarted=false,markPublic=()=>{};
 const publicReady=new Promise(resolve=>{markPublic=resolve;});
 const timer=setTimeout(()=>{
  if(signal?.aborted||serviceAbort.signal.aborted){markPublic({source:'public',ok:false,skipped:true});return;}
  publicStarted=true;
  readAnchoredTokenBalances(request,account,tokens,{signal:publicSignal}).then(value=>markPublic({source:'public',ok:true,value}),error=>markPublic({source:'public',ok:false,error}));
 },serviceBalanceHeadStartMs);
 try{
  const first=await Promise.race([remoteTask,publicReady]);
  checkSignal(signal);
  if(first.source==='service'){
   clearTimeout(timer);
   if(!first.ok)throw first.error;
   if(first.value){publicAbort.abort();return first.value;}
   if(publicStarted){const pub=await publicReady;checkSignal(signal);if(pub.ok)return pub.value;}
   return readTokenBalances(request,account,tokens,{signal});
  }
  clearTimeout(timer);
  if(first.ok){serviceAbort.abort();return first.value;}
  if(first.error?.name==='AbortError')throw first.error;
  const remote=await remoteTask;checkSignal(signal);
  if(!remote.ok)throw remote.error;
  if(remote.value)return remote.value;
  return readTokenBalances(request,account,tokens,{signal});
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',onCallerAbort);
  if(!publicStarted)markPublic({source:'public',ok:false,skipped:true});
 }
}
function startBatch(request,account,tokens,identity,clock,monotonic,fresh){
 const batch={controller:new AbortController(),epoch:balanceEpoch,consumers:new Set(),entries:[],settled:false};
 for(const token of tokens){
  const entry={key:identity(token),token,pending:true,batch};batch.entries.push(entry);remember(entry.key,entry);
 }
 balanceBatches.add(batch);
 batch.promise=Promise.resolve().then(()=>{checkBatch(batch);return fetchBalances(request,account,tokens,batch.controller.signal,fresh);}).then(result=>{
  checkBatch(batch);
  const completedAt=clock(),completedMono=monotonic();checkBatch(batch);
  if(!batch.consumers.size)throw abortError();
  for(const entry of batch.entries){
   const value=result.balances[entry.token.key];
   if(balanceSnapshots.get(entry.key)!==entry)continue;
   if(value==null)balanceSnapshots.delete(entry.key);
   else{entry.pending=false;entry.value=value;entry.completedAt=completedAt;entry.completedMono=completedMono;entry.batch=null;}
  }
  return result;
 }).catch(error=>{removeBatchEntries(batch);throw error;}).finally(()=>{
  batch.settled=true;balanceBatches.delete(batch);
 });
 // An abandoned transport may settle late; keep its rejection observed.
 batch.promise.catch(()=>{});
 return batch.entries;
}
function subscribeBalance(entry,signal,epoch){
 const current=()=>{checkSignal(signal);if(epoch!==balanceEpoch)throw abortError();};
 if(!entry.pending)return Promise.resolve().then(()=>{current();return entry.value;});
 const batch=entry.batch;
 return new Promise((resolve,reject)=>{
  let done=false;
  const consumer={};
  const finish=(ok,value)=>{
   if(done)return;done=true;
   batch.consumers.delete(consumer);signal?.removeEventListener('abort',onAbort);
   if(!batch.settled&&!batch.consumers.size){removeBatchEntries(batch);batch.controller.abort();}
   if(ok)resolve(value);else reject(value);
  };
  const onAbort=()=>finish(false,abortError());
  batch.consumers.add(consumer);signal?.addEventListener('abort',onAbort,{once:true});
  batch.promise.then(result=>{try{current();finish(true,result.balances[entry.token.key]);}catch(error){finish(false,error);}},error=>finish(false,error));
  if(signal?.aborted)onAbort();
 });
}
export async function readWalletBalances(request,account,tokens,{fresh=false,clock=Date.now,monotonic=balanceMonotonic,signal,chainId=56}={}){
 if(!/^0x[0-9a-f]{40}$/i.test(account||''))throw new Error('Invalid balance account');
 if(chainId!==56)throw new Error('Invalid balance chain');
 checkSignal(signal);
 const wanted=[...new Map(tokens.filter(Boolean).map(t=>[t.key,{...t}])).values()],owner=account.toLowerCase();
 const identity=t=>[chainId,owner,t.key,String(t.address||'native').toLowerCase(),t.decimals??''].join(':');
 if(fresh)invalidateWalletBalances();
 const epoch=balanceEpoch,selected=new Map(),missing=[];
 for(const token of wanted){
  checkSignal(signal);
  const key=identity(token),entry=balanceSnapshots.get(key),age=entry&&!entry.pending?clock()-entry.completedAt:NaN,monoAge=entry&&!entry.pending?monotonic()-entry.completedMono:NaN;
  checkSignal(signal);if(epoch!==balanceEpoch)throw abortError();
  // Wall-clock changes may invalidate a hit, but can never extend its lifetime.
  if(entry&&(entry.pending&&!entry.batch.controller.signal.aborted||!entry.pending&&age>=0&&age<DISPLAY_TTL_MS&&monoAge>=0&&monoAge<DISPLAY_TTL_MS))selected.set(key,entry);
  else missing.push(token);
 }
 if(missing.length)for(const entry of startBatch(request,account,missing,identity,clock,monotonic,fresh))selected.set(entry.key,entry);
 const values=await Promise.all(wanted.map(token=>subscribeBalance(selected.get(identity(token)),signal,epoch)));
 checkSignal(signal);if(epoch!==balanceEpoch)throw abortError();
 return{balances:Object.fromEntries(wanted.flatMap((t,n)=>values[n]!=null?[[t.key,values[n]]]:[])),failed:wanted.filter((t,n)=>values[n]==null).map(t=>t.key)};
}
