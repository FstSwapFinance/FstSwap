import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder,ZeroAddress } from 'ethers';
import { createQuotePipeline } from '../server/swap-quote-pipeline.mjs';
import { createEngine,createReadPool } from '../server/fstswap-service.mjs';
import { SWAP_QUOTE_PIPELINE_BYTECODE } from '../server/swap-quote-pipeline-bytecode.mjs';
import { SWAP_ADAPTERS } from '../src/swap-aggregator.mjs?v=mainnet-20261113-50';

const abi=AbiCoder.defaultAbiCoder();
const U='0x55d398326f99059ff775485246999027b3197955';
const W='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const v2=(a,b)=>({adapter:SWAP_ADAPTERS.pancake.adapter,kind:'v2',path:[a,b]});
const v3=(a,b)=>({adapter:SWAP_ADAPTERS.v3.adapter,kind:'v3',path:a+'0001f4'+b.slice(2)});
const blockNumber='0x100',config={version:'2.1.0'};
const input={tokenIn:ZeroAddress,tokenOut:U,singleHop:false};
const direct=v2(W,U),alternative=v3(W,U),first=v3(W,C),second=v2(C,U);
const plan={from:input.tokenIn,to:input.tokenOut,amount:101n,blockNumber,routes:[[direct],[first,second],[alternative]],
 splits:[[{leg:direct,amount:25n},{leg:alternative,amount:76n}]]};
const inputTypes=['uint256','tuple(uint8,address,address,uint24)[]','tuple(uint8,uint16,uint256)[]','uint16[4]'];
const resultTypes=['uint256','uint256[]','uint256'];
const response=(block=256n,outputs=[200n,100n,201n,49n,150n,202n])=>abi.encode(resultTypes,[block,outputs,6n]);

test('the server builds a pinned, tightly scoped simulation with exact dependencies and split remainder',async()=>{
 const request={quoteSimulation:async (payload,decode)=>{
  assert.equal(payload.method,'eth_call');assert.equal(payload.params[1],blockNumber);
  const {data,gas,...other}=payload.params[0];
  assert.deepEqual(other,{});assert.equal(gas,'0xb71b00');assert.ok(data.startsWith(SWAP_QUOTE_PIPELINE_BYTECODE));
  const [block,edges,steps,bounds]=abi.decode(inputTypes,'0x'+data.slice(SWAP_QUOTE_PIPELINE_BYTECODE.length));
  assert.equal(block,256n);assert.deepEqual([...bounds],[0n,5n,6n,6n]);
  assert.deepEqual(steps.map(step=>[...step]),[
   [0n,65535n,101n],[1n,65535n,101n],[2n,65535n,101n],[0n,65535n,25n],[2n,65535n,76n],[3n,1n,0n],
  ]);
  assert.deepEqual(edges.map(edge=>[edge[0],edge[3]]),[[2n,0n],[3n,500n],[3n,500n],[2n,0n]]);
  return decode(response());
 }};
 assert.deepEqual(await createQuotePipeline(request,input,config,blockNumber)(plan),{
  routeOutputs:[[200n],[100n,202n],[201n]],splitOutputs:[[49n,150n]],
 });
});

test('other pairs, older routers, untrusted edges, larger plans and wrong snapshots are ineligible',async()=>{
 let calls=0;
 const request={quoteSimulation:async()=>{calls++;return response();}};
 assert.equal(createQuotePipeline(request,{...input,tokenOut:C},config,blockNumber),undefined);
 assert.equal(createQuotePipeline(request,{...input,singleHop:true},config,blockNumber),undefined);
 assert.equal(createQuotePipeline(request,input,{version:'2.0.0'},blockNumber),undefined);
 const run=createQuotePipeline(request,input,config,blockNumber);
 assert.equal(await run({...plan,routes:[[v2(W,F),v2(F,U)]]}),null);
 assert.equal(await run({...plan,routes:[[v2(W,C),{...second,adapter:F}]]}),null);
 assert.equal(await run({...plan,blockNumber:'0x101'}),null);
 assert.equal(await run({...plan,routes:Array.from({length:129},()=>[first,second])}),null);
 assert.equal(calls,0);
});

test('wrong-block, short, zero or missing simulation output forces a complete fallback',async()=>{
 for(const raw of [null,'0x',response(257n),response(256n,[200n]),response(256n,[200n,0n,201n,49n,150n,202n])]){
  const run=createQuotePipeline({quoteSimulation:async(_payload,decode)=>decode(raw)},input,config,blockNumber);
  assert.equal(await run(plan),null);
 }
});

test('even a successful simulation is discarded by the final canonical check after a reorg',async()=>{
 const now=1800000000000,block={number:blockNumber,hash:'0x'+'ab'.repeat(32),timestamp:'0x6b49d200'};
 const requests=[];
 const pool=createReadPool(['https://pipeline.invalid'],{clock:()=>now,fetchImpl:async(_url,{body})=>{
  const wire=JSON.parse(body),items=Array.isArray(wire)?wire:[wire];
  const replies=items.map(item=>{
   if(item.method==='eth_chainId')return {id:item.id,result:'0x38'};
   if(item.method==='eth_call'){
    requests.push('simulation');assert.equal(item.params[1],blockNumber);
    return {id:item.id,result:response()};
   }
   if(item.params[0]==='latest')return {id:item.id,result:block};
   requests.push('canonical');
   return {id:item.id,result:{...block,hash:'0x'+'cd'.repeat(32)}};
  });
  return Response.json(Array.isArray(wire)?replies:replies[0]);
 }});
 const engine=createEngine(pool,{
  clock:()=>now,warmup:{enabled:false},readConfig:async()=>config,
  readPolicy:async()=>({checkedAt:now,assertFresh(){}}),
  calculate:async(_request,_input,_config,_policy,{quotePipeline})=>{
   const simulated=await quotePipeline(plan);
   assert.ok(simulated);requests.push('accepted simulation');
   return {out:simulated.routeOutputs[1][1]};
  },
 });
 await assert.rejects(engine.quote({...input,chainId:56,amountIn:'101',slippageBps:50}),{code:'STALE_BLOCK'});
 assert.deepEqual(requests,['simulation','accepted simulation','canonical']);
});
