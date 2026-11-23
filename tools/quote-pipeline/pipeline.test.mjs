import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createEVM} from '@ethereumjs/evm';
import {createCustomCommon,Mainnet,Hardfork} from '@ethereumjs/common';
import {Account,createAddressFromString,hexToBytes,bytesToHex} from '@ethereumjs/util';
import solc from 'solc';
import {ethers} from 'ethers';

const artifact=await import('../../server/swap-quote-pipeline-bytecode.mjs').catch(error=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return{};
});
const MC='0xca11bde05977b3631167028862be2a173976ca11',ROUTER='0x6f421584a067b511ceb441c2d5b8534b0c9cdde7';
const ADAPTERS=['', '0xdfabf87ee3a9a4cedda43d3f8035c89e1c9438b7','0x9de342bdffb5da04d9865f4cd9846d22560d253a','0xe381c967c14b0c6ef82944e0e4b4272d24dd8957'];
const U='0x55d398326f99059ff775485246999027b3197955',W='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const TOKENS=[U,W,C,'0x0efb5fd2402a0967b92551d6af54de148504a115','0x2170ed0880ac9a755fd29b2688956bd959f933f8','0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c'];
const LITERAL=65535,BLOCK=123n,MAX=(1n<<256n)-1n;
const ARG_TYPES=['uint256','tuple(uint8 adapter,address tokenIn,address tokenOut,uint24 fee)[]','tuple(uint8 edge,uint16 prior,uint256 input)[]','uint16[4]'];
const coder=ethers.AbiCoder.defaultAbiCoder();
const multicall=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) returns((bool success,bytes returnData)[])']);
const router=new ethers.Interface(['function getAmountsOutVia(address,uint256,address[]) view returns(uint256[])']);
const v3=new ethers.Interface(['function quoteExactIn(bytes,uint256) returns(uint256)']);

// Local EVM code is injected at the canonical addresses. No transaction,
// deployment RPC, external node, wallet or private key is involved.
const fixtureSource=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
contract FixtureMulticall {
 struct Call {address target; bytes callData;}
 struct Result {bool success; bytes returnData;}
 function tryAggregate(bool requireSuccess,Call[] calldata calls) external returns(Result[] memory results) {
  require(!requireSuccess);results=new Result[](calls.length);
  for(uint i=0;i<calls.length;i++) {(results[i].success,results[i].returnData)=calls[i].target.call(calls[i].callData);}
 }
}
contract ShortMulticall {
 struct Call {address target; bytes callData;}
 struct Result {bool success; bytes returnData;}
 function tryAggregate(bool,Call[] calldata calls) external pure returns(Result[] memory results) {return new Result[](calls.length+1);}
}
contract FixtureQuotes {
 address constant MULTICALL=${ethers.getAddress(MC)};
 function bad(uint amount) internal pure {
  if(amount==666)revert();
  if(amount==999)assembly {mstore(0,1) return(0,3)}
 }
 function getAmountsOutVia(address adapter,uint amount,address[] calldata path) external view returns(uint[] memory amounts) {
  require(msg.sender==MULTICALL && path.length==2);bad(amount);
  amounts=new uint[](amount==555?3:2);amounts[0]=amount==888?amount+1:amount;
  amounts[1]=amount==777?0:(amount/10000)*9900+(amount%10000)*9900/10000+(adapter==${ethers.getAddress(ADAPTERS[1])}?3:5);
 }
 function quoteExactIn(bytes calldata path,uint amount) external view returns(uint out) {
  require(msg.sender==MULTICALL && path.length==43);bad(amount);if(amount==777)return 0;
  uint fee=uint24(bytes3(path[20:23]));uint rate=1000000-fee;
  return amount/1000000*rate+amount%1000000*rate/1000000+7;
 }
}`;
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Fixtures.sol':{content:fixtureSource}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}})));
assert.equal((compiled.errors||[]).filter(error=>error.severity==='error').length,0,JSON.stringify(compiled.errors));
const fixtureCode=name=>'0x'+compiled.contracts['Fixtures.sol'][name].evm.deployedBytecode.object;
const edge=(adapter,tokenIn=U,tokenOut=W,fee=0)=>({adapter,tokenIn,tokenOut,fee});
const literal=(which,amount)=>({edge:which,prior:LITERAL,input:BigInt(amount)});
const reference=(which,prior)=>({edge:which,prior,input:0n});
const baseProgram=()=>({edges:[edge(1),edge(2),edge(3,W,C,500),edge(2,C,U),edge(1)],steps:[literal(0,10000),literal(1,10000),literal(0,2500),literal(1,7501),literal(4,10000),reference(2,0),reference(2,1),reference(2,0),reference(3,5),reference(3,6),reference(3,7)],bounds:[0,5,8,11]});

async function fixture({short=false,chainId=56}={}){
 const common=createCustomCommon({chainId},Mainnet,{hardfork:Hardfork.Shanghai}),evm=await createEVM({common});
 const caller=createAddressFromString('0x'+'12'.repeat(20));await evm.stateManager.putAccount(caller,new Account(0n,10n**30n));
 await evm.stateManager.putCode(createAddressFromString(MC),hexToBytes(fixtureCode(short?'ShortMulticall':'FixtureMulticall')));
 for(const address of [ROUTER,ADAPTERS[3]])await evm.stateManager.putCode(createAddressFromString(address),hexToBytes(fixtureCode('FixtureQuotes')));
 const block={header:{number:BLOCK,coinbase:caller,timestamp:1800000000n,difficulty:0n,prevRandao:new Uint8Array(32),gasLimit:30000000n,baseFeePerGas:0n,getBlobGasPrice:()=>undefined}};
 const trace=[];evm.events.on('beforeMessage',message=>{
  if([ROUTER,ADAPTERS[3],MC].includes(message.to?.toString()))trace.push({to:message.to.toString(),caller:message.caller.toString(),data:bytesToHex(message.data)});
 });
 async function call(to,data,gasLimit=12000000n){
  await evm.stateManager.checkpoint();
  try{return await evm.runCall({caller,...(to?{to:createAddressFromString(to)}:{}),data:hexToBytes(data),gasLimit,block});}
  finally{await evm.stateManager.revert();}
 }
 return{trace,call};
}
function creation(program,{expectedBlock=BLOCK,suffix=''}={}){
 assert.ok(artifact.SWAP_QUOTE_PIPELINE_BYTECODE,'compiled deployless helper artifact is required');
 return artifact.SWAP_QUOTE_PIPELINE_BYTECODE+coder.encode(ARG_TYPES,[expectedBlock,program.edges,program.steps,program.bounds]).slice(2)+suffix;
}
async function evaluate(program,options={}){
 const f=await fixture(options),result=await f.call(null,creation(program,options),options.gasLimit);
 return{...f,result,decoded:result.execResult.exceptionError?null:coder.decode(['uint256','uint256[]','uint256'],bytesToHex(result.execResult.returnValue))};
}
function childCall(spec,amount){
 return spec.adapter===3?[ADAPTERS[3],v3.encodeFunctionData('quoteExactIn',[ethers.solidityPacked(['address','uint24','address'],[spec.tokenIn,spec.fee,spec.tokenOut]),amount])]:[ROUTER,router.encodeFunctionData('getAmountsOutVia',[ADAPTERS[spec.adapter],amount,[spec.tokenIn,spec.tokenOut]])];
}
// Independent reference: the same canonical Multicall is executed as three
// separate local eth_calls, with exact ABI decoding between dependent rounds.
async function layered(program){
 const f=await fixture(),outputs=[],cache=new Map();let calls=0;
 for(let depth=0;depth<3;depth++){
  const pending=new Map(),keys=[];
  for(let n=program.bounds[depth];n<program.bounds[depth+1];n++){
   const step=program.steps[n],spec=program.edges[step.edge],amount=step.prior===LITERAL?step.input:outputs[step.prior],key=[spec.adapter,spec.tokenIn,spec.tokenOut,spec.fee,amount].join(':');
   keys.push([n,key]);if(!cache.has(key)&&!pending.has(key))pending.set(key,{spec,amount});
  }
  if(pending.size){
   const entries=[...pending],result=await f.call(MC,multicall.encodeFunctionData('tryAggregate',[false,entries.map(([,item])=>childCall(item.spec,item.amount))]));
   assert.equal(result.execResult.exceptionError,undefined);const rows=multicall.decodeFunctionResult('tryAggregate',bytesToHex(result.execResult.returnValue))[0];
   entries.forEach(([key,{spec,amount}],n)=>{
    assert.equal(rows[n].success,true);let out;
    if(spec.adapter===3)out=v3.decodeFunctionResult('quoteExactIn',rows[n].returnData)[0];
    else{const values=router.decodeFunctionResult('getAmountsOutVia',rows[n].returnData)[0];assert.equal(values.length,2);assert.equal(values[0],amount);out=values[1];}
    cache.set(key,out);
   });calls++;
  }
  keys.forEach(([n,key])=>outputs[n]=cache.get(key));
 }
 return{outputs,uniqueCalls:BigInt(cache.size),rounds:calls,trace:f.trace};
}

test('constructor collapses three dependent quote rounds while preserving exact outputs, global aliases and Multicall child senders',async()=>{
 const program=baseProgram(),baseline=await layered(program),helper=await evaluate(program);
 assert.equal(helper.result.execResult.exceptionError,undefined);assert.equal(helper.decoded[0],BLOCK);
 assert.deepEqual([...helper.decoded[1]],[9903n,9905n,2478n,7430n,9903n,9905n,9907n,9905n,9810n,9812n,9810n]);
 assert.deepEqual([...helper.decoded[1]],baseline.outputs);assert.equal(helper.decoded[2],8n);assert.equal(helper.decoded[2],baseline.uniqueCalls);assert.equal(baseline.rounds,3);
 const children=trace=>trace.filter(item=>item.to!==MC);
 assert.deepEqual(children(helper.trace),children(baseline.trace));assert.ok(children(helper.trace).every(item=>item.caller===MC));
 assert.deepEqual(helper.trace.filter(item=>item.to===MC).map(item=>multicall.decodeFunctionData('tryAggregate',item.data)[1].length),[4,2,2]);
});

for(const amount of [1n,3n,10001n,(1n<<80n)+1n,(1n<<200n)+123n,MAX])test(`exact uint256 input and dependent outputs match separate calls at ${amount}`,async()=>{
 const program={edges:[edge(1),edge(3,W,C,100)],steps:[literal(0,amount),reference(1,0)],bounds:[0,1,2,2]};
 const baseline=await layered(program),helper=await evaluate(program);assert.equal(helper.result.execResult.exceptionError,undefined);
 assert.deepEqual([...helper.decoded[1]],baseline.outputs);assert.equal(helper.decoded[2],2n);
});

for(const failure of [555n,666n,777n,888n,999n])test(`a necessary V2 quote with invalid result ${failure} rejects the whole helper`,async()=>{
 const helper=await evaluate({edges:[edge(1)],steps:[literal(0,failure)],bounds:[0,1,1,1]});assert.ok(helper.result.execResult.exceptionError);assert.equal(helper.decoded,null);
});
for(const failure of [666n,777n,999n])test(`a necessary V3 quote with invalid result ${failure} rejects the whole helper`,async()=>{
 const helper=await evaluate({edges:[edge(3,U,W,500)],steps:[literal(0,failure)],bounds:[0,1,1,1]});assert.ok(helper.result.execResult.exceptionError);
});

const invalidPrograms={
 'empty steps':()=>({edges:[edge(1)],steps:[],bounds:[0,0,0,0]}),
 'too many steps':()=>({edges:[edge(1)],steps:Array.from({length:257},()=>literal(0,100)),bounds:[0,257,257,257]}),
 'too many edges':()=>({edges:Array.from({length:81},()=>edge(1)),steps:[literal(0,100)],bounds:[0,1,1,1]}),
 'too many unique quotes in one depth':()=>({edges:[edge(1)],steps:Array.from({length:81},(_,n)=>literal(0,n+1)),bounds:[0,81,81,81]}),
 'zero literal':()=>({edges:[edge(1)],steps:[literal(0,0)],bounds:[0,1,1,1]}),
 'missing edge':()=>({edges:[edge(1)],steps:[literal(1,100)],bounds:[0,1,1,1]}),
 'same-depth reference':()=>({edges:[edge(1)],steps:[literal(0,100),reference(0,0)],bounds:[0,2,2,2]}),
 'skipped-depth reference':()=>({edges:[edge(1)],steps:[literal(0,100),reference(0,0)],bounds:[0,1,1,2]}),
 'reference with literal data':()=>({edges:[edge(1)],steps:[literal(0,100),{edge:0,prior:0,input:1n}],bounds:[0,1,2,2]}),
 'decreasing bounds':()=>({edges:[edge(1)],steps:[literal(0,100)],bounds:[0,1,0,1]}),
 'missing bound tail':()=>({edges:[edge(1)],steps:[literal(0,100)],bounds:[0,0,0,0]}),
 'invalid adapter':()=>({edges:[edge(4)],steps:[literal(0,100)],bounds:[0,1,1,1]}),
 'invalid V3 fee':()=>({edges:[edge(3,U,W,250)],steps:[literal(0,100)],bounds:[0,1,1,1]}),
 'nonzero V2 fee':()=>({edges:[edge(1,U,W,500)],steps:[literal(0,100)],bounds:[0,1,1,1]}),
 'non-mainstream token':()=>({edges:[edge(1,U,'0xc9882def23bc42d53895b8361d0b1edc7570bc6a')],steps:[literal(0,100)],bounds:[0,1,1,1]}),
 'native edge token':()=>({edges:[edge(1,U,ethers.ZeroAddress)],steps:[literal(0,100)],bounds:[0,1,1,1]}),
 'identical edge tokens':()=>({edges:[edge(1,U,U)],steps:[literal(0,100)],bounds:[0,1,1,1]}),
};
for(const[name,program]of Object.entries(invalidPrograms))test(`bounded helper rejects ${name}`,async()=>assert.ok((await evaluate(program())).result.execResult.exceptionError));

test('the maximum 256 aliased steps stay index-complete with one unique call',async()=>{
 const program={edges:[edge(1)],steps:Array.from({length:256},()=>literal(0,100)),bounds:[0,256,256,256]},helper=await evaluate(program);
 assert.equal(helper.result.execResult.exceptionError,undefined);assert.equal(helper.decoded[1].length,256);assert.ok(helper.decoded[1].every(value=>value===102n));assert.equal(helper.decoded[2],1n);
});
test('80 valid edges and 80 unique quotes in one depth stay within the helper bounds',async()=>{
 const edges=[];for(const a of TOKENS)for(const b of TOKENS)if(a!==b)for(const adapter of [1,2,3])edges.push(edge(adapter,a,b,adapter===3?100:0));
 const program={edges:edges.slice(0,80),steps:Array.from({length:80},(_,n)=>literal(n,100+n)),bounds:[0,80,80,80]},helper=await evaluate(program);
 assert.equal(helper.result.execResult.exceptionError,undefined);assert.equal(helper.decoded[1].length,80);assert.equal(helper.decoded[2],80n);
});
test('global quote cache reuses an identical edge and amount from an earlier depth',async()=>{
 const program={edges:[edge(1)],steps:[literal(0,100),literal(0,100),literal(0,100)],bounds:[0,1,2,3]},helper=await evaluate(program);
 assert.equal(helper.result.execResult.exceptionError,undefined);assert.deepEqual([...helper.decoded[1]],[102n,102n,102n]);assert.equal(helper.decoded[2],1n);
 assert.equal(helper.trace.filter(item=>item.to===MC).length,1);
});
test('three full 80-quote depths preserve all 240 outputs within the initcode and gas limits',async t=>{
 const edges=[];for(const a of TOKENS)for(const b of TOKENS)if(a!==b)for(const adapter of [1,2,3])edges.push(edge(adapter,a,b,adapter===3?100:0));
 const steps=Array.from({length:80},(_,n)=>literal(n,10000+n));
 for(let depth=1;depth<3;depth++)for(let n=0;n<80;n++)steps.push(reference(n,(depth-1)*80+n));
 const program={edges:edges.slice(0,80),steps,bounds:[0,80,160,240]},baseline=await layered(program),helper=await evaluate(program);
 assert.equal(helper.result.execResult.exceptionError,undefined);assert.equal(helper.decoded[2],240n);assert.deepEqual([...helper.decoded[1]],baseline.outputs);
 const initcodeBytes=(creation(program).length-2)/2;assert.ok(initcodeBytes<=49152);assert.ok(helper.result.execResult.executionGasUsed<=12000000n);
 t.diagnostic(`Synthetic local EVM maximum graph: ${initcodeBytes} initcode bytes, ${helper.result.execResult.executionGasUsed} execution gas, 240 unique quotes.`);
});
test('wrong block, wrong chain, malformed aggregate and oversized initcode reject without partial results',async()=>{
 for(const options of [{expectedBlock:124n},{chainId:1},{short:true},{suffix:'00'.repeat(49152)}])assert.ok((await evaluate(baseProgram(),options)).result.execResult.exceptionError);
});
test('the committed creation artifact exactly reproduces from the pinned local compiler',()=>{
 assert.ok(artifact.SWAP_QUOTE_PIPELINE_BYTECODE,'compiled deployless helper artifact is required');
 execFileSync(process.execPath,[new URL('./build.mjs',import.meta.url).pathname,'--check'],{stdio:'pipe'});
});
