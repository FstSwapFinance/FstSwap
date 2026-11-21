import {AsyncLocalStorage} from 'node:async_hooks';

// Low-cardinality, request-local diagnostics. Durations can overlap; their sum
// is not total latency. No URLs, addresses, errors or caller names enter headers.
const activeTiming=new AsyncLocalStorage();
const phases=new Set(['bootstrap','context','config','policy','route','canonical','balance_header','balance_read','rpc','encode','oracle','v2','v3_discovery','v3_state','v3_depth','tax']);
const counters=new Set(['rpc_calls','rpc_http','rpc_batches','rpc_bytes','context_hits','snapshot_hits','balance_head_hits','quote_batches','quote_subcalls','quote_candidates']);
const finite=value=>Number.isFinite(value)&&value>=0;
const now=scope=>{try{const value=scope.clock();return finite(value)?value:null;}catch{return null;}};
function record(scope,name,start){
 if(scope.closed||start==null)return;
 const end=now(scope);if(end==null||end<start)return;
 scope.durations[name]=Math.min(1e9,(scope.durations[name]||0)+end-start);
}
export function measurePhase(name,work){
 const scope=activeTiming.getStore();if(!scope||scope.closed||!phases.has(name))return work();
 const start=now(scope);
 try{
  const result=work();
  if(result&&typeof result.then==='function')return Promise.resolve(result).then(value=>{record(scope,name,start);return value;},error=>{record(scope,name,start);throw error;});
  record(scope,name,start);return result;
 }catch(error){record(scope,name,start);throw error;}
}
export function countTiming(name,value=1){
 const scope=activeTiming.getStore();
 if(!scope||scope.closed||!counters.has(name)||!Number.isSafeInteger(value)||value<0)return;
 scope.counts[name]=Math.min(1e9,(scope.counts[name]||0)+value);
}
export function createTimingScope({clock=()=>performance.now()}={}){
 const scope={clock,closed:false,durations:Object.create(null),counts:Object.create(null)};let header;
 return{
  run:work=>activeTiming.run(scope,work),
  snapshot:()=>({durations:{...scope.durations},counts:{...scope.counts}}),
  header(total){
   if(header!==undefined)return header;
   scope.closed=true;
   const fields=['total;dur='+(finite(total)?Math.min(1e9,total):0).toFixed(1)];
   for(const [name,value]of Object.entries(scope.durations))fields.push(name+';dur='+value.toFixed(1));
   for(const [name,value]of Object.entries(scope.counts))fields.push(name+';desc="'+value+'"');
   header=fields.join(', ');return header;
  },
 };
}
