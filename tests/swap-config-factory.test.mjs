import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {readFile} from 'node:fs/promises';
globalThis.ethers=ethers;
// Use the same module instance as the policy reader's config proof registry.
const policySource=await readFile(new URL('../src/swap-liquidity.mjs',import.meta.url),'utf8');
const configImport=policySource.match(/from '(\.\/swap-aggregator\.mjs[^']*)'/)[1];
const {readSwapConfig,SWAP_ABI,SWAP_ADAPTERS,SWAP_TOKENS,swapActiveRouter}=await import(new URL(configImport,new URL('../src/swap-liquidity.mjs',import.meta.url)).href);
const {readPoolPolicy}=await import('../src/swap-liquidity.mjs');
const ZERO=ethers.ZeroAddress,FACTORY='0x'+'99'.repeat(20),OTHER='0x'+'77'.repeat(20);
const iface=new ethers.Interface([...SWAP_ABI,
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
function fixture({factoryResult='valid'}={}){
 const time=1800000000000,block={number:'0x100',timestamp:ethers.toQuantity(time/1000),hash:'0x'+'01'.repeat(32)};
 const batches=[],factories=[];
 const read=async payload=>{
  if(payload.method==='eth_chainId')return '0x38';
  if(payload.method==='eth_getBlockByNumber')return {...block};
  assert.equal(payload.method,'eth_call');
  const calls=iface.decodeFunctionData('tryAggregate',payload.params[0].data)[1];
  const parsed=calls.map(c=>iface.parseTransaction({data:c.callData}));
  const isConfig=parsed.some(p=>p.name==='platformFeeBps');
  if(!isConfig)assert.equal(payload.params[1],block.number);
  batches.push({isConfig,blockTag:payload.params[1],methods:parsed.map(p=>p.name)});
  return iface.encodeFunctionResult('tryAggregate',[parsed.map((p,index)=>{
   const result=values=>[true,iface.encodeFunctionResult(p.name,values)];
   switch(p.name){
    case 'platformFeeBps':return result([30]);
    case 'feeReceiver':return result(['0x'+'66'.repeat(20)]);
    case 'WBNB':return result([SWAP_ADAPTERS.fst.weth]);
    case 'adapters':return result([true]);
    case 'aggregator':return result([swapActiveRouter()]);
    case 'VERSION':return result(['2.1.0']);
    case 'defaultFeeToken':return result([SWAP_TOKENS.usdt.address]);
    case 'feeConfigVersion':return result([1n]);
    case 'factory':
     if(isConfig&&factoryResult==='failed')return[false,'0x'];
     if(isConfig&&factoryResult==='malformed')return[true,'0x1234'];
     return result([isConfig&&factoryResult==='zero'?ZERO:FACTORY]);
    case 'getPool':factories.push(calls[index].target.toLowerCase());return result([ZERO]);
    case 'getPairInfo':return result([ZERO,p.args[1],p.args[2],0n,0n,0n,0n]);
    case 'latestRoundData':return result([1n,100000000n,0n,BigInt(time/1000),1n]);
    case 'decimals':return result([8]);
    default:throw Error('Unexpected method '+p.name);
   }
  })]);
 };
 return{read,block,batches,factories,clock:()=>time};
}
const policy=(f,config,read=f.read)=>readPoolPolicy(read,{tokenIn:SWAP_TOKENS.usdt.address,tokenOut:SWAP_TOKENS.fist.address,config,v3Mode:'legacy',clock:f.clock});
const standaloneFactoryReads=f=>f.batches.filter(b=>!b.isConfig&&b.methods.length===1&&b.methods[0]==='factory').length;

test('fixed-block config batches V3 discovery and saves the policy factory RPC round',async()=>{
 const f=fixture(),config=await readSwapConfig(f.read,{block:f.block});
 assert.equal(config.v3Factory,FACTORY);
 assert.equal(config.platformFeeBps,30);assert.equal(config.version,'2.1.0');assert.deepEqual(config.adaptersOff,[]);
 assert.equal(f.batches.length,1);assert.equal(f.batches[0].blockTag,'0x100');
 assert.equal(f.batches[0].methods.includes('factory'),true);
 await policy(f,config);
 assert.equal(standaloneFactoryReads(f),0);
 assert.ok(f.factories.length>0);assert.equal(f.factories.every(a=>a===FACTORY),true);
});

test('unfixed config still reads its own V3 factory in the policy snapshot',async()=>{
 const f=fixture(),config=await readSwapConfig(f.read);
 assert.equal(f.batches[0].methods.includes('factory'),false);
 await policy(f,config);assert.equal(standaloneFactoryReads(f),1);
});

test('an incomplete block hint cannot enable the config factory optimization',async()=>{
 for(const hint of[{number:'0x100'}, {number:'latest',hash:'0x'+'01'.repeat(32)}, {number:'0x100',hash:'bad'}]){
  const f=fixture(),config=await readSwapConfig(f.read,{block:hint});
  assert.equal(config.v3Factory,undefined);assert.equal(f.batches[0].blockTag,'latest');
  assert.equal(f.batches[0].methods.includes('factory'),false);
  await policy(f,config);assert.equal(standaloneFactoryReads(f),1);
 }
});

test('copied or server-provided config cannot inject a factory to skip discovery',async()=>{
 for(const mutate of[c=>({...c}),c=>JSON.parse(JSON.stringify(c,(_,v)=>typeof v==='bigint'?v.toString():v))]){
  const f=fixture(),config=await readSwapConfig(f.read,{block:f.block});
  await policy(f,{...mutate(config),v3Factory:OTHER});
  assert.equal(standaloneFactoryReads(f),1);assert.equal(f.factories.every(a=>a===FACTORY),true);
 }
});

test('a config proof cannot be reused by a different RPC reader',async()=>{
 const f=fixture(),config=await readSwapConfig(f.read,{block:f.block});
 await policy(f,config,p=>f.read(p));assert.equal(standaloneFactoryReads(f),1);
});

test('a config proof cannot cross a block height or hash',async()=>{
 for(const change of[b=>{b.number='0x101';},b=>{b.hash='0x'+'02'.repeat(32);}]){
  const f=fixture(),config=await readSwapConfig(f.read,{block:{...f.block}});
  change(f.block);await policy(f,config);assert.equal(standaloneFactoryReads(f),1);
 }
});

test('failed, zero or malformed optional factory results retain normal config and fallback',async()=>{
 for(const factoryResult of['failed','zero','malformed']){
  const f=fixture({factoryResult}),config=await readSwapConfig(f.read,{block:f.block});
  assert.equal(config.platformFeeBps,30);assert.equal(config.v3Factory,undefined);
  await policy(f,config);assert.equal(standaloneFactoryReads(f),1);
 }
});

test('mutating a visible config factory field cannot change the private snapshot proof',async()=>{
 const f=fixture(),config=await readSwapConfig(f.read,{block:f.block});
 config.v3Factory=OTHER;await policy(f,config);
 assert.equal(standaloneFactoryReads(f),0);assert.equal(f.factories.every(a=>a===FACTORY),true);
});
