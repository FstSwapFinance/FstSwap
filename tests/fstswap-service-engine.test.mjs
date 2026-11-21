import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {readFile} from 'node:fs/promises';
globalThis.ethers=ethers;
const runtimeSource=await readFile(new URL('../server/fstswap-service.mjs',import.meta.url),'utf8');
const runtimeQuery=runtimeSource.match(/swap-fstswap\.mjs([^']*)'/)[1];
const {SWAP_ABI,SWAP_ADAPTERS,SWAP_TOKENS,swapActiveRouter}=await import('../src/swap-aggregator.mjs'+runtimeQuery);
const fst=await import('../src/swap-fstswap.mjs'+runtimeQuery);
const {validateServiceQuote,createServiceClient}=await import('../src/swap-service-client.mjs'+runtimeQuery);
const {createEngine,encode}=await import('../server/fstswap-service.mjs');
// Known ordinary assets outside the six platform-fee assets keep output and
// intermediate fee modes covered without claiming arbitrary ALT is tax-free.
const zero=ethers.ZeroAddress,usd=SWAP_TOKENS.usdt.address.toLowerCase(),usdc=fst.FST_FEE_ASSETS.USDC,alt='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',alt2='0x0efb5fd2402a0967b92551d6af54de148504a115',scale=10n**18n;
const config=()=>({version:'2.0.0',platformFeeBps:30,feeReceiver:'0x'+'66'.repeat(20),defaultFeeToken:usd,feeConfigVersion:5n,adaptersOff:[],wbnb:fst.FST_FEE_ASSETS.WBNB});
const abi=new ethers.Interface([...SWAP_ABI,
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)',
 'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)']);
function fixture({onlyWrap=false,reorgOnQuote=false}={}){
 let now=1800000000000;const calls=[],block={number:'0x100',hash:'0x'+'01'.repeat(32),timestamp:ethers.toQuantity(now/1000)},pairs=[[usd,usdc],[alt,usd],[alt2,usd]];
 const request=async p=>{
  calls.push(p);
  if(p.method==='eth_getBlockByNumber')return{...block};
  if(p.method==='eth_chainId')return'0x38';
  if(onlyWrap)throw Error('A native wrap must not read pools');
  const batch=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return abi.encodeFunctionResult('tryAggregate',[batch.map(c=>{
   const parsed=abi.parseTransaction({data:c.callData}),result=v=>[true,abi.encodeFunctionResult(parsed.name,v)];
   switch(parsed.name){
    case'factory':return result(['0x'+'99'.repeat(20)]);
    case'getPool':return result([zero]);
    case'latestRoundData':return result([1n,100000000n,0n,BigInt(now/1000),1n]);
    case'decimals':return result([8]);
    case'getPairInfo':{
     const a=parsed.args[1].toLowerCase(),b=parsed.args[2].toLowerCase(),index=pairs.findIndex(pair=>pair.slice().sort().join() === [a,b].sort().join());
     const exists=index>=0&&parsed.args[0].toLowerCase()===SWAP_ADAPTERS.pancake.adapter.toLowerCase();
     return result([exists?'0x'+String(index+1).repeat(40):zero,a,b,exists?1000000n*scale:0n,exists?1000000n*scale:0n,1n,0n]);
    }
    case'getAmountsOutVia':if(reorgOnQuote)block.hash='0x'+'02'.repeat(32);return result([[parsed.args[1],parsed.args[1]*999n/1000n]]);
    default:throw Error('Unexpected '+parsed.name);
   }
  })]);
 };
 return{request,block,calls,clock:()=>now,advance:n=>now+=n};
}
const input=(tokenIn=usd,tokenOut=usdc)=>({chainId:56,tokenIn,tokenOut,amountIn:scale.toString(),slippageBps:50,singleHop:false});
test('the 2.0 engine returns a bounded staged wire quote while keeping canonical and original expiry checks',async()=>{
 const f=fixture(),c=config(),engine=createEngine({run:(fn,signal)=>fn(f.request,{id:'one'},signal)},{clock:f.clock,readConfig:async()=>c});
 const result=await engine.quote(input());
 assert.equal(result.config.version,'2.0.0');assert.equal(result.quote.kind,'fstswap');assert.equal(result.quote.feeMode,'input');
 assert.equal(result.quote.amountIn,scale);assert.equal(result.quote.lpFee,scale*30n/10000n);assert.equal(result.quote.minimum,result.quote.out*9950n/10000n);
 assert.equal(result.quote.poolCheckedAt+15000,result.expiresAt);
 assert.equal(validateServiceQuote(result,result.input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:f.clock}),result);
 const client=createServiceClient({base:'https://service.invalid',clock:f.clock,fetchImpl:async()=>new Response(encode(result))});
 assert.ok(await client.quote({...input(),amountIn:scale},{router:swapActiveRouter(),adapters:SWAP_ADAPTERS}),'the staged DTO survives real JSON bigint encoding and client validation');
 assert.equal(result.quote.first,undefined);assert.equal(result.quote.segments[0].candidates,undefined);assert.equal(result.quote.segments[0].legs[0].pool,undefined);
 assert.ok(f.calls.some(p=>p.method==='eth_call'&&abi.decodeFunctionData('tryAggregate',p.params[0].data)[1].some(c=>abi.parseTransaction({data:c.callData}).name==='getPool')),'2.0 checks mainstream V3 competitors');
 assert.ok(f.calls.filter(p=>p.method==='eth_getBlockByNumber').some(p=>p.params[0]==='0x100'));
});
test('2.0 output fees remain net of the one fee in the actual wire result',async()=>{
 const f=fixture(),engine=createEngine({run:(fn,signal)=>fn(f.request,{id:'one'},signal)},{clock:f.clock,readConfig:async()=>config()});
 const result=await engine.quote(input(alt,usd)),q=result.quote;
 assert.equal(q.feeMode,'output');assert.equal(q.lpFee,q.segments[0].out*30n/10000n);assert.equal(q.out,q.segments[0].out-q.lpFee);
 assert.equal(validateServiceQuote(result,result.input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:f.clock}),result);
});
test('changing the amount reuses one trusted 2.0 context without rescanning pools or extending expiry',async()=>{
 const f=fixture();let configs=0;
 const engine=createEngine({run:(fn,signal)=>fn(f.request,{id:'one'},signal)},{clock:f.clock,readConfig:async()=>{configs++;return config();}});
 const first=await engine.quote(input()),count=f.calls.length;
 const second=await engine.quote({...input(),amountIn:(scale+1n).toString()});
 assert.equal(configs,1);assert.equal(first.expiresAt,second.expiresAt);assert.equal(second.quote.amountIn,scale+1n);
 const laterMethods=f.calls.slice(count).filter(p=>p.method==='eth_call').flatMap(p=>abi.decodeFunctionData('tryAggregate',p.params[0].data)[1].map(c=>abi.parseTransaction({data:c.callData}).name));
 assert.deepEqual(laterMethods,['getAmountsOutVia']);
});
test('the final engine canonical check rejects a 2.0 quote whose snapshot reorganizes during calculation',async()=>{
 const f=fixture({reorgOnQuote:true}),engine=createEngine({run:(fn,signal)=>fn(f.request,{id:'one'},signal)},{clock:f.clock,readConfig:async()=>config()});
 await assert.rejects(engine.quote(input()),{code:'STALE_BLOCK'});
});
test('prepared pool snapshots cannot be copied, moved across providers or blocks, or used with changed config',async()=>{
 const f=fixture(),c=config(),policy=await fst.readFstPoolPolicy(f.request,{...input(),config:c,clock:f.clock,block:f.block,nodeId:'one',deferCanonical:true});
 const args={...input(),amountIn:scale,config:c,preparedPolicy:policy,contextNodeId:'one'};
 const q=await fst.quoteFstSwap(f.request,args);assert.ok(q.out>0n);
 for(const change of [a=>a.preparedPolicy={...policy},a=>a.contextNodeId='two',a=>a.config={...c}]){
  const changed={...args};change(changed);await assert.rejects(fst.quoteFstSwap(f.request,changed),{code:'UNSAFE_QUOTE'});
 }
 const old=f.block.hash;f.block.hash='0x'+'02'.repeat(32);await assert.rejects(fst.quoteFstSwap(f.request,args),{code:'UNSAFE_QUOTE'});f.block.hash=old;
 f.advance(21000);await assert.rejects(fst.quoteFstSwap(f.request,args),{code:'POOL_LIQUIDITY'});
});
test('2.0 intermediate fees use the full first segment and the canonical engine snapshot',async()=>{
 const f=fixture(),engine=createEngine({run:(fn,signal)=>fn(f.request,{id:'one'},signal)},{clock:f.clock,readConfig:async()=>config()});
 const result=await engine.quote(input(alt,alt2)),q=result.quote;
 assert.equal(q.feeMode,'intermediate');assert.equal(q.segments.length,2);assert.equal(q.lpFee,q.segments[0].out*30n/10000n);
 assert.equal(q.segments[1].amountIn,q.segments[0].out-q.lpFee);assert.equal(q.out,q.segments[1].out);
 assert.equal(validateServiceQuote(result,result.input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:f.clock}),result);
});
test('2.0 native wrapping has no pool dependency but still carries canonical and TTL protection',async()=>{
 const f=fixture({onlyWrap:true}),engine=createEngine({run:(fn,signal)=>fn(f.request,{id:'one'},signal)},{clock:f.clock,readConfig:async()=>config()});
 const result=await engine.quote(input(zero,fst.FST_FEE_ASSETS.WBNB)),q=result.quote;
 assert.equal(q.kind,'fstswap');assert.equal(q.out,scale*9970n/10000n);assert.equal(q.stages[0].branches[0].kind,2);assert.equal(q.stages[0].minOut,q.out);
 assert.equal(q.poolCheckedAt+15000,result.expiresAt);assert.equal(f.calls.filter(p=>p.method==='eth_call').length,0);
 assert.deepEqual(f.calls.map(p=>p.params[0]),['latest','0x100']);
 assert.equal(validateServiceQuote(result,result.input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:f.clock}),result);
});
test('standalone prepared native snapshots retain their own canonical check by default',async()=>{
 const f=fixture({onlyWrap:true}),read=async p=>p.method==='eth_getBlockByNumber'?{...f.block,hash:'0x'+'02'.repeat(32)}:f.request(p);
 await assert.rejects(fst.readFstPoolPolicy(read,{...input(zero,fst.FST_FEE_ASSETS.WBNB),config:config(),clock:f.clock,block:f.block,nodeId:'one'}),{code:'UNSAFE_QUOTE'});
});
