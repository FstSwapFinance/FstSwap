// Isolated, network-free heap diagnostic. Run only with node --expose-gc.
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ethers} from 'ethers';
const mode=process.argv[2]||'current',rounds=Number(process.argv[3]||40),waitMs=Number(process.argv[4]||0);
if(typeof globalThis.gc!=='function')throw Error('Run this isolated diagnostic with --expose-gc');
if(!['current','baseline','clear-old'].includes(mode)||!Number.isInteger(rounds)||rounds<2||rounds>500||!Number.isFinite(waitMs)||waitMs<0)throw Error('Invalid isolated diagnostic options');
const baselineRef='bf00371f9f52a723e1927aea3bad6c359d5ff343';
const serviceURL=new URL('../server/fstswap-service.mjs',import.meta.url);
let source=mode==='current'?await readFile(serviceURL,'utf8'):execFileSync('git',['show',baselineRef+':server/fstswap-service.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
const sourceSha256=createHash('sha256').update(source).digest('hex');
const aggPath=source.match(/from '(\.\.\/src\/swap-aggregator\.mjs[^']*)'/)[1];
const fstPath=source.match(/from '(\.\.\/src\/swap-fstswap\.mjs[^']*)'/)[1];
const {SWAP_ABI,SWAP_ADAPTERS,SWAP_TOKENS,readSwapConfig,readSwapConfigFactory,swapActiveRouter}=await import(new URL(aggPath,serviceURL).href);
const {readFstPoolPolicy}=await import(new URL(fstPath,serviceURL).href);
if(mode==='clear-old'){
 const declaration="const nodeId=node?.id||'primary',key=[nodeId,pairKey(input)].join(':'),old=contexts.get(key);";
 if(!source.includes(declaration))throw Error('Diagnostic old-binding marker changed');
 source=source.replace(declaration,"const nodeId=node?.id||'primary',key=[nodeId,pairKey(input)].join(':');let old=contexts.get(key);");
 source=source.replace('  let entry;\n  entry=sharedRead(signal=>pool.run(async request=>{','  old=null;\n  let entry;\n  entry=sharedRead(signal=>pool.run(async request=>{');
}
source=source.replace(/from ['"](\.{1,2}\/[^'"]+)['"]/g,(_,path)=>`from '${new URL(path,serviceURL).href}'`).replace(/from 'ethers'/g,`from '${import.meta.resolve('ethers')}'`);
// Disable timeouts only inside this child process to separate timer lifetimes
// from a completed-entry retention chain. Normal mode can instead wait 18.5 s.
if(!waitMs)AbortSignal.timeout=()=>new AbortController().signal;
const {createEngine}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
globalThis.ethers=ethers;
const E=new ethers.Interface([...SWAP_ABI,
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)',
 'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)',
 'function token0() view returns(address)','function token1() view returns(address)','function balanceOf(address) view returns(uint256)',
 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)',
]);
const Z=ethers.ZeroAddress,S=10n**18n,U=SWAP_TOKENS.usdt.address.toLowerCase(),F=SWAP_TOKENS.fist.address.toLowerCase(),W=SWAP_ADAPTERS.pancake.weth.toLowerCase();
const base=new Set([U,W,'0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d','0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c','0x2170ed0880ac9a755fd29b2688956bd959f933f8']);
const factory='0x'+'99'.repeat(20),router=swapActiveRouter(),pools=new Map(),headers=new Map(),refs={config:[],policy:[],block:[]};
let now=1800000000000,number=0,proofs=0,rpcCalls=0;
const request=async p=>{
 rpcCalls++;
 if(p.method==='eth_chainId')return'0x38';
 if(p.method==='eth_getBlockByNumber'){
  if(p.params[0]==='latest'){
   const block={number:'0x'+(++number).toString(16),hash:'0x'+number.toString(16).padStart(64,'0'),timestamp:ethers.toQuantity(now/1000)};
   headers.set(block.number,block);return block;
  }
  return headers.get(p.params[0]);
 }
 if(p.method!=='eth_call')throw Error('Unexpected diagnostic RPC');
 const calls=E.decodeFunctionData('tryAggregate',p.params[0].data)[1];
 return E.encodeFunctionResult('tryAggregate',[calls.map(c=>{
  const parsed=E.parseTransaction({data:c.callData}),a=parsed.args;let value;
  if(parsed.name==='platformFeeBps')value=[30];
  else if(parsed.name==='feeReceiver')value=['0x'+'12'.repeat(20)];
  else if(parsed.name==='WBNB')value=[W];
  else if(parsed.name==='adapters')value=[true];
  else if(parsed.name==='aggregator')value=[router];
  else if(parsed.name==='VERSION')value=['2.1.0'];
  else if(parsed.name==='defaultFeeToken')value=[U];
  else if(parsed.name==='feeConfigVersion')value=[1n];
  else if(parsed.name==='latestRoundData')value=[1n,100000000n,0n,BigInt(now/1000),1n];
  else if(parsed.name==='decimals')value=[8];
  else if(parsed.name==='factory')value=[factory];
  else if(parsed.name==='getPairInfo'){
   const tokens=[a[1].toLowerCase(),a[2].toLowerCase()].sort(),pair='0x'+ethers.keccak256(ethers.toUtf8Bytes(a[0]+tokens.join(':'))).slice(-40);
   value=[pair,...tokens,1000000n*S,1000000n*S,1000000n*S,0n];
  }else if(parsed.name==='getPool'){
   const tokens=[a[0].toLowerCase(),a[1].toLowerCase()].sort(),exists=tokens.every(t=>base.has(t))||tokens.includes(F)&&tokens.includes(U);
   const address=exists?'0x'+ethers.keccak256(ethers.toUtf8Bytes(tokens.join(':')+':'+a[2])).slice(-40):Z;
   if(exists)pools.set(address.toLowerCase(),tokens);value=[address];
  }else if(parsed.name==='slot0')value=[2n**96n,0,0,0,0,0,true];
  else if(parsed.name==='liquidity'||parsed.name==='balanceOf')value=[1000000n*S];
  else if(parsed.name==='token0'||parsed.name==='token1')value=[pools.get(c.target.toLowerCase())[parsed.name==='token0'?0:1]];
  else if(parsed.name==='quoteExactInputSingle')value=[a[0][2]*BigInt(1000000-Number(a[0][3]))/1000000n,2n**96n,0,0];
  else throw Error('Unexpected diagnostic method '+parsed.name);
  return[true,E.encodeFunctionResult(parsed.name,value)];
 })]);
};
const pool={run:(fn,signal,options={})=>Promise.resolve().then(()=>fn(request,{id:options.nodeId||'one'},signal))};
const engine=createEngine(pool,{clock:()=>now,warmup:{pairs:[{tokenIn:U,tokenOut:F}]},
 readConfig:async(read,options)=>{const c=await readSwapConfig(read,options);if(readSwapConfigFactory(c,read,options.block)===factory)proofs++;refs.config.push(new WeakRef(c));return c;},
 readPolicy:async(read,options)=>{const policy=await readFstPoolPolicy(read,options);refs.policy.push(new WeakRef(policy));refs.block.push(new WeakRef(options.block));return policy;},
});
globalThis.retainedEngine=engine;
const heap=[];
for(let n=0;n<rounds;n++){
 now+=3000;if(!await engine.warmupOnce())throw Error('Diagnostic warm did not complete at round '+n);
 if(n%10===0){await new Promise(r=>setImmediate(r));globalThis.gc();heap.push({round:n+1,heapUsed:process.memoryUsage().heapUsed});}
}
engine.stopWarmup();
if(waitMs)await new Promise(r=>setTimeout(r,waitMs));
for(let n=0;n<8;n++){await new Promise(r=>setImmediate(r));globalThis.gc();}
const alive=Object.fromEntries(Object.entries(refs).map(([key,values])=>[key,values.filter(ref=>ref.deref()!==undefined).length]));
console.log(JSON.stringify({mode,baselineRef:mode==='current'?null:baselineRef,sourceSha256,rounds,waitMs,timeoutMode:waitMs?'native':'disabled-in-child',actualFactoryProofs:proofs,rpcCalls,alive,heap,finalHeapUsed:process.memoryUsage().heapUsed}));
