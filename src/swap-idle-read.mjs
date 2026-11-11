// A single deferred read. Foreground work may postpone it; cancellation never
// starts a replacement until the previous read has actually settled.
export function createIdleRead({run,ready=()=>true,blocked=()=>false,timers=globalThis,delayMs=300}={}) {
 if(typeof run!=='function'||typeof ready!=='function'||typeof blocked!=='function'||!Number.isFinite(delayMs)||delayMs<0)throw new TypeError('Invalid idle read options');
 let timer=null,current=null,disposed=false,generation=0;
 const clear=()=>{if(timer!==null)timers.clearTimeout(timer);timer=null;};
 function pause(){++generation;clear();current?.controller.abort();}
 function arm(ticket,delay=delayMs){
  if(disposed||ticket!==generation)return;
  clear();timer=timers.setTimeout(()=>fire(ticket),delay);
 }
 function fire(ticket){
  if(disposed||ticket!==generation)return;
  timer=null;
  if(!ready())return;
  if(blocked()||current){arm(ticket,Math.max(25,delayMs));return;}
  const entry={controller:new AbortController()};current=entry;
  Promise.resolve().then(()=>{
   if(!disposed&&ticket===generation&&!entry.controller.signal.aborted)return run({signal:entry.controller.signal});
  }).catch(()=>{/* The view owns read failures; idle work never rejects globally. */}).finally(()=>{
   if(current===entry)current=null;
  });
 }
 function schedule(){if(disposed)return;pause();arm(generation);}
 function dispose(){if(disposed)return;disposed=true;pause();}
 return{schedule,pause,dispose};
}
