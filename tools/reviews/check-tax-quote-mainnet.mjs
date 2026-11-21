// Read-only, public-RPC evidence for one canonical FSTSI/WBNB pool.
// Never constructs a transaction, uses an account, signs, sends, or deploys.
import {Interface} from 'ethers';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter} from '../../src/swap-aggregator.mjs';
import {quoteFstRoutes,buildFstQuote,fstRequiresLinearV2} from '../../src/swap-fstswap.mjs';
import {readTransferTaxes,transferNet} from '../../src/swap-transfer-tax.mjs';
globalThis.ethers={Interface};
const BASELINE='59b91a52ca69a21f80cbbba1ce03013e97d47215';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=fileURLToPath(new URL('../../docs/reviews/',import.meta.url));
const TOKEN='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e',WBNB='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',PAIR='0xec6abc1cbaef40878069245c2568401e56c949f1',ZERO='0x'+'00'.repeat(20),BPS=10000n;
const lower=x=>String(x||ZERO).toLowerCase(),noRoute=()=>Object.assign(Error('NO_ROUTE'),{code:'NO_ROUTE'});
const endpoints=['https://bsc.publicnode.com','https://bsc-dataseed.bnbchain.org'],network=[];
let phase='metadata',identity={};
const profileABI=new Interface(['function pair() view returns(address)','function tradeTaxBps(bool) view returns(uint256)','function tradingOpenedAt() view returns(uint256)','function tradingOpenedBlock() view returns(uint256)','function protocolContext() view returns(bool)','function liquidityMode() view returns(uint8)','function feeProcessing() view returns(bool)']);
const profileMulti=new Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
async function request(payload){
 let last;
 for(const [node,url]of endpoints.entries()){
  const start=performance.now();
  try{
   const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,...payload}),signal:AbortSignal.timeout(12000)}),body=await response.json();
   if(body.error||body.result==null)throw Error(body.error?.message||'RPC result unavailable');
   network.push({phase,node,method:payload.method,block:payload.params?.[1]||payload.params?.[0],elapsedMs:performance.now()-start,success:true});
   if(phase==='cold-profile'&&payload.method==='eth_getCode')identity.runtimeBytes=(body.result.length-2)/2;
   if(phase==='cold-profile'&&payload.method==='eth_call'){const decoded=profileMulti.decodeFunctionData('tryAggregate',payload.params[0].data)[1],entries=profileMulti.decodeFunctionResult('tryAggregate',body.result)[0];identity.fields=Object.fromEntries(decoded.map((call,n)=>{const fn=profileABI.parseTransaction({data:call.callData});return[fn.name+(fn.name==='tradeTaxBps'?'('+fn.args[0]+')':''),entries[n].success?profileABI.decodeFunctionResult(fn.name,entries[n].returnData)[0]:null];}));}
   return body.result;
  }catch(error){last=error;network.push({phase,node,method:payload.method,elapsedMs:performance.now()-start,success:false,error:error.message});}
 }
 throw last;
}
const head=await request({method:'eth_getBlockByNumber',params:['latest',false]}),timestamp=Number(BigInt(head.timestamp));
const abi=new Interface(['function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)','function factory() view returns(address)','function getPair(address,address) view returns(address)','function getAmountsOut(uint256,address[]) view returns(uint256[])']);
const call=async(to,name,args=[])=>abi.decodeFunctionResult(name,await request({method:'eth_call',params:[{to,data:abi.encodeFunctionData(name,args)},head.number]}));
const [r,t0,t1,f]=await Promise.all([call(PAIR,'getReserves'),call(PAIR,'token0'),call(PAIR,'token1'),call(PAIR,'factory')]);
const expectedPair=(await call(f[0],'getPair',[TOKEN,WBNB]))[0];if(lower(expectedPair)!==PAIR)throw Error('Canonical pair mismatch');
const pool={adapter:SWAP_ADAPTERS.pancake.adapter,address:PAIR,token0:lower(t0[0]),token1:lower(t1[0]),reserves:[r[0],r[1]],kind:'v2'};
const policy={blockNumber:head.number,blockTimestamp:timestamp,pools:new Map([['canonical-pancake-fstsi',pool]]),allowsRoute:()=>true,assertFresh:()=>true};
phase='cold-profile';let start=performance.now(),before=network.length;
const transferTaxes=await readTransferTaxes(request,{tokens:[TOKEN,WBNB],blockNumber:head.number,timestamp});
const profileSample={elapsedMs:performance.now()-start,rpcAttempts:network.length-before,successfulRpcCalls:network.slice(before).filter(n=>n.success).length,model:transferTaxes.get(TOKEN)};
const oldSource=execFileSync('git',['show',BASELINE+':src/swap-fstswap.mjs'],{cwd:root,encoding:'utf8'}),a=oldSource.indexOf('export async function quoteFstRoutes('),b=oldSource.indexOf('export async function quoteFstSwap(',a);
const baseline=new Function('SWAP_ADAPTERS','SWAP_ABI','swapActiveRouter','fstRequiresLinearV2','noRoute','lower','ZERO','BPS','return ('+oldSource.slice(a,b).trim().replace(/^export /,'')+');')(SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter,fstRequiresLinearV2,noRoute,lower,ZERO,BPS);
const cases=[];
for(const [name,from,to,amount]of [['buy',WBNB,TOKEN,10n**15n],['sell',TOKEN,WBNB,1000n*10n**18n]]){
 const options={from,to,amount,policy,singleHop:true,configVersion:'2.1.0',linearV2Only:true,adaptersOff:[]};
 phase=name+'-baseline';start=performance.now();before=network.length;const old=await baseline(request,options);const oldSample={elapsedMs:performance.now()-start,rpcAttempts:network.length-before,successfulRpcCalls:network.slice(before).filter(n=>n.success).length,out:old.out};
 phase=name+'-patched-profile-reused';start=performance.now();before=network.length;const patched=await quoteFstRoutes(request,{...options,transferTaxes});const patchedSample={elapsedMs:performance.now()-start,rpcAttempts:network.length-before,successfulRpcCalls:network.slice(before).filter(n=>n.success).length,out:patched.out,poolAmountIn:patched.legs[0].poolAmountIn,grossOut:patched.legs[0].grossOut,transferInBps:patched.legs[0].transferInBps,transferOutBps:patched.legs[0].transferOutBps,impact:patched.impact};
 const model=transferTaxes.get(TOKEN),rate=name==='buy'?model.buyBps:model.sellBps;
 const poolAmountIn=name==='sell'?amount-amount*rate/BPS:amount;
 const forward=pool.token0===from,rin=pool.reserves[forward?0:1],rout=pool.reserves[forward?1:0];
 const gross=poolAmountIn*9975n*rout/(rin*10000n+poolAmountIn*9975n),net=name==='buy'?gross-gross*rate/BPS:gross;
 if(patched.out!==net||patched.legs[0].poolAmountIn!==poolAmountIn||patched.legs[0].grossOut!==gross)throw Error('Independent net formula mismatch');
 // Fee semantics tested separately from the segment comparison: WBNB input
 // charges before buy, WBNB output charges after sell. No transfer-tax fee coin.
 phase=name+'-with-platform-fee';
 const config={version:'2.1.0',platformFeeBps:30,defaultFeeToken:WBNB,feeConfigVersion:4n,adaptersOff:[]};
 const total=await buildFstQuote({tokenIn:from,tokenOut:to,amountIn:amount,config,slippageBps:50,findRoute:(a,b,n,used,routeOptions)=>quoteFstRoutes(request,{...options,...routeOptions,from:a,to:b,amount:n,used,transferTaxes})});
 const budget=name==='buy'?amount-amount*30n/BPS:amount,actualIn=name==='sell'?budget-budget*rate/BPS:budget;
 const feeGross=actualIn*9975n*rout/(rin*10000n+actualIn*9975n),feeNet=name==='buy'?feeGross-feeGross*rate/BPS:feeGross;
 const fee=name==='buy'?amount*30n/BPS:feeNet*30n/BPS,expectedOut=name==='sell'?feeNet-fee:feeNet;
 if(total.out!==expectedOut||total.lpFee!==fee||total.minimum!==expectedOut*9950n/BPS)throw Error('Platform fee or minimum mismatch');
 cases.push({name,tokenIn:from,tokenOut:to,amountIn:amount,baseline:oldSample,patchedWithProfileReused:patchedSample,independentFormula:{poolFeeBps:25,transferTaxBps:rate,poolAmountIn,grossPoolOutput:gross,netOutput:net,matches:true},platformFeeExample:{bps:30,mode:total.feeMode,fee:total.lpFee,feeToken:total.feeToken,out:total.out,minimum:total.minimum,slippageBps:50,matchesIndependentFormula:true}});
}
const sourcePaths=['src/swap-fstswap.mjs','src/swap-transfer-tax.mjs'];
const patchSource={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),worktreeModified:Boolean(execFileSync('git',['status','--porcelain','--',...sourcePaths],{cwd:root,encoding:'utf8'}).trim()),sourceSha256:Object.fromEntries(await Promise.all(sourcePaths.map(async file=>[file,sha256(await readFile(root+file))])))};
const report={at:new Date().toISOString(),scope:'Isolated canonical-pool read-only Router sample, not complete public quote-service validation and not a transaction simulation or broadcast. No synthetic pool reserves; gross/net correctness independently calculated from this real pinned block. Timings are sequential public-RPC samples, not statistically controlled performance claims.',baselineCommit:BASELINE,quoteFunctionSHA256:sha256(oldSource.slice(a,b)),patchSource,block:{number:head.number,hash:head.hash,timestamp},pair:pool,profileIdentity:identity,profileSample,cases,network};
await mkdir(out,{recursive:true});const target=out+'tax-quote-mainnet-readonly-20261121.json';await writeFile(target,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log(JSON.stringify({target,block:head.number,profileSample,cases},(_,v)=>typeof v==='bigint'?v.toString():v));
