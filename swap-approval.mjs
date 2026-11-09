const approvalKey=({account,token,spender})=>[56,account,token,spender].map(x=>String(x||'').toLowerCase()).join(':');

export function createApprovalTracker() {
 const jobs=new Map(),listeners=new Set();
 const notify=()=>{for(const listener of listeners)if(listener()===false)listeners.delete(listener);};
 return {
  pending(identity){return jobs.has(approvalKey(identity));},
  begin(identity){const key=approvalKey(identity);if(jobs.has(key))return null;const job={...identity,key};jobs.set(key,job);notify();return job;},
  end(job){if(jobs.get(job.key)===job){jobs.delete(job.key);notify();}},
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
 };
}

const timeoutError=()=>Object.assign(new Error('交易确认暂未返回，请稍后刷新状态'),{code:'TX_TIMEOUT'});
function bounded(promise,ms) {
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeoutError()),Math.max(1,ms));})]).finally(()=>clearTimeout(timer));
}

// Bound the whole wait, including slow RPC calls; a timeout never deletes the saved intent.
export async function waitForApprovalReceipt({read,recover,hash,account,intervalMs=1500,timeoutMs=180000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
 const deadline=now()+timeoutMs;
 const limitedRead=payload=>bounded(Promise.resolve().then(()=>read(payload)),deadline-now());
 while(now()<deadline){
  try {
   const receipt=await limitedRead({method:'eth_getTransactionReceipt',params:[hash]});
   if(receipt){
    await bounded(recover({read:limitedRead,account,hash,receipt}),deadline-now());
    if(BigInt(receipt.status)===0n)throw Object.assign(new Error('交易已回滚'),{code:'TX_REVERTED'});
    return receipt;
   }
  }catch(error){
   if(['TX_TIMEOUT','TX_REVERTED','INVALID_RECEIPT','INTENT_CHANGED','TX_UNKNOWN','WALLET_LOCK_UNAVAILABLE'].includes(error?.code))throw error;
  }
  const remaining=deadline-now();if(remaining>0)await sleep(Math.min(intervalMs,remaining));
 }
 throw timeoutError();
}
