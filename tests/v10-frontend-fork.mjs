// Local-only integration of frontend quote/request/receipt code with the freshly compiled fee-policy release.
import {readFileSync,writeFileSync} from 'node:fs';
import {ethers} from 'ethers';
import assert from 'node:assert/strict';
const fixture=JSON.parse(readFileSync('tests/walk-out/v10-fees-local-rehearsal.json','utf8'));
if(fixture.rpc!=='http://127.0.0.1:8547')throw Error('local RPC required');
const p=new ethers.JsonRpcProvider(fixture.rpc,56,{staticNetwork:true});
assert.match(await p.send('web3_clientVersion',[]),/anvil/i);
globalThis.ethers=ethers;globalThis.FST_V10_CONFIG=fixture.config;globalThis.FST_RPC_OVERRIDE=[fixture.rpc];
const a=await import('../swap-aggregator.mjs?v10-integration');
const request=({method,params=[]})=>p.send(method,params);
const account=fixture.account, signer=await p.getSigner(account), config=await a.readSwapConfig(request);
assert.equal(config.version,'1.11');assert.equal(config.feeReceiver,fixture.feeReceiver);
const erc=new ethers.Interface(['function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)','function deposit() payable']);
for(const token of [a.SWAP_TOKENS.usdt,a.SWAP_TOKENS.fist]){
 const slot=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address','uint256'],[account,1]));
 const amount=1000n*10n**BigInt(token.decimals);
 await p.send('anvil_setStorageAt',[token.address,slot,ethers.zeroPadValue(ethers.toBeHex(amount),32)]);
 assert.equal(await new ethers.Contract(token.address,erc,p).balanceOf(account),amount);
 await(await signer.sendTransaction({to:token.address,data:erc.encodeFunctionData('approve',[fixture.config.router,ethers.MaxUint256])})).wait();
}
await(await signer.sendTransaction({to:a.SWAP_TOKENS.wbnb.address,data:erc.encodeFunctionData('deposit'),value:ethers.parseEther('1')})).wait();
await(await signer.sendTransaction({to:a.SWAP_TOKENS.wbnb.address,data:erc.encodeFunctionData('approve',[fixture.config.router,ethers.MaxUint256])})).wait();
const checks=[];
async function sendVerify(tx,details){const response=await signer.sendTransaction(tx);const receipt=await response.wait();assert.equal(receipt.status,1);const verified=await a.readV10Receipt(request,response.hash,{account,expectedRequest:tx,...details});checks.push({...details,hash:response.hash,amountOut:verified.amountOut,fee:verified.fee});}
const deadline=Number((await p.getBlock('latest')).timestamp)+600;
const amountIn=2000000n,route=await a.quoteSwap(request,{side:'sell',amountIn,feeBps:30});
assert.equal(route.platformFee,6000n);assert.equal(route.swapBudget,1994000n);
let tx=a.swapTradeRequest(ethers.Interface,{account,route,amountIn,minOut:route.estimateOut,deadline});
await sendVerify(tx,{tokenIn:a.SWAP_TOKENS.fist.address,tokenOut:null,minOut:route.estimateOut,maxIn:amountIn,feeToken:a.SWAP_TOKENS.fist.address});
const empty={adapter:ethers.ZeroAddress,path:[]};
const first={adapter:a.SWAP_ADAPTERS.fst.adapter,path:[a.SWAP_TOKENS.usdt.address,a.SWAP_TOKENS.fist.address]};
const exact=await a.v10QuoteExactOutput(request,{first,amountOut:1000000n,mode:2});
tx=a.v10Request(ethers.Interface,{account,method:'swapTokenForExactToken',args:[first,empty,1000000n,exact.amountIn,deadline,account]});
await sendVerify(tx,{tokenIn:first.path[0],tokenOut:first.path[1],minOut:1000000n,maxIn:exact.amountIn,feeToken:first.path[0]});
const input=a.SWAP_TOKENS.wbnb.address,output='0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',total=10n**16n;
const main={adapter:a.SWAP_ADAPTERS.pancake.adapter,path:[input,output]};
const plan=await a.v10PlanFeeConversion(request,{input,feeBudget:total*30n/10000n,config,slippageBps:50,mainLegs:[main]});
const out=(await a.v10AmountsOut(request,'pancake',total-total*30n/10000n,main.path)).at(-1);
tx=a.v10Request(ethers.Interface,{account,method:'swapTokenToTokenWithFee',args:[main,empty,total,out,deadline,account,plan.conversion]});
await sendVerify(tx,{tokenIn:input,tokenOut:output,minOut:out,maxIn:total,feeToken:config.defaultFeeToken});
assert.equal(checks[2].fee,plan.fee);
writeFileSync('tests/walk-out/v10-frontend-fork-result.json',JSON.stringify({environment:'LOCAL ANVIL ONLY',config,checks},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log('3 local frontend quote → transaction → canonical receipt flows passed.');
