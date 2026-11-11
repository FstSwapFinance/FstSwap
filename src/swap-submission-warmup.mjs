// A page-private, single-use slot. It stores completed public reads only; it
// never owns a wallet request, pending nonce or a promise that a click must await.
export function createSubmissionWarmup({clock=Date.now,ttlMs=2000,maxRunMs=6000}={}){
 if(typeof clock!=='function'||![ttlMs,maxRunMs].every(value=>Number.isInteger(value)&&value>0))throw new TypeError('Invalid submission warmup limits');
 let current=null;
 const same=(a,b)=>a&&b&&a.quote===b.quote&&a.provider===b.provider&&a.providerRequest===b.providerRequest&&a.key===b.key;
 function cancel(){const entry=current;current=null;if(entry){clearTimeout(entry.timer);entry.detach?.();entry.controller.abort();}}
 return{
  pending(){return current?.pending===true;},
  cancel,
  start(identity,build,{signal}={}){
   if(signal?.aborted)return false;
   if(!identity||typeof identity.key!=='string'||!Number.isFinite(identity.expiresAt)||typeof build!=='function')return false;
   if(current&&same(current.identity,identity))return false;
   cancel();
   const controller=new AbortController(),entry={identity:{...identity},controller,pending:true,startedAt:clock()};current=entry;
   const abort=()=>{if(current===entry)cancel();};signal?.addEventListener('abort',abort,{once:true});entry.detach=()=>signal?.removeEventListener('abort',abort);
   entry.timer=setTimeout(abort,maxRunMs);
   Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return build({signal:controller.signal});}).then(value=>{
    if(current!==entry||controller.signal.aborted)return;
    const completedAt=clock(),expiry=value?.expiresAt??entry.identity.expiresAt;
    if(!value||typeof value!=='object'||!Number.isFinite(expiry)||completedAt<entry.startedAt){cancel();return;}
    entry.expiresAt=Math.min(completedAt+ttlMs,entry.identity.expiresAt,expiry);entry.completedAt=completedAt;
    if(entry.expiresAt<=completedAt){cancel();return;}
    clearTimeout(entry.timer);entry.pending=false;entry.value=value;
   },()=>{if(current===entry)cancel();});
   return true;
  },
  take(identity,validate=()=>true){
   const entry=current,now=clock();cancel();
   if(!entry||entry.pending||!same(entry.identity,identity)||now<entry.completedAt||now>=entry.expiresAt)return null;
   try{return validate(entry.value,{completedAt:entry.completedAt,expiresAt:entry.expiresAt})===true?entry.value:null;}catch{return null;}
  },
 };
}
