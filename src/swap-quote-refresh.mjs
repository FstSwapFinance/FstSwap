// Read-only refresh lifecycle. It never connects, disconnects or prompts a wallet.
export function createQuoteRefresh({run,ready,blocked=()=>false,events=globalThis,documentEvents=globalThis.document||events,refreshMs=6000,timers=globalThis}={}){
 let timer=null,current=null,disposed=false;
 const clear=()=>{if(timer!=null)timers.clearTimeout(timer);timer=null;};
 const pause=()=>{clear();current?.abort();current=null;};
 const arm=(delay,background)=>{clear();if(!disposed&&ready())timer=timers.setTimeout(()=>{timer=null;void fire(background);},delay);};
 async function fire(background){
  if(disposed||!ready())return;
  if(blocked()){arm(1000,true);return;}
  if(current)return;
  const controller=new AbortController();current=controller;
  try{await run({signal:controller.signal,background});}catch{/* The view owns read errors; cancellation never opens an error modal. */}
  finally{if(current===controller){current=null;arm(refreshMs,true);}}
 }
 const schedule=(delay=0,{background=false}={})=>{pause();arm(delay,background);};
 const resume=()=>{pause();arm(0,true);};
 const bindings=[[documentEvents,'visibilitychange',resume],[events,'online',resume],[events,'offline',resume],[events,'pageshow',resume],[events,'pagehide',pause],[events,'hashchange',()=>dispose()]];
 function dispose(){if(disposed)return;disposed=true;pause();for(const[target,event,fn]of bindings)target?.removeEventListener?.(event,fn);}
 for(const[target,event,fn]of bindings)target?.addEventListener?.(event,fn);
 return{schedule,pause,dispose,running:()=>!!current};
}
