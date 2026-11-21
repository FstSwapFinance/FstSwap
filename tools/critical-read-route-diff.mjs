// Differential observations only. This module never chooses or executes a route.
import {AbiCoder} from 'ethers';
const abi=AbiCoder.defaultAbiCoder();
const inputs=['uint256','tuple(uint8,address,address,uint24)[]','tuple(uint8,uint16,uint256)[]','uint16[4]'];
const outputs=['uint256','uint256[]','uint256'];
const key=(target,data)=>target.toLowerCase()+':'+data.toLowerCase();
export function multicallRouteResults(codec,payload,response){
 if(payload.method!=='eth_call'||!response?.result)return [];
 let calls,results;
 try{calls=codec.decodeFunctionData('tryAggregate',payload.params[0].data)[1];results=codec.decodeFunctionResult('tryAggregate',response.result)[0];}catch{return [];}
 if(calls.length!==results.length)return [];
 return Array.from(calls,(call,index)=>{
  let tx;try{tx=codec.parseTransaction({data:call.callData});}catch{return null;}
  if(!['getAmountsOutVia','quoteExactIn'].includes(tx?.name))return null;
  const row=results[index];let out=null;
  if(row.success)try{const decoded=codec.decodeFunctionResult(tx.name,row.returnData);out=(tx.name==='getAmountsOutVia'?decoded[0].at(-1):decoded[0]).toString();}catch{}
  return {key:key(call.target,call.callData),target:call.target.toLowerCase(),callData:call.callData.toLowerCase(),method:tx.name,out,success:row.success&&out!=null,source:'multicall'};
 }).filter(Boolean);
}
export function constructorRouteResults(codec,payload,response,creationBytecode,aggregator){
 const data=payload?.params?.[0]?.data;
 if(!creationBytecode||typeof data!=='string'||!data.toLowerCase().startsWith(creationBytecode.toLowerCase()))return {available:false,reason:'creation-prefix-unavailable-or-mismatch',calls:[]};
 if(response?.error||typeof response?.result!=='string')return {available:false,reason:'constructor-rpc-failed',calls:[]};
 try{
  const [block,edges,steps,bounds]=abi.decode(inputs,'0x'+data.slice(creationBytecode.length));
  const [returned,values,unique]=abi.decode(outputs,response.result);
  if(block!==returned||steps.length!==values.length||Number(bounds[0])!==0||Number(bounds[3])!==steps.length||unique<=0n||unique>BigInt(steps.length)||values.some(v=>v<=0n))throw Error('Constructor plan/result shape mismatch');
  const calls=Array.from(steps,(step,index)=>{
   const edge=edges[Number(step[0])];if(!edge)throw Error('Unknown plan edge');
   const prior=Number(step[1]);if(prior!==65535&&prior>=index)throw Error('Nonpreceding dependency');
   const amount=prior===65535?step[2]:values[prior],adapter=Number(edge[0]);
   const tokenIn=edge[1].toLowerCase(),tokenOut=edge[2].toLowerCase();let target,callData,method;
   if(adapter===3){
    method='quoteExactIn';target=aggregator.SWAP_ADAPTERS.v3.adapter;
    const path=tokenIn+Number(edge[3]).toString(16).padStart(6,'0')+tokenOut.slice(2);
    callData=codec.encodeFunctionData(method,[path,amount]);
   }else{
    const dex=aggregator.SWAP_ADAPTERS[adapter===1?'fst':adapter===2?'pancake':''];if(!dex)throw Error('Unknown plan adapter');
    method='getAmountsOutVia';target=aggregator.swapActiveRouter();
    callData=codec.encodeFunctionData(method,[dex.adapter,amount,[tokenIn,tokenOut]]);
   }
   return {key:key(target,callData),target:target.toLowerCase(),callData:callData.toLowerCase(),method,out:values[index].toString(),success:values[index]>0n,source:'constructor',step:index};
  });
  return {available:true,block:block.toString(),reportedUniqueCalls:unique.toString(),steps:steps.length,calls};
 }catch(error){return {available:false,reason:'plan-decode-failed',error:error.message,calls:[]};}
}
export function compareRouteResults(before,after){
 const normalize=rows=>{
  const map=new Map(),conflicts=[];
  for(const row of rows){const prior=map.get(row.key);if(prior&&(prior.out!==row.out||prior.success!==row.success))conflicts.push({key:row.key,prior,current:row});map.set(row.key,row);}
  return {map,conflicts};
 };
 const a=normalize(before),b=normalize(after),missing=[],extra=[],different=[];
 for(const [k,row]of a.map){const other=b.map.get(k);if(!other)missing.push(k);else if(row.out!==other.out||row.success!==other.success)different.push({key:k,before:{out:row.out,success:row.success},after:{out:other.out,success:other.success}});}
 for(const k of b.map.keys())if(!a.map.has(k))extra.push(k);
 return {available:before.length>0&&after.length>0,beforeUnique:a.map.size,afterUnique:b.map.size,same:before.length>0&&after.length>0&&!missing.length&&!extra.length&&!different.length&&!a.conflicts.length&&!b.conflicts.length,missing,extra,different,conflicts:[...a.conflicts,...b.conflicts]};
}
