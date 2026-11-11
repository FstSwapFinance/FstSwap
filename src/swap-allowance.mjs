const ADDRESS=/^0x[0-9a-f]{40}$/i,ZERO='0x'+'00'.repeat(20);
const ABI=['function allowance(address,address) view returns(uint256)'];
const abortError=()=>new DOMException('Allowance read canceled','AbortError');
function checkSignal(signal){if(signal?.aborted)throw abortError();}
function address(value){
 if(typeof value!=='string'||!ADDRESS.test(value)||value.toLowerCase()===ZERO)throw new Error('Invalid allowance identity');
 return value.toLowerCase();
}

// A short display cache. Transaction and receipt checks must request fresh data.
export function createAllowanceReader(request,{clock=Date.now,ttlMs=3000}={}){
 if(typeof request!=='function'||typeof clock!=='function'||!Number.isFinite(ttlMs)||ttlMs<0)throw new TypeError('Invalid allowance reader');
 const codec=new globalThis.ethers.Interface(ABI),entries=new Map();
 const remove=entry=>{if(entries.get(entry.key)===entry)entries.delete(entry.key);};
 function remember(entry){
  entries.delete(entry.key);entries.set(entry.key,entry);
  while(entries.size>32)entries.delete(entries.keys().next().value);
 }
 function subscribe(entry,signal){
  return new Promise((resolve,reject)=>{
   let done=false;
   const subscriber={finish(ok,value){
    if(done)return;done=true;
    if(signal?.aborted){ok=false;value=abortError();}
    if(ok)entry.delivered=true;
    entry.subscribers.delete(subscriber);signal?.removeEventListener('abort',onAbort);
    // Nobody still wants this request: its eventual response has no cache rights.
    if(!entry.subscribers.size&&!entry.delivered){remove(entry);entry.controller.abort();}
    if(ok)resolve(value);else reject(value);
   }};
   const onAbort=()=>subscriber.finish(false,abortError());
   entry.subscribers.add(subscriber);signal?.addEventListener('abort',onAbort,{once:true});
   if(signal?.aborted)onAbort();
  });
 }
 function settle(entry,ok,value){
  entry.pending=false;
  if(ok&&entry.cacheable&&entry.subscribers.size){entry.value=value;entry.completedAt=clock();}
  else remove(entry);
  for(const subscriber of [...entry.subscribers])subscriber.finish(ok,value);
 }
 async function run(entry,payload){
  try{
   const raw=await request(payload,{signal:entry.controller.signal,fresh:entry.fresh});
   if(typeof raw!=='string'||!/^0x[0-9a-f]{64}$/i.test(raw))throw new Error('Invalid allowance response');
   const value=BigInt(codec.decodeFunctionResult('allowance',raw)[0]);
   settle(entry,true,value);
  }catch(error){settle(entry,false,error);}
 }
 return{
  async read({chainId,account,token,spender}={},{fresh=false,blockTag='latest',signal}={}){
   if(typeof fresh!=='boolean'||(signal!=null&&(typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function')))throw new TypeError('Invalid allowance read options');
   checkSignal(signal);
   if(chainId!==56)throw new Error('Invalid allowance chain');
   account=address(account);token=address(token);spender=address(spender);
   if(typeof blockTag!=='string'||!(/^(latest|pending|earliest|safe|finalized)$/.test(blockTag)||/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(blockTag)))throw new Error('Invalid allowance block tag');
   const key=[chainId,account,token,spender].join(':'),cacheable=blockTag==='latest';
   let entry=entries.get(key);
   if(!fresh&&cacheable&&entry?.cacheable){
    if(entry.pending)return subscribe(entry,signal);
    const now=clock();checkSignal(signal);
    if(now>=entry.completedAt&&now-entry.completedAt<ttlMs){remember(entry);return entry.value;}
   }
   entry={key,cacheable,pending:true,subscribers:new Set(),delivered:false,fresh,controller:new AbortController()};remember(entry);
   const result=subscribe(entry,signal);
   if(entry.subscribers.size)void run(entry,{method:'eth_call',params:[{to:token,data:codec.encodeFunctionData('allowance',[account,spender])},blockTag]});
   return result;
  },
  invalidate(){entries.clear();}
 };
}
