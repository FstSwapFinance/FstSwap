import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {buildFstQuote,quoteFstSwap,validateFstQuote,fstServiceQuote,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {validateServiceQuote} from '../src/swap-service-client.mjs';
import {createPoolPolicy} from '../src/swap-liquidity.mjs';
import {SWAP_ADAPTERS,swapActiveRouter} from '../src/swap-aggregator.mjs';

globalThis.ethers=ethers;
const token='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e',pair='0xec6abc1cbaef40878069245c2568401e56c949f1';
const w=FST_FEE_ASSETS.WBNB,u=FST_FEE_ASSETS.USDT,adapter=SWAP_ADAPTERS.pancake.adapter.toLowerCase();
const codeHash='7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed';
const config={version:'2.1.0',platformFeeBps:30,defaultFeeToken:u,feeConfigVersion:5n,adaptersOff:[],wbnb:w,feeReceiver:'0x'+'44'.repeat(20)};
const model=(blockNumber='0x10',sellBps=300n)=>({kind:'pair',pair,buyBps:300n,sellBps,codeHash,blockNumber});
async function fixture(){
 const leg={adapter,kind:'v2',path:[token,w],tokenIn:token,tokenOut:w,poolIds:[pair],amountIn:10000n,poolAmountIn:9700n,grossOut:19400n,out:19400n,weightBps:10000,transferInBps:300,transferOutBps:0};
 const q=await buildFstQuote({tokenIn:token,tokenOut:w,amountIn:10000n,config,slippageBps:50,findRoute:async()=>({from:token,to:w,amountIn:10000n,minimum:19303n,out:19400n,legs:[leg],impact:0,assertFresh(){}})});
 Object.assign(q,{quoteModel:'net-transfer-v1',taxProfiles:[{token,...model()}]});
 const id=[adapter,...[token,w].sort(),'v2'].join(':');
 const pools=new Map([[id,{id,address:pair,adapter,kind:'v2',token0:token,token1:w,reserves:[1000000n*10n**18n,2000000n*10n**18n]}]]);
 const policy={...createPoolPolicy(pools,new Map([[w,10n**18n]]),token,w),blockNumber:'0x11',assertFresh(){}};
 const fresh=new Map([[token,model('0x11')],[w,{kind:'none'}]]);
 return{q,policy,fresh};
}

test('fresh preflight permits a new block only when the verified tax model remains unchanged',async()=>{
 const {q,policy,fresh}=await fixture();
 assert.doesNotThrow(()=>validateFstQuote(q,config,policy,{transferTaxes:fresh}));
 fresh.set(token,model('0x11',400n));
 assert.throws(()=>validateFstQuote(q,config,policy,{transferTaxes:fresh}),{code:'UNSAFE_QUOTE'});
});
test('preflight rejects missing or altered quote tax evidence before route execution checks',async()=>{
 const {q,policy,fresh}=await fixture();
 for(const mutate of[q=>q.taxProfiles=[],q=>q.taxProfiles[0].pair=w,q=>q.taxProfiles[0].codeHash='00'.repeat(32)]){
  const changed=structuredClone({...q,assertFresh:undefined,segments:[]});mutate(changed);
  assert.throws(()=>validateFstQuote(changed,config,policy,{transferTaxes:fresh}),{code:'TAX_UNVERIFIED'});
 }
});
test('production DTO serialization preserves gross, pool input, net output and both minimum semantics',async()=>{
 const {q}=await fixture(),quote=fstServiceQuote(q,{slippageBps:50,poolCheckedAt:9500});
 const input={chainId:56,tokenIn:token,tokenOut:w,amountIn:'10000',slippageBps:50,singleHop:false};
 const body={schema:1,chainId:56,router:swapActiveRouter(),input,config,quote,blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:9500,expiresAt:24500};
 assert.equal(validateServiceQuote(body,input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:()=>10000}),body);
 assert.equal(quote.stages[0].minOut,19303n,'stage net is before output platform fee');
 assert.equal(quote.lpFee,58n);assert.equal(quote.out,19342n);assert.equal(quote.minimum,19245n,'final minimum is after platform fee');
 assert.deepEqual(quote.segments[0].legs[0],quote.segments[0].routeStages[0].legs[0]);
});

test('all six fee assets preserve ordinary input/output fee timing and native wrapping in net DTOs',async()=>{
 const btc='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',zero=ethers.ZeroAddress;
 for(const feeToken of Object.values(FST_FEE_ASSETS))for(const [from,to]of[[feeToken,btc],[btc,feeToken]]){
  const q=await buildFstQuote({tokenIn:from,tokenOut:to,amountIn:10000n,config,slippageBps:50,findRoute:async(a,b,amount)=>({from:a,to:b,amountIn:amount,out:amount*2n,impact:0,assertFresh(){},legs:[{adapter,kind:'v2',path:[a===zero?w:a,b===zero?w:b],tokenIn:a,tokenOut:b,amountIn:amount,poolAmountIn:amount,grossOut:amount*2n,out:amount*2n,transferInBps:0,transferOutBps:0,weightBps:10000,poolIds:[pair]}]})});
  q.quoteModel='net-transfer-v1';q.taxProfiles=[];
  const input={chainId:56,tokenIn:from,tokenOut:to,amountIn:'10000',slippageBps:50,singleHop:false},quote=fstServiceQuote(q,{slippageBps:50,poolCheckedAt:9500});
  const body={schema:1,chainId:56,router:swapActiveRouter(),input,config,quote,blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:9500,expiresAt:24500};
  assert.equal(validateServiceQuote(body,input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:()=>10000}),body);
  assert.equal(quote.out,19940n);assert.equal(quote.minimum,19840n);assert.equal(quote.lpFee,from===feeToken?30n:60n);
 }
 for(const [from,to]of[[zero,w],[w,zero]]){
  const q=await quoteFstSwap(async()=>{throw Error('wrap must not read a pool');},{tokenIn:from,tokenOut:to,amountIn:10000n,config,slippageBps:0});
  const quote=fstServiceQuote(q,{slippageBps:0,poolCheckedAt:9500}),input={chainId:56,tokenIn:from,tokenOut:to,amountIn:'10000',slippageBps:0,singleHop:true};
  const body={schema:1,chainId:56,router:swapActiveRouter(),input,config,quote,blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:9500,expiresAt:24500};
  assert.equal(validateServiceQuote(body,input,{router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:()=>10000}),body);
  assert.equal(quote.out,9970n);assert.equal(quote.minimum,9970n);
 }
});
