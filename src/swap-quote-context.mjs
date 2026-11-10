import {readSwapConfig} from './swap-aggregator.mjs?v=mainnet-20261111-23';
import {readPoolPolicy} from './swap-liquidity.mjs?v=mainnet-20261111-23';

// Read-only quote work can be shared while typing. Submission always calls the
// uncached config/pool readers again; this cache never changes snapshot expiry.
export function createQuoteContext(request,{readConfig=readSwapConfig,readPolicy=readPoolPolicy,clock=Date.now,ttlMs=4000}={}) {
 let configEntry;
 const snapshots=new Map();
 async function config() {
  if(configEntry&&(configEntry.pending||clock()-configEntry.started<ttlMs))return configEntry.promise;
  const entry={started:clock(),pending:true};configEntry=entry;
  entry.promise=Promise.resolve().then(()=>readConfig(request)).finally(()=>{entry.pending=false;});
  try{return await entry.promise;}catch(e){if(configEntry===entry)configEntry=null;throw e;}
 }
 async function get(tokenIn,tokenOut) {
  const current=await config();
  if(current.version==='2.0.0')return{config:current,poolPolicy:null};
  const key=JSON.stringify([String(tokenIn).toLowerCase(),String(tokenOut).toLowerCase(),current],(_,v)=>typeof v==='bigint'?v.toString():v);
  let entry=snapshots.get(key);
  if(entry?.value){
   try{entry.value.assertFresh();if(clock()-entry.completedAt>=ttlMs)entry=null;}catch{entry=null;}
  }
  if(!entry){
   entry={};snapshots.set(key,entry);
   // Bounded per-view cache; in-flight readers keep their own promise reference.
   if(snapshots.size>4)snapshots.delete(snapshots.keys().next().value);
   entry.promise=Promise.resolve().then(()=>readPolicy(request,{tokenIn,tokenOut,config:current,v3Mode:current.version==='1.11'?'legacy':'all'})).then(value=>{
    value.assertFresh();entry.value=value;entry.completedAt=clock();return value;
   });
  }
  try{return{config:current,poolPolicy:await entry.promise};}
  catch(e){if(snapshots.get(key)===entry)snapshots.delete(key);throw e;}
 }
 return{config,get};
}
