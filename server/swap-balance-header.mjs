const NODE=/^[a-z0-9._:-]{1,128}$/i,QUANTITY=/^0x[0-9a-f]{1,64}$/i,HASH=/^0x[0-9a-f]{64}$/i;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const opaqueNode=nodeId=>typeof nodeId==='string'&&NODE.test(nodeId);
const invalid=()=>Object.assign(new TypeError('Invalid balance header cache options'),{code:'INVALID_INPUT'});

// Only completed primitive headers enter this cache. Each reader still performs
// its own balance read and canonical-hash check on the same selected node.
export function createBalanceHeaderCache({clock=Date.now,monotonic=()=>performance.now(),maxAgeMs=500,maxNodes=16}={}){
 if(typeof clock!=='function'||typeof monotonic!=='function'||!finite(maxAgeMs)||maxAgeMs<=0||!Number.isInteger(maxNodes)||maxNodes<1)throw invalid();
 const entries=new Map();let lastWall=null,lastMono=null;
 function sample(){
  const wall=clock(),mono=monotonic();
  if(!finite(wall)||!finite(mono)){entries.clear();lastWall=null;lastMono=null;return null;}
  const rollback=lastWall!==null&&(wall<lastWall||mono<lastMono);lastWall=wall;lastMono=mono;
  if(rollback){entries.clear();return null;}
  return{wall,mono};
 }
 function fresh(entry,now){
  return now&&now.wall>=entry.observedAt&&now.mono>=entry.monotonicAt&&now.wall-entry.observedAt<maxAgeMs&&now.mono-entry.monotonicAt<maxAgeMs;
 }
 return{
  get(nodeId){
   if(!opaqueNode(nodeId))return null;
   const now=sample(),entry=entries.get(nodeId);
   if(!entry)return null;
   if(!fresh(entry,now)){entries.delete(nodeId);return null;}
   return{number:entry.number,hash:entry.hash,timestamp:entry.timestamp};
  },
  remember(nodeId,block,observation){
   if(!opaqueNode(nodeId)||!block||typeof block!=='object'||Array.isArray(block)||typeof block.then==='function'||!observation)return false;
   const {number,hash,timestamp}=block,{observedAt,monotonicAt}=observation;
   if(typeof number!=='string'||!QUANTITY.test(number)||typeof hash!=='string'||!HASH.test(hash)||typeof timestamp!=='string'||!QUANTITY.test(timestamp)||!finite(observedAt)||!finite(monotonicAt))return false;
   const now=sample();
   // Observation belongs to the start of the fresh header RPC, not completion
   // or a cache hit. Slow reads cannot receive a new reuse window here.
   const entry={number,hash,timestamp,observedAt,monotonicAt};
   if(!fresh(entry,now))return false;
   const previous=entries.get(nodeId);
   if(previous&&(entry.observedAt<previous.observedAt||entry.monotonicAt<previous.monotonicAt))return false;
   entries.delete(nodeId);entries.set(nodeId,entry);
   while(entries.size>maxNodes)entries.delete(entries.keys().next().value);
   return true;
  },
  invalidate(nodeId,hash){
   if(!opaqueNode(nodeId))return false;
   const entry=entries.get(nodeId);
   if(!entry||hash!==undefined&&(typeof hash!=='string'||entry.hash.toLowerCase()!==hash.toLowerCase()))return false;
   return entries.delete(nodeId);
  },
 };
}
