// Benchmark-only diagnostics for read-only creation eth_call. Runtime never imports this.
import {AbiCoder} from 'ethers';
const coder=AbiCoder.defaultAbiCoder(),layout=['uint256','uint256[]','uint256'];
export function isConstructorCall(payload){
 return payload?.method==='eth_call'&&payload.params?.[0]&&typeof payload.params[0]==='object'&&!Object.hasOwn(payload.params[0],'to');
}
export function constructorRequest(payload){
 if(!isConstructorCall(payload))return null;
 const tx=payload.params[0],data=tx.data;
 return {rpcId:payload.id,gas:tx.gas??null,blockTag:payload.params[1]??null,hasTo:Object.hasOwn(tx,'to'),hasValue:Object.hasOwn(tx,'value'),inputBytes:typeof data==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(data)?(data.length-2)/2:null};
}
export function constructorResult(payload,row,{httpStatus,transportError,invalidJson}={}){
 const request=constructorRequest(payload);if(!request)return null;
 const base={...request,rpcAccepted:false,pipelineReturnValid:false,reportedUniqueCalls:null,outputSlots:null,returnedBlock:null,blockMatchesPinned:null,resultBytes:null};
 if(transportError)return {...base,outcome:'transport-error',error:transportError};
 if(httpStatus!=null&&(httpStatus<200||httpStatus>=300))return {...base,outcome:'http-error',httpStatus,error:row?.error??null};
 if(invalidJson)return {...base,outcome:'invalid-json'};
 if(!row)return {...base,outcome:'missing-response'};
 if(row.error)return {...base,outcome:'rpc-error',error:{code:row.error.code,message:row.error.message}};
 if(typeof row.result!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(row.result))return {...base,outcome:'invalid-result'};
 base.rpcAccepted=true;base.resultBytes=(row.result.length-2)/2;
 try{
  const [block,outputs,unique]=coder.decode(layout,row.result);
  if(coder.encode(layout,[block,outputs,unique]).toLowerCase()!==row.result.toLowerCase())throw Error('Noncanonical constructor result');
  let expected=null;try{if(/^0x[0-9a-f]+$/i.test(request.blockTag||''))expected=BigInt(request.blockTag);}catch{}
  return {...base,outcome:'pipeline-return',pipelineReturnValid:true,reportedUniqueCalls:unique.toString(),outputSlots:outputs.length,returnedBlock:block.toString(),blockMatchesPinned:expected==null?null:block===expected};
 }catch(error){return {...base,outcome:'malformed-pipeline-return',error:{message:error.message}};}
}
export function summarizeConstructors(events){
 const results=events.flatMap(e=>e.constructorResults||[]);
 const accepted=results.filter(r=>r.rpcAccepted),valid=results.filter(r=>r.pipelineReturnValid);
 return {attempts:results.length,rpcAccepted:accepted.length,rpcFailed:results.length-accepted.length,pipelineReturns:valid.length,malformedReturns:accepted.filter(r=>!r.pipelineReturnValid).length,blockMismatches:valid.filter(r=>r.blockMatchesPinned===false).length,reportedUniqueCalls:valid.reduce((n,r)=>n+BigInt(r.reportedUniqueCalls),0n).toString(),outcomes:results.map(r=>r.outcome)};
}
