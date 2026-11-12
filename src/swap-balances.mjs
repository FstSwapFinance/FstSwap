import { swapService } from './swap-service-client.mjs?v=mainnet-20261112-38';
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
   const raw=await untilAborted(request({method:'eth_call',params:[{to:MULTICALL,data:codec.encodeFunctionData('tryAggregate',[false,calls])},'latest']}),signal);
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

// Short display cache shared by page transitions and the token picker. Transaction
// refreshes use fresh:true; account/chain changes invalidate all in-flight writes.
const balanceSnapshots=new Map();
const DISPLAY_TTL_MS=5000;
let balanceEpoch=0;
export function invalidateWalletBalances(){balanceEpoch++;balanceSnapshots.clear();}
function remember(key,entry){
 balanceSnapshots.set(key,entry);
 // At most the former six 64-token batch capacities are retained.
 while(balanceSnapshots.size>384)balanceSnapshots.delete(balanceSnapshots.keys().next().value);
}
async function fetchBalances(request,account,tokens,signal){
 checkSignal(signal);
 const remote=await untilAborted(swapService.balances(account,tokens,{signal}),signal);
 checkSignal(signal);
 return remote||readTokenBalances(request,account,tokens,{signal});
}
export async function readWalletBalances(request,account,tokens,{fresh=false,clock=Date.now,signal}={}){
 if(!/^0x[0-9a-f]{40}$/i.test(account||''))throw new Error('Invalid balance account');
 checkSignal(signal);
 const wanted=[...new Map(tokens.filter(Boolean).map(t=>[t.key,{...t}])).values()],owner=account.toLowerCase();
 const identity=t=>[owner,t.key,String(t.address||'native').toLowerCase(),t.decimals??''].join(':');
 if(fresh)invalidateWalletBalances();
 const epoch=balanceEpoch;
 const checkCurrent=()=>{checkSignal(signal);if(epoch!==balanceEpoch)throw abortError();};
 if(!wanted.length)return{balances:{},failed:[]};
 // Cancellable reads own their work. Their aborts and late responses cannot
 // disturb a shared display read. Only a successful, still-current result may
 // publish completed values, without replacing another reader's pending work.
 if(signal){
  const rights=wanted.map(token=>{
   const key=identity(token),entry=balanceSnapshots.get(key),age=entry?clock()-entry.completedAt:NaN;
   return{token,key,entry,wasPending:entry?.pending===true,cached:entry?.pending===false&&age>=0&&age<DISPLAY_TTL_MS};
  });
  const completed=rights.filter(right=>right.cached),missing=rights.filter(right=>!right.cached);
  const values=await untilAborted(Promise.all(completed.map(right=>right.entry.promise)),signal);checkCurrent();
  const result=missing.length?await fetchBalances(request,account,missing.map(right=>right.token),signal):{balances:{},failed:[]};checkCurrent();
  const balances=Object.fromEntries(completed.flatMap((right,n)=>values[n]!=null?[[right.token.key,values[n]]]:[]));
  for(const {token}of missing)if(result.balances[token.key]!=null)balances[token.key]=result.balances[token.key];
  // Cache hits retain their original completion time. Resolve the clock before
  // publishing so an abort or epoch change cannot leave a late display value.
  const completedAt=missing.length?clock():null;checkCurrent();
  for(const {token,key,entry,wasPending}of missing){
   const value=balances[token.key];
   if(value!=null&&!wasPending&&balanceSnapshots.get(key)===entry)remember(key,{pending:false,completedAt,promise:Promise.resolve(value)});
  }
  return{balances,failed:wanted.filter(token=>balances[token.key]==null).map(token=>token.key)};
 }
 const selected=new Map(),missing=[];
 for(const token of wanted){
  const key=identity(token),entry=balanceSnapshots.get(key),age=entry?clock()-entry.completedAt:NaN;
  if(entry&&(entry.pending||age>=0&&age<DISPLAY_TTL_MS))selected.set(key,entry);
  else missing.push(token);
 }
 if(missing.length){
  const batch=Promise.resolve().then(()=>{checkCurrent();return fetchBalances(request,account,missing);});
  for(const token of missing){
   const key=identity(token),entry={pending:true};
   const remove=()=>{if(balanceSnapshots.get(key)===entry)balanceSnapshots.delete(key);};
   entry.promise=batch.then(result=>{
    const value=result.balances[token.key],completedAt=value!=null?clock():null;checkCurrent();entry.pending=false;
    if(value!=null)entry.completedAt=completedAt;else remove();
    return value;
   },error=>{entry.pending=false;remove();throw error;});
   selected.set(key,entry);remember(key,entry);
  }
 }
 const values=await Promise.all(wanted.map(t=>selected.get(identity(t)).promise));
 checkCurrent();
 return{balances:Object.fromEntries(wanted.flatMap((t,n)=>values[n]!=null?[[t.key,values[n]]]:[])),failed:wanted.filter((t,n)=>values[n]==null).map(t=>t.key)};
}
