import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder} from 'ethers';
import {isConstructorCall,constructorRequest,constructorResult,summarizeConstructors} from './critical-read-constructor-trace.mjs';
const coder=AbiCoder.defaultAbiCoder(),layout=['uint256','uint256[]','uint256'];
const payload={id:8,method:'eth_call',params:[{data:'0x60006000f3',gas:'0xb71b00'},'0x123']};
const encoded=(block=291n)=>coder.encode(layout,[block,[10n,20n,30n],2n]);

test('a physical no-to call is distinguished from ordinary or null-to calls',()=>{
 assert.equal(isConstructorCall(payload),true);
 assert.equal(isConstructorCall({...payload,params:[{...payload.params[0],to:'0x'+'11'.repeat(20)},'0x123']}),false);
 assert.equal(isConstructorCall({...payload,params:[{...payload.params[0],to:null},'0x123']}),false);
 assert.deepEqual(constructorRequest(payload),{rpcId:8,gas:'0xb71b00',blockTag:'0x123',hasTo:false,hasValue:false,inputBytes:5});
});
test('the canonical returned layout retains output count and reported unique calls',()=>{
 const r=constructorResult(payload,{id:8,result:encoded()},{httpStatus:200});
 assert.equal(r.rpcAccepted,true);assert.equal(r.pipelineReturnValid,true);
 assert.equal(r.returnedBlock,'291');assert.equal(r.blockMatchesPinned,true);
 assert.equal(r.outputSlots,3);assert.equal(r.reportedUniqueCalls,'2');
});
test('a returned wrong block remains visible independently of successful RPC status',()=>{
 const r=constructorResult(payload,{id:8,result:encoded(292n)},{httpStatus:200});
 assert.equal(r.rpcAccepted,true);assert.equal(r.blockMatchesPinned,false);
 assert.equal(summarizeConstructors([{constructorResults:[r]}]).blockMismatches,1);
});
test('RPC errors are retained even when a later regular route can succeed',()=>{
 const error=constructorResult(payload,{id:8,error:{code:-32000,message:'out of gas'}},{httpStatus:200});
 const valid=constructorResult(payload,{id:8,result:encoded()},{httpStatus:200});
 const stats=summarizeConstructors([{constructorResults:[error]},{category:'route',constructorResults:[]},{constructorResults:[valid]}]);
 assert.equal(error.outcome,'rpc-error');assert.deepEqual(error.error,{code:-32000,message:'out of gas'});
 assert.deepEqual(stats,{attempts:2,rpcAccepted:1,rpcFailed:1,pipelineReturns:1,malformedReturns:0,blockMismatches:0,reportedUniqueCalls:'2',outcomes:['rpc-error','pipeline-return']});
});
test('HTTP and transport failures remain failed physical attempts',()=>{
 const http=constructorResult(payload,{id:8,result:encoded()},{httpStatus:503});
 const transport=constructorResult(payload,null,{transportError:'fetch failed'});
 const stats=summarizeConstructors([{constructorResults:[http,transport]}]);
 assert.equal(http.outcome,'http-error');assert.equal(transport.outcome,'transport-error');
 assert.equal(stats.attempts,2);assert.equal(stats.rpcAccepted,0);assert.equal(stats.rpcFailed,2);
});
test('empty or known-constant RPC results are not reported as pipeline successes',()=>{
 for(const raw of ['0x','0x'+'42'.repeat(32)]){
  const r=constructorResult(payload,{id:8,result:raw},{httpStatus:200});
  assert.equal(r.rpcAccepted,true);assert.equal(r.pipelineReturnValid,false);
  assert.equal(r.outcome,'malformed-pipeline-return');assert.equal(r.reportedUniqueCalls,null);
  assert.equal(summarizeConstructors([{constructorResults:[r]}]).malformedReturns,1);
 }
});
test('noncanonical trailing data cannot become a trusted unique-call count',()=>{
 const r=constructorResult(payload,{id:8,result:encoded()+'00'.repeat(32)},{httpStatus:200});
 assert.equal(r.rpcAccepted,true);assert.equal(r.pipelineReturnValid,false);assert.equal(r.reportedUniqueCalls,null);
});
test('missing and invalid JSON responses preserve physical failures',()=>{
 assert.equal(constructorResult(payload,null,{httpStatus:200}).outcome,'missing-response');
 assert.equal(constructorResult(payload,null,{httpStatus:200,invalidJson:true}).outcome,'invalid-json');
 assert.equal(constructorResult(payload,{id:8,result:123},{httpStatus:200}).outcome,'invalid-result');
});
