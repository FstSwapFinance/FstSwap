import { AbiCoder,ZeroAddress } from 'ethers';
import { FSTSWAP_CONFIG } from '../src/fstswap-config.mjs?v=mainnet-20261113-50';
import { SWAP_ADAPTERS,SWAP_TOKENS,swapActiveRouter } from '../src/swap-aggregator.mjs?v=mainnet-20261113-50';
import { MAINSTREAM_TOKENS } from '../src/swap-liquidity.mjs?v=mainnet-20261113-50';
import { SWAP_QUOTE_PIPELINE_BYTECODE } from './swap-quote-pipeline-bytecode.mjs';
import { measurePhase,countTiming } from './swap-timing.mjs';

const abi=AbiCoder.defaultAbiCoder();
const inputTypes=['uint256','tuple(uint8,address,address,uint24)[]','tuple(uint8,uint16,uint256)[]','uint16[4]'];
const resultTypes=['uint256','uint256[]','uint256'];
const adapters=new Map(Object.entries(FSTSWAP_CONFIG.adapters).map(([key,address])=>[address.toLowerCase(),{fst:1,pancake:2,v3:3}[key]]));
const MAX_STEPS=256,MAX_EDGES=80,LITERAL=65535,MAX_INITCODE=49152,GAS_LIMIT='0xb71b00';
const USDT=SWAP_TOKENS.usdt.address.toLowerCase();
const ADDRESS=/^0x[0-9a-f]{40}$/;
const MAINNET_ROUTER=FSTSWAP_CONFIG.router.toLowerCase();

function encodeLeg(leg){
 const adapter=adapters.get(leg.adapter.toLowerCase());
 if(adapter===undefined||(adapter===3?leg.kind!=='v3':leg.kind!=='v2'))return null;
 let tokenIn,tokenOut,fee=0;
 if(adapter===3){
  if(!/^0x[0-9a-f]{86}$/.test(leg.path))return null;
  tokenIn=leg.path.slice(0,42);tokenOut='0x'+leg.path.slice(48);
  fee=Number.parseInt(leg.path.slice(42,48),16);
  if(![100,500,2500,10000].includes(fee))return null;
 }else{
  if(!Array.isArray(leg.path)||leg.path.length!==2)return null;
  [tokenIn,tokenOut]=leg.path;
 }
 if(![tokenIn,tokenOut].every(token=>ADDRESS.test(token)&&token!==ZeroAddress&&MAINSTREAM_TOKENS.has(token)))return null;
 return [adapter,tokenIn,tokenOut,fee];
}

function buildPlan({routes,splits,amount,blockNumber}){
 const steps=[],edges=[],edgeIds=new Map(),bounds=[0];
 const routeIndices=routes.map(()=>[]),splitIndices=splits.map(()=>[]);
 if(routes.reduce((total,route)=>total+route.length,0)+splits.length*2>MAX_STEPS)return null;

 function append(leg,prior,input,indices){
  const edge=encodeLeg(leg);
  if(!edge)return false;
  const key=edge.join(':');
  if(!edgeIds.has(key)){
   if(edges.length===MAX_EDGES)return false;
   edgeIds.set(key,edges.length);edges.push(edge);
  }
  indices.push(steps.length);
  steps.push([edgeIds.get(key),prior,input]);
  return true;
 }

 for(let depth=0;depth<3;depth++){
  for(const [n,route] of routes.entries()){
   if(route[depth]&&!append(route[depth],depth?routeIndices[n][depth-1]:LITERAL,depth?0n:amount,routeIndices[n]))return null;
  }
  if(depth===0){
   for(const [n,split] of splits.entries()){
    if(!split.every(item=>append(item.leg,LITERAL,item.amount,splitIndices[n])))return null;
   }
  }
  bounds.push(steps.length);
 }
 const block=BigInt(blockNumber);
 const args=abi.encode(inputTypes,[block,edges,steps,bounds]);
 const data=SWAP_QUOTE_PIPELINE_BYTECODE+args.slice(2);
 if((data.length-2)/2>MAX_INITCODE)return null;
 return {block,blockNumber,data,routeIndices,splitIndices,stepCount:steps.length};
}

function decodePlan(raw,plan){
 if(typeof raw!=='string'||raw.length!==2+64*(4+plan.stepCount))return null;
 try{
  const [block,outputs,calls]=abi.decode(resultTypes,raw);
  if(block!==plan.block||outputs.length!==plan.stepCount||calls<=0n||calls>BigInt(plan.stepCount)||outputs.some(output=>output<=0n))return null;
  countTiming('quote_subcalls',Number(calls));
  return {
   routeOutputs:plan.routeIndices.map(indices=>indices.map(index=>outputs[index])),
   splitOutputs:plan.splitIndices.map(indices=>indices.map(index=>outputs[index])),
  };
 }catch{return null;}
}

export function createQuotePipeline(request,input,config,blockNumber){
 if(typeof request.quoteSimulation!=='function'||config.version!=='2.1.0'||input.tokenIn!==ZeroAddress||input.tokenOut!==USDT||input.singleHop)return undefined;
 if(swapActiveRouter().toLowerCase()!==MAINNET_ROUTER||Object.entries(FSTSWAP_CONFIG.adapters).some(([key,address])=>SWAP_ADAPTERS[key]?.adapter.toLowerCase()!==address.toLowerCase()))return undefined;
 return async quote=>{
  if(quote.from!==ZeroAddress||quote.to!==USDT||quote.blockNumber!==blockNumber)return null;
  const plan=buildPlan(quote);
  if(!plan)return null;
  const payload={method:'eth_call',params:[{data:plan.data,gas:GAS_LIMIT},plan.blockNumber]};
  return measurePhase('quote_pipeline',()=>request.quoteSimulation(payload,raw=>decodePlan(raw,plan)));
 };
}
