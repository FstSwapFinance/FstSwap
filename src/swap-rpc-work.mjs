const canceled=()=>new DOMException('RPC work canceled','AbortError');

// Foreground requests have reserved capacity. Aborted physical work keeps its
// slot until it settles, so an uncooperative transport cannot exceed the limit.
export function createRpcWorkScheduler({foregroundLimit=6,backgroundLimit=4}={}){
 if(!Number.isInteger(foregroundLimit)||foregroundLimit<1||!Number.isInteger(backgroundLimit)||backgroundLimit<1)throw new TypeError('Invalid RPC work limits');
 const lanes={foreground:{limit:foregroundLimit,queue:[],running:new Set()},background:{limit:backgroundLimit,queue:[],running:new Set()}};
 let leases=0;
 function finish(entry,ok,value){
  if(entry.done)return;entry.done=true;
  entry.caller?.removeEventListener('abort',entry.onAbort);
  if(ok)entry.resolve(value);else entry.reject(value);
 }
 function abort(entry){
  if(entry.done)return;
  if(!entry.started){const index=entry.lane.queue.indexOf(entry);if(index!==-1)entry.lane.queue.splice(index,1);}
  entry.controller.abort(canceled());finish(entry,false,canceled());
 }
 function drain(){
  for(const priority of ['foreground','background']){
   const lane=lanes[priority];
   while(lane.queue.length&&lane.running.size<lane.limit&&(priority==='foreground'||leases===0)){
    const entry=lane.queue.shift();if(entry.done)continue;
    entry.started=true;lane.running.add(entry);
    let work;try{work=entry.task({signal:entry.controller.signal});}catch(error){work=Promise.reject(error);}
    Promise.resolve(work).then(value=>finish(entry,true,value),error=>finish(entry,false,error)).finally(()=>{lane.running.delete(entry);drain();});
   }
  }
 }
 return{
  run(task,{priority='background',signal}={}){
   if(typeof task!=='function'||!Object.hasOwn(lanes,priority)||(signal!=null&&(typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function')))return Promise.reject(new TypeError('Invalid RPC work options'));
   if(signal?.aborted)return Promise.reject(canceled());
   return new Promise((resolve,reject)=>{
    const entry={task,resolve,reject,lane:lanes[priority],caller:signal,controller:new AbortController(),started:false,done:false};
    entry.onAbort=()=>abort(entry);signal?.addEventListener('abort',entry.onAbort,{once:true});
    entry.lane.queue.push(entry);if(signal?.aborted)abort(entry);drain();
   });
  },
  enterForeground(){
   leases++;for(const entry of [...lanes.background.running])abort(entry);
   let released=false;
   return()=>{if(released)return;released=true;leases--;drain();};
  },
  active(){return leases>0;},
 };
}

export const swapRpcWork=createRpcWorkScheduler();
