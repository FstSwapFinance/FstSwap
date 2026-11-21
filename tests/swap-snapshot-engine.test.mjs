import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createEngine} from '../server/fstswap-service.mjs';
import {swapActiveRouter} from '../src/swap-aggregator.mjs?v=mainnet-20261113-47';

const MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),C='0x'+'33'.repeat(20);
const abi=new ethers.Interface([
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function platformFeeBps() view returns(uint256)',
 'function getAmountsOutVia(address,uint256,address[]) view returns(uint256[])',
]);
const input={chainId:56,tokenIn:A,tokenOut:B,amountIn:'100',slippageBps:50,singleHop:false};
function fixture({oracleExpiry=Infinity}={}){
 let now=1800000000000,node='one',hash='0x'+'ab'.repeat(32),reorg=false;
 const calls=[],configs=[],policies=[];
 const header=()=>({number:'0x100',hash,timestamp:ethers.toQuantity(Math.floor(now/1000))});
 const request=async p=>{
  calls.push({node,...p});
  if(p.method==='eth_chainId')return'0x38';
  if(p.method==='eth_getBlockByNumber')return{...header(),hash:reorg&&p.params[0]!=='latest'?'0x'+'cd'.repeat(32):hash};
  const children=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return abi.encodeFunctionResult('tryAggregate',[children.map(c=>{
   const parsed=abi.parseTransaction({data:c.callData});
   const values=parsed.name==='platformFeeBps'?[30n]:[[parsed.args[1],parsed.args[1]*2n]];
   return[true,abi.encodeFunctionResult(parsed.name,values)];
  })]);
 };
 const batch=async(r,children)=>abi.decodeFunctionResult('tryAggregate',await r({method:'eth_call',params:[{
  to:MULTICALL,data:abi.encodeFunctionData('tryAggregate',[false,children]),
 },'0x100']}))[0];
 const pool={run:(fn,signal,options={})=>fn(request,{id:options.nodeId||node},signal)};
 const engine=createEngine(pool,{clock:()=>now,warmup:{enabled:true,pairs:[input]},
  readConfig:async r=>{
   const rows=await batch(r,[[swapActiveRouter(),abi.encodeFunctionData('platformFeeBps',[])]]);
   const config={version:'2.1.0',platformFeeBps:Number(abi.decodeFunctionResult('platformFeeBps',rows[0].returnData)[0])};
   configs.push(config);return config;
  },
  readPolicy:async()=>{const policy={checkedAt:now,pools:new Map(),assertFresh(){if(now>oracleExpiry)throw Object.assign(Error('Oracle expired'),{code:'POOL_LIQUIDITY',reason:'oracle',retryable:true});},assertValue(){}};policies.push(policy);return policy;},
  calculate:async(r,trade,_config,policy)=>{
   const rows=await batch(r,[[swapActiveRouter(),abi.encodeFunctionData('getAmountsOutVia',[A,BigInt(trade.amountIn),[trade.tokenIn,trade.tokenOut]])]]);
   return{out:abi.decodeFunctionResult('getAmountsOutVia',rows[0].returnData)[0][1],poolCheckedAt:policy.checkedAt};
  },
 });
 const methodCalls=name=>calls.filter(p=>p.method==='eth_call').flatMap(p=>Array.from(abi.decodeFunctionData('tryAggregate',p.params[0].data)[1])).filter(c=>abi.parseTransaction({data:c.callData}).name===name);
 return{engine,calls,configs,policies,methodCalls,advance:n=>now+=n,setNode:n=>node=n,setHash:h=>hash=h,setReorg:v=>reorg=v};
}

test('new pairs reuse completed raw snapshot calls while constructing fresh configs and policies',async()=>{
 const f=fixture(),one=await f.engine.quote(input);f.advance(1000);
 const two=await f.engine.quote({...input,tokenOut:C});
 assert.equal(f.configs.length,2);assert.notEqual(f.configs[0],f.configs[1]);
 assert.notEqual(f.policies[0],f.policies[1]);assert.notEqual(f.policies[0].pools,f.policies[1].pools);
 assert.equal(f.methodCalls('platformFeeBps').length,1);
 assert.equal(f.calls.filter(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='latest').length,1);
 assert.equal(two.expiresAt,one.expiresAt);assert.equal(two.quote.poolCheckedAt,one.quote.poolCheckedAt);
 assert.equal(f.calls.filter(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='0x100').length,2);
 f.engine.stopWarmup();
});

test('provider changes isolate raw snapshots and amount changes never reuse the wrong quote',async()=>{
 const f=fixture();
 const one=await f.engine.quote(input),two=await f.engine.quote({...input,amountIn:'101'});
 assert.equal(one.quote.out,200n);assert.equal(two.quote.out,202n);
 f.setNode('two');await f.engine.quote({...input,tokenOut:C});
 assert.equal(f.methodCalls('platformFeeBps').length,2);
 assert.equal(f.methodCalls('getAmountsOutVia').length,3);
 f.engine.stopWarmup();
});

test('snapshot age forces a new header without extending quotes from the old context',async()=>{
 const f=fixture(),one=await f.engine.quote(input);f.advance(8500);
 f.setHash('0x'+'ef'.repeat(32));const two=await f.engine.quote({...input,tokenOut:C});
 assert.notEqual(two.blockHash,one.blockHash);assert.equal(f.methodCalls('platformFeeBps').length,2);
 assert.equal(two.expiresAt-one.expiresAt,8500);
 f.engine.stopWarmup();
});

test('warm refresh reads a new header and leaves an existing quote lifetime unchanged',async()=>{
 const f=fixture(),one=await f.engine.quote(input);f.advance(3000);
 f.setHash('0x'+'ef'.repeat(32));assert.equal(await f.engine.warmupOnce(),true);
 const two=await f.engine.quote({...input,amountIn:'101'});
 assert.notEqual(two.blockHash,one.blockHash);assert.equal(two.expiresAt-one.expiresAt,3000);
 assert.equal(f.methodCalls('platformFeeBps').length,2);
 assert.equal(one.expiresAt,1800000015000);
 f.engine.stopWarmup();
});

test('cache hits cannot bypass the independent final canonical block check',async()=>{
 const f=fixture();await f.engine.quote(input);f.setReorg(true);
 await assert.rejects(f.engine.quote({...input,tokenOut:C}),{code:'STALE_BLOCK'});
 assert.equal(f.methodCalls('platformFeeBps').length,1);
 f.engine.stopWarmup();
});

test('a detected reorg invalidates every old context on that snapshot and allows a fresh recovery',async()=>{
 const f=fixture();await f.engine.quote(input);f.setReorg(true);
 await assert.rejects(f.engine.quote({...input,tokenOut:C}),{code:'STALE_BLOCK'});
 f.setReorg(false);f.setHash('0x'+'ef'.repeat(32));
 const recovered=await f.engine.quote({...input,amountIn:'102'});
 assert.equal(recovered.blockHash,'0x'+'ef'.repeat(32));assert.equal(recovered.quote.out,204n);
 assert.equal(f.methodCalls('platformFeeBps').length,2);
 assert.equal(f.calls.filter(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='latest').length,2);
 f.engine.stopWarmup();
});

test('raw snapshot reuse retains the original Oracle expiry and the snapshot twenty-second ceiling',async()=>{
 const oracle=fixture({oracleExpiry:1800000000500});await oracle.engine.quote(input);oracle.advance(1000);
 await assert.rejects(oracle.engine.quote({...input,tokenOut:C}),{code:'POOL_LIQUIDITY',reason:'oracle'});
 oracle.engine.stopWarmup();
 const f=fixture();await f.engine.quote(input);f.advance(1000);await f.engine.quote({...input,tokenOut:C});
 assert.equal(f.policies[0].checkedAt,f.policies[1].checkedAt);
 f.advance(19001);assert.throws(()=>f.policies[1].assertFresh(),{code:'POOL_LIQUIDITY',reason:'stale'});
 f.engine.stopWarmup();
});

test('a recent completed foreground context keeps its original deadline when warmed',async()=>{
 const f=fixture(),one=await f.engine.quote(input);f.advance(1000);
 assert.equal(await f.engine.warmupOnce(),true);
 const two=await f.engine.quote({...input,amountIn:'101'});
 assert.equal(two.expiresAt,one.expiresAt);assert.equal(f.configs.length,1);
 assert.equal(f.calls.filter(p=>p.method==='eth_getBlockByNumber'&&p.params[0]==='latest').length,1);
 f.engine.stopWarmup();
});
