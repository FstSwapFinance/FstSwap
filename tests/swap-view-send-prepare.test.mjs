import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ethers} from 'ethers';
import {sendWalletOnce} from '../src/swap-send.mjs';
import {createSubmissionReadContext,prepareSwapSubmission,prepareGasOptions,recheckSwapQuote} from '../src/swap-preflight.mjs';
import {createApprovalTracker} from '../src/swap-approval.mjs';
import {createRpcWorkScheduler} from '../src/swap-rpc-work.mjs';
import {fstRequest,FST_ABI,recheckFstQuote} from '../src/swap-fstswap.mjs';
import {swapApproveRequest,SWAP_ABI,SWAP_ADAPTERS} from '../src/swap-aggregator.mjs?v=mainnet-20261113-47';
import {createSubmissionWarmup} from '../src/swap-submission-warmup.mjs';
import {createIdleRead} from '../src/swap-idle-read.mjs';
import {createWalletTiming,timeWalletPhase,walletTimingFailure} from '../src/swap-wallet-timing.mjs';
globalThis.ethers=ethers;
const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const clockHelpers=[...source.matchAll(/^function (?:quoteNow|warmNow)\([^\n]+$/gm)].map(match=>match[0]).join('\n');
const sendController=source.slice(source.indexOf('  async function sendTx('),source.indexOf('  async function waitReceipt('));
const approveController=source.slice(source.indexOf('  async function approve()'),source.indexOf('  // —— 确认 / 等待'));
const swapController=source.slice(source.indexOf('  async function showApprovalIfNeeded('),source.indexOf('  // 每次进入兑换页'));
const warmMarker=source.indexOf('  // Public-only submission preparation');
const warmController=warmMarker<0?'':source.slice(warmMarker,source.indexOf('  async function sendTx(',warmMarker));
const clickMarker=source.indexOf('  async function handleSwapClick('),clickController=clickMarker<0?'':source.slice(clickMarker,source.indexOf('  function pendingModal(',clickMarker));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
const account='0x'+'11'.repeat(20),tokenIn='0x55d398326f99059ff775485246999027b3197955',tokenOut='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',router='0x'+'22'.repeat(20),adapter='0x'+'77'.repeat(20),hash='0x'+'33'.repeat(32),blockHash='0x'+'44'.repeat(32);
function fixture(){
 const events=[],sent=[],errors=[],gasGate=deferred(),policyGate=deferred(),receiptGate=deferred(),map=new Map();
 const storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 let locked=false;const locks={request:async(_,opts,fn)=>{if(locked)return fn(null);locked=true;try{return await fn({});}finally{locked=false;}}};
 const block={number:'0x123',hash:blockHash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)};
 const codec=new ethers.Interface(FST_ABI),wallet={account};
 wallet.provider={request:async({method,params})=>{
  events.push(method);if(method==='eth_chainId')return'0x38';if(method==='eth_accounts')return[wallet.account];
  if(method==='eth_getCode')return'0x1234';if(method==='eth_getBlockByNumber')return block;if(method==='eth_getTransactionCount')return'0x7';
  if(method==='eth_call')return codec.encodeFunctionResult('swapExactInput',[120n]);
  if(method==='eth_sendTransaction'){sent.push(params[0]);return hash;}
  throw Error('unexpected wallet '+method);
 }};
 const policy={assertFresh:()=>true,assert:()=>true,assertValue:()=>true};
 const config={version:'2.1.0',feeConfigVersion:1n,platformFeeBps:30,defaultFeeToken:tokenIn,feeReceiver:account,wbnb:router,adaptersOff:[]};
 const q={kind:'fstswap',tokenIn,tokenOut,amountIn:100n,out:120n,minimum:100n,feeToken:tokenIn,configVersion:1n,impact:0,
  stages:[{tokenIn,tokenOut,minOut:100n,branches:[{adapter,kind:0,weightBps:10000,path:[tokenIn,tokenOut],v3Path:'0x'}]}],serviceMeta:{config},serviceExpiresAt:Date.now()+15000};
 const state={quote:q,allowance:100n,amount:'100',config},settings={slippageBps:50,deadlineMinutes:20,singleHop:false};
 const transactionRead=async({method})=>{
  if(method==='eth_getBlockByNumber')return block;
  if(method==='eth_estimateGas'||method==='eth_gasPrice'){events.push(method);await gasGate.promise;return method==='eth_estimateGas'?'0x10000':'0x1';}
  throw Error('unexpected public '+method);
 };
 const context={AbortController,AbortSignal,DOMException,Date,Promise,BigInt,setTimeout,clearTimeout,ethers,wallet,state,settings,main:{isConnected:true},document:{hidden:false},navigator:{onLine:true},
  submissionWarmup:createSubmissionWarmup(),submissionWarmTimer:null,walletSubmissionEpoch:0,activeBalanceReads:0,walletTiming:{begin:()=>undefined},timeWalletPhase,walletTimingFailure,
  swapService:{now:()=>Date.now(),timeBounds:()=>({lower:Date.now(),upper:Date.now()})},
  activeSubmissionContext:null,activeWalletController:null,createSubmissionReadContext,prepareSwapSubmission,prepareGasOptions,recheckSwapQuote,
  swapApproveRequest,fstRequest,FST_ABI,swapActiveRouter:()=>router,spender:()=>router,
  inT:()=>({key:'usdt',address:tokenIn,symbol:'USDT',decimals:18}),outT:()=>({key:'fist',address:tokenOut,symbol:'FIST',decimals:6}),
  approvalIdentity:()=>({account:wallet.account,token:tokenIn,spender:router}),approvals:createApprovalTracker(),swapRpcWork:createRpcWorkScheduler(),
  cancelNativeMax:()=>events.push('cancelNativeMax'),transactionRead,swapPublicRpc:()=>transactionRead,sendWalletOnce:options=>sendWalletOnce({...options,storage,locks}),
  swapSummary:()=>['100','USDT','120','FIST'],minOut:()=>100n,pendingModal:()=>{},submittedModal:()=>{},closeModal:()=>{},checkServiceQuote:()=>{},refreshExpiredServiceQuote:()=>false,assertQuoteSafety:()=>{},
  readSwapConfig:async()=>{events.push('config');return config;},recheckFstQuote:async()=>{events.push('policy');await policyGate.promise;return policy;},
  needsApproval:()=>state.allowance<100n,inputError:()=>'',refreshAllowance:async()=>{},renderBottom:()=>{},render:()=>{},refreshBalances:()=>{},refreshNativeBalance:()=>{},
  quoteFlow:{pause(){}},otherBalances:{pause(){},schedule(){}},stopPairPrice:()=>{},scheduleQuote:()=>{},tr:zh=>zh,T:zh=>zh,
  popup:value=>{if(value.success===false)errors.push(value.summary);},errorModal:message=>errors.push(message),
  waitReceipt:()=>receiptGate.promise,readV10Receipt:async()=>{},createReceiptReadScope:read=>({read,dispose(){}}),swapV10Ready:()=>true,saveHistory:()=>{},
 };
 vm.createContext(context);vm.runInContext(clockHelpers+'\n'+warmController+sendController+approveController+clickController+swapController,context);
 return{context,state,settings,wallet,q,events,sent,errors,gasGate,policyGate,receiptGate};
}


function nativeFundingFixture(balance){
 const f=fixture(),zero=ethers.ZeroAddress,read=f.context.transactionRead;
 f.q.tokenIn=zero;f.q.feeToken=zero;f.state.config.defaultFeeToken=zero;
 f.q.stages[0].tokenIn=zero;f.q.stages[0].branches[0].path[0]=SWAP_ADAPTERS.fst.weth;
 f.context.inT=()=>({key:'bnb',address:zero,symbol:'BNB',decimals:18});
 const fundedRead=async(payload,options)=>{if(payload.method==='eth_getBalance'){f.events.push('eth_getBalance');assert.deepEqual(Array.from(payload.params),[account,'latest']);return ethers.toQuantity(balance);}return read(payload,options);};
 f.context.transactionRead=fundedRead;f.context.swapPublicRpc=()=>fundedRead;
 f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();
 return f;
}
test('real native swap refuses a final balance one wei below value plus prepared Gas cost',async()=>{
 // The real preparation pads a 65536-gas estimate to 85196 gas at 1 wei/gas.
 const f=nativeFundingFixture(85295n);
 await f.context.executeSwap(f.q);
 assert.equal(f.events.filter(method=>method==='eth_getBalance').length,1);
 assert.equal(f.sent.length,0,'insufficient native Gas must stop before eth_sendTransaction');
 assert.equal(f.events.includes('eth_sendTransaction'),false);
 assert.deepEqual(f.errors,['BNB 余额不足以支付当前 Gas，请重新选择 Max']);
});
test('real native swap sends the exact value and Gas parameters when their total is affordable',async()=>{
 const balance=85296n,f=nativeFundingFixture(balance);
 await f.context.executeSwap(f.q);
 assert.equal(f.events.filter(method=>method==='eth_getBalance').length,1);
 assert.equal(f.sent.length,1);assert.deepEqual(f.errors,[]);
 const sent=f.sent[0];assert.equal(BigInt(sent.value),100n);assert.equal(BigInt(sent.gas),85196n);assert.equal(BigInt(sent.gasPrice),1n);
 assert.equal(BigInt(sent.value)+BigInt(sent.gas)*BigInt(sent.gasPrice),balance);
});

test('the real authorization controller starts wallet guards before gas information resolves',async()=>{
 const f=fixture(),running=f.context.approve();
 try{await tick();assert.ok(f.events.includes('eth_estimateGas'));assert.ok(f.events.includes('eth_getCode'));assert.equal(f.sent.length,0);}
 finally{f.gasGate.resolve();f.receiptGate.resolve();await running;}
 assert.equal(f.sent.length,1);assert.deepEqual(f.errors,[]);
});
test('debug-enabled real controllers record page preparation and actual send invocation separately',async()=>{
 for(const kind of ['approve','swap']){
  const f=fixture();f.context.walletTiming=createWalletTiming({search:'?debug=wallet-timing',output:()=>{},expose:{}});f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();
  if(kind==='approve'){f.state.allowance=0n;await f.context.approve();}else await f.context.executeSwap(f.q);
  const row=f.context.walletTiming.snapshot()[0],phases=row.events.map(event=>event.phase);assert.equal(row.operation,kind);assert.equal(phases[0],'click');
  for(const phase of ['guard_start','guard_done','prepare_start','prepare_done','final_guard_start','final_guard_done','send_invoked','public_gas_start','public_gas_end','finished'])assert.ok(phases.includes(phase),kind+':'+phase);
  if(kind==='swap')for(const phase of ['public_config_start','public_config_end','public_allowance_start','public_allowance_end','public_policy_start','public_policy_end','wallet_simulation_start','wallet_simulation_end'])assert.ok(phases.includes(phase),phase);
  assert.equal(phases.includes('wallet_visible'),false);assert.equal(JSON.stringify(row).includes('0x'),false);assert.equal(f.sent.length,1);
 }
});
test('an unknown allowance button click is timed as refresh-only without opening payment',async()=>{
 const f=fixture(),button={disabled:false};f.context.walletTiming=createWalletTiming({search:'?debug=wallet-timing',output:()=>{},expose:{}});f.state.allowance=null;
 let reads=0;f.context.refreshAllowance=async()=>{reads++;f.state.allowance=100n;};
 await f.context.handleSwapClick(button);assert.equal(reads,1);assert.equal(f.sent.length,0);assert.equal(button.disabled,true);
 const phases=f.context.walletTiming.snapshot()[0].events.map(event=>event.phase);assert.ok(phases.includes('allowance_refresh_only'));assert.ok(phases.includes('public_allowance_end'));assert.ok(phases.includes('approval_refreshed'));assert.equal(phases.at(-1),'finished');assert.equal(phases.includes('send_invoked'),false);
});
test('the real swap controller overlaps full route preparation with wallet guards',async()=>{
 const f=fixture(),running=f.context.executeSwap(f.q);
 try{await tick();assert.ok(f.events.includes('policy'));assert.ok(f.events.includes('eth_getCode'));assert.equal(f.sent.length,0);}
 finally{f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();await running;}
 assert.equal(f.sent.length,1);assert.deepEqual(f.errors,[]);
});
test('a changed wallet provider during real authorization cannot receive a payment request',async()=>{
 const f=fixture(),running=f.context.approve();await tick();
 f.wallet.provider={request:async()=>{throw Error('wrong provider must not be called');}};
 f.gasGate.resolve();f.receiptGate.resolve();await running;assert.equal(f.sent.length,0);
});
test('a changed quote or settings during real swap cannot reach payment',async()=>{
 for(const change of [f=>{f.state.quote={...f.q};},f=>{f.settings.slippageBps=100;},f=>{f.settings.singleHop=true;},f=>{f.settings.deadlineMinutes=30;},f=>{f.state.amount='101';},f=>{f.context.inT=()=>({address:router,key:'other'});},f=>{f.context.outT=()=>({address:router,key:'other'});},f=>{f.wallet.provider={request:()=>{throw Error('new wallet must not be called');}};}]){
  const f=fixture(),running=f.context.executeSwap(f.q);await tick();change(f);f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();await running;assert.equal(f.sent.length,0);
 }
});
test('a quote expiring during real submission preparation rejects as stale without a wallet send',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=fixture();f.context.walletTiming=createWalletTiming({search:'?debug=wallet-timing',output:()=>{}});
 const expiryStart=source.indexOf('  function refreshExpiredServiceQuote('),expiryEnd=source.indexOf('  function checkServiceQuote(',expiryStart);
 assert.ok(expiryStart>=0&&expiryEnd>expiryStart);
 vm.runInContext(source.slice(expiryStart,expiryEnd),f.context);
 assert.ok(f.q.serviceExpiresAt>Date.now());
 const running=f.context.executeSwap(f.q);
 try{
  await tick();assert.ok(f.events.includes('policy'));assert.equal(f.sent.length,0);
  t.mock.timers.tick(15000);
 }finally{f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();await running;}
 assert.equal(f.sent.length,0);assert.equal(f.state.quote,null);
 assert.deepEqual(f.errors,['报价已失效，请重新获取']);
 const phases=f.context.walletTiming.snapshot()[0].events.map(event=>event.phase);
 assert.ok(phases.includes('final_guard_done'));assert.ok(phases.includes('failed_UNSAFE_QUOTE'));
 assert.equal(phases.includes('failed_REQUEST_CHANGED'),false);assert.equal(phases.includes('send_invoked'),false);assert.equal(phases.at(-1),'finished');
});
test('authorization gas fallback leaves fee selection to the wallet',async()=>{
 const f=fixture();f.context.prepareGasOptions=options=>prepareGasOptions({...options,timeoutMs:5});f.receiptGate.resolve();
 try{await f.context.approve();assert.equal(f.sent.length,1);assert.equal(f.sent[0].gas,'0x186a0');assert.equal(f.sent[0].gasPrice,undefined);}
 finally{f.gasGate.resolve();}
});
test('public swap prefetch does not touch wallet provider and is reused only after completion',async()=>{
 const f=fixture();f.policyGate.resolve();f.gasGate.resolve();f.context.warmPublicSubmission?.();await tick();await tick();
 assert.equal(f.events.filter(method=>method==='policy').length,1);assert.equal(f.events.some(method=>['eth_accounts','eth_chainId','eth_getCode','eth_call','eth_sendTransaction'].includes(method)),false);
 let allowanceReads=0;f.context.refreshAllowance=async()=>{allowanceReads++;};f.receiptGate.resolve();await f.context.executeSwap(f.q);
 assert.equal(f.events.filter(method=>method==='policy').length,1,'completed pool preparation avoids a rebuild on click');assert.equal(allowanceReads,1);assert.equal(f.events.filter(method=>method==='eth_call').length,1);assert.equal(f.sent.length,1);
});
// Controller regression only: fake reads model the same state-change refusal as
// recheckFstQuote; no wallet, node, or mainnet transaction is used.
function pairTaxFixture(bps=300n){
 const f=fixture(),token='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e';
 f.q.tokenOut=token;f.q.stages[0].tokenOut=token;f.q.stages[0].branches[0].path[1]=token;
 f.q.taxProfiles=[{token,kind:'pair',pair:'0xec6abc1cbaef40878069245c2568401e56c949f1',buyBps:bps,sellBps:bps,codeHash:'7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed',blockNumber:'0x123'}];
 f.context.outT=()=>({key:'fstsi',address:token,symbol:'FSTSI',decimals:18});
 f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();return f;
}
for(const bps of [300n,0n])for(const code of ['UNSAFE_QUOTE','TAX_UNVERIFIED'])test(`a warmed pair model at ${bps} bps is rechecked and rejects ${code} on click`,async()=>{
 const f=pairTaxFixture(bps),read=f.context.recheckFstQuote;let changed=false;
 f.context.recheckFstQuote=async(...args)=>{const policy=await read(...args);if(changed)throw Object.assign(Error(code),{code});return policy;};
 f.context.warmPublicSubmission();await tick();await tick();assert.equal(f.events.filter(v=>v==='policy').length,1);
 changed=true;
 // The latest simulation still returns 120 >= the 100 minimum in this fixture.
 await f.context.executeSwap(f.q);
 assert.equal(f.events.filter(v=>v==='policy').length,2,'click must perform the fresh pair-model check');
 assert.equal(f.events.filter(v=>v==='eth_call').length,1);assert.equal(f.sent.length,0);assert.ok(f.errors.includes(code));
});
test('an unchanged pair model including zero tax is freshly checked while Gas stays prewarmed',async()=>{
 for(const bps of [300n,0n]){
  const f=pairTaxFixture(bps);f.context.warmPublicSubmission();await tick();await tick();await f.context.executeSwap(f.q);
  assert.equal(f.events.filter(v=>v==='policy').length,2);assert.equal(f.events.filter(v=>v==='eth_estimateGas').length,1);assert.equal(f.events.filter(v=>v==='eth_gasPrice').length,1);assert.equal(f.sent.length,1);assert.deepEqual(f.errors,[]);
 }
});
test('ordinary missing, empty and explicit none profiles retain the checked warm pool policy',async()=>{
 for(const profiles of [undefined,[],[{token:tokenIn,kind:'none'}]]){
  const f=fixture();if(profiles!==undefined)f.q.taxProfiles=profiles;f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();
  f.context.warmPublicSubmission();await tick();await tick();await f.context.executeSwap(f.q);
  assert.equal(f.events.filter(v=>v==='policy').length,1);assert.equal(f.sent.length,1);
 }
});
test('unrecognized tax profile shapes never qualify for warm policy reuse',async()=>{
 for(const profiles of [null,{},[null],[{kind:'other'}]]){
  const f=fixture();f.q.taxProfiles=profiles;f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();
  const read=f.context.recheckFstQuote;let invalid=false;
  f.context.recheckFstQuote=async(...args)=>{const policy=await read(...args);if(invalid)throw Object.assign(Error('TAX_UNVERIFIED'),{code:'TAX_UNVERIFIED'});return policy;};
  f.context.warmPublicSubmission();await tick();await tick();invalid=true;await f.context.executeSwap(f.q);
  assert.equal(f.events.filter(v=>v==='policy').length,2);assert.equal(f.sent.length,0);assert.ok(f.errors.includes('TAX_UNVERIFIED'));
 }
});
test('exact approval gas parameters are prepared publicly before the authorization click',async()=>{
 const f=fixture();f.state.allowance=0n;f.gasGate.resolve();f.context.warmPublicSubmission?.();await tick();await tick();
 assert.equal(f.events.filter(method=>method==='eth_estimateGas').length,1);assert.equal(f.events.includes('eth_sendTransaction'),false);
 f.receiptGate.resolve();await f.context.approve();assert.equal(f.events.filter(method=>method==='eth_estimateGas').length,1);assert.equal(f.sent.length,1);
});
test('clicking during unfinished public preparation starts a fresh path without awaiting the old job',async()=>{
 const f=fixture();f.context.warmPublicSubmission?.();await tick();const run=f.context.executeSwap(f.q);
 try{await tick();assert.ok(f.events.includes('eth_getCode'));assert.equal(f.events.filter(method=>method==='policy').length,2);}
 finally{f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();await run;}
 assert.equal(f.sent.length,1);
});
test('a completed preparation keeps its absolute deadline and exact calldata at consumption',async()=>{
 const f=fixture();f.policyGate.resolve();f.gasGate.resolve();f.context.warmPublicSubmission?.();await tick();await tick();
 const prepared=f.context.submissionWarmup.take(f.context.submissionIdentity?.(),()=>true);
 assert.ok(prepared?.transaction?.data);const parsed=new ethers.Interface(FST_ABI).parseTransaction({data:prepared.transaction.data});assert.equal(parsed.args[0].deadline,BigInt(prepared.deadline));
 assert.equal(parsed.args[0].minOut,100n);assert.equal(prepared.transaction.value,'0x0');
});
test('a failed speculative gas read is retried on click instead of caching fallback fees',async()=>{
 const f=fixture();f.policyGate.resolve();f.gasGate.resolve();let gasRequests=0;
 f.context.swapPublicRpc=()=>async payload=>{if(['eth_estimateGas','eth_gasPrice'].includes(payload.method)){gasRequests++;throw Error('temporary background failure');}return f.context.transactionRead(payload);};
 f.context.warmPublicSubmission?.();await tick();await tick();assert.equal(gasRequests,2);
 f.receiptGate.resolve();await f.context.executeSwap(f.q);assert.equal(gasRequests,4);assert.equal(f.sent.length,1);
});
test('known missing warm Gas starts fresh reads before saved canonical completes, and cannot send early',async()=>{
 const f=fixture(),canonical=deferred();let phase='warm',gasRequests=0,savedStarted=false;
 f.policyGate.resolve();f.gasGate.resolve();f.receiptGate.resolve();const read=f.context.transactionRead;
 f.context.swapPublicRpc=()=>async(payload,options)=>{
  if(['eth_estimateGas','eth_gasPrice'].includes(payload.method)){if(phase==='warm')throw Error('background Gas unavailable');gasRequests++;}
  if(phase==='click'&&payload.method==='eth_getBlockByNumber'&&payload.params[0]!=='latest'){savedStarted=true;await canonical.promise;}
  return read(payload,options);
 };
 f.context.warmPublicSubmission();await tick();await tick();phase='click';const clicking=f.context.executeSwap(f.q);
 try{await tick();assert.equal(savedStarted,true);assert.equal(gasRequests,2);assert.equal(f.sent.length,0);}
 finally{canonical.resolve();await clicking;}
 assert.equal(f.sent.length,1);assert.equal(gasRequests,2);
});
test('a cached policy still requires fresh allowance and fresh configuration on click',async()=>{
 for(const type of ['allowance','config']){
  const f=fixture();f.policyGate.resolve();f.gasGate.resolve();f.context.warmPublicSubmission?.();await tick();await tick();
  if(type==='allowance')f.context.refreshAllowance=async()=>{f.state.allowance=0n;};
  else{const original=f.context.readSwapConfig;f.context.readSwapConfig=async(...args)=>({...await original(...args),feeConfigVersion:2n});}
  f.receiptGate.resolve();await f.context.executeSwap(f.q);assert.equal(f.sent.length,0,type);
 }
});
function realPolicyFixture(f,{nearExpiry=false}={}){
 const initial=Date.now(),block={number:'0x123',hash:blockHash,timestamp:ethers.toQuantity(Math.floor(initial/1000))},updated=Math.floor(initial/1000)-(nearExpiry?179:0);
 const actualAdapter=SWAP_ADAPTERS.fst.adapter.toLowerCase(),zero=ethers.ZeroAddress;
 f.state.config.adaptersOff=['v3'];f.q.feeMode='input';f.q.stages[0].branches[0].adapter=actualAdapter;
 f.q.segments=[{from:tokenIn,to:tokenOut,amountIn:100n,minimum:100n,legs:[{adapter:actualAdapter,kind:'v2',path:[tokenIn,tokenOut],out:120n}]}];
 const codec=new ethers.Interface([...SWAP_ABI,'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
 const read=async payload=>{
  if(payload.method==='eth_getBlockByNumber')return block;
  if(payload.method==='eth_estimateGas')return'0x10000';if(payload.method==='eth_gasPrice')return'0x1';if(payload.method==='eth_chainId')return'0x38';
  const calls=codec.decodeFunctionData('tryAggregate',payload.params[0].data)[1];
  return codec.encodeFunctionResult('tryAggregate',[calls.map(call=>{
   const parsed=codec.parseTransaction({data:call.callData});let values;
   if(parsed.name==='latestRoundData')values=[1,100000000,0,updated,1];
   else if(parsed.name==='decimals')values=[8];
   else if(parsed.name==='getPairInfo'){
    const args=parsed.args,found=args[0].toLowerCase()===actualAdapter&&[args[1].toLowerCase(),args[2].toLowerCase()].sort().join(':')===[tokenIn,tokenOut].sort().join(':');
    values=[found?'0x'+'77'.repeat(20):zero,tokenIn,tokenOut,found?1000000n*10n**18n:0n,found?1000000n*10n**6n:0n,0,0];
   }else throw Error(parsed.name);
   return[true,codec.encodeFunctionResult(parsed.name,values)];
  })]);
 };
 f.context.swapPublicRpc=()=>read;f.context.transactionRead=read;f.context.recheckFstQuote=recheckFstQuote;
}
test('the real FstSwap policy wrapper without checkedAt is consumable',async()=>{
 const f=fixture();realPolicyFixture(f);f.context.warmPublicSubmission();await tick();await tick();
 const value=f.context.submissionWarmup.take(f.context.submissionIdentity(),()=>true);assert.ok(value?.policy);assert.equal(Object.hasOwn(value.policy,'checkedAt'),false);value.policy.assertFresh();
});
test('an expired real oracle rejects warmed policy even inside the two-second completion TTL',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const f=fixture();realPolicyFixture(f,{nearExpiry:true});f.context.warmPublicSubmission();await tick();await tick();
 const completed=f.context.submissionWarmup.take(f.context.submissionIdentity(),()=>true);assert.ok(completed?.policy);f.context.warmPublicSubmission();await tick();await tick();
 t.mock.timers.tick(1100);assert.equal(f.context.takeSubmissionWarm?.('swap'),null);f.receiptGate.resolve();await f.context.executeSwap(f.q);assert.equal(f.sent.length,0);
});
function installBalanceScheduling(f,readBalances){
 Object.assign(f.context,{createIdleRead,previewController:null,page:{inKey:'usdt',outKey:'fist'},ORDER:['usdt','fist','other'],TOKENS:{usdt:{key:'usdt',address:tokenIn},fist:{key:'fist',address:tokenOut},other:{key:'other',address:router}},balanceRequests:new Map(),balanceRequestId:0,balanceRequest:f.context.transactionRead,readWalletBalances:readBalances});
 Object.assign(f.state,{balanceEpoch:0,balances:{},balanceErrors:{},seq:0});f.context.quoteFlow.running=()=>false;f.context.quoteFlow.schedule=()=>{};
 const load=source.slice(source.indexOf('  let balanceRequestId ='),source.indexOf('  async function loadAllBalances('));
 const idle=source.slice(source.indexOf('  const otherBalances = createIdleRead('),source.indexOf('  function resumeIdleReads()'));
 const schedule=source.slice(source.indexOf('  function scheduleQuote('),source.indexOf('  function onAmountInput('));
 vm.runInContext(load+idle+schedule,f.context);return vm.runInContext('otherBalances',f.context);
}
test('real balance and idle controllers give pair balances priority and defer other holdings during warm',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),pairGate=deferred(),reads=[];
 const idle=installBalanceScheduling(f,async(_request,_account,tokens)=>{reads.push(Array.from(tokens,token=>token.key));if(tokens.some(token=>token.key==='usdt'))await pairGate.promise;return{balances:Object.fromEntries(tokens.map(token=>[token.key,1n])),failed:[]};});
 t.after(()=>{f.context.cancelSubmissionWarm();idle.dispose();pairGate.resolve();f.policyGate.resolve();f.gasGate.resolve();});
 const pair=f.context.loadBalances(['usdt','fist']);f.context.queueSubmissionWarm();t.mock.timers.tick(0);await tick();assert.equal(f.events.includes('policy'),false);
 pairGate.resolve();await pair;t.mock.timers.tick(0);await tick();assert.equal(f.context.submissionWarmup.pending(),true);idle.schedule();t.mock.timers.tick(300);await tick();assert.deepEqual(reads,[['usdt','fist']]);
 f.policyGate.resolve();f.gasGate.resolve();await tick();await tick();t.mock.timers.tick(300);await tick();assert.deepEqual(reads,[['usdt','fist'],['other']]);assert.ok(f.context.takeSubmissionWarm('swap'));
});
test('failed public warm allows other holdings to continue without a retry loop',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();let policies=0,holdings=0;
 f.context.recheckFstQuote=async()=>{policies++;throw Error('public unavailable');};f.gasGate.resolve();
 const idle=installBalanceScheduling(f,async(_request,_account,tokens)=>{holdings++;return{balances:Object.fromEntries(tokens.map(token=>[token.key,1n])),failed:[]};});
 t.after(()=>{f.context.cancelSubmissionWarm();idle.dispose();});
 f.context.queueSubmissionWarm();t.mock.timers.tick(0);await tick();await tick();assert.equal(f.context.submissionWarmup.pending(),false);
 t.mock.timers.tick(300);await tick();assert.equal(holdings,1);t.mock.timers.tick(0);await tick();assert.equal(policies,1,'finishing unrelated holdings must not requeue a failed warm');
});
test('the real input scheduling path cancels an active public warm without wallet requests',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();let signal;const original=f.context.createSubmissionReadContext;
 f.context.createSubmissionReadContext=(request,options)=>{signal=options.signal;return original(request,options);};
 const idle=installBalanceScheduling(f,async()=>({balances:{},failed:[]}));t.after(()=>{f.context.cancelSubmissionWarm();idle.dispose();f.policyGate.resolve();f.gasGate.resolve();});
 f.context.queueSubmissionWarm();t.mock.timers.tick(0);await tick();assert.equal(signal.aborted,false);f.context.scheduleQuote(0);assert.equal(signal.aborted,true);assert.equal(f.events.filter(x=>x==='cancelNativeMax').length,1);assert.equal(f.events.some(method=>['eth_call','eth_getCode','eth_sendTransaction'].includes(method)),false);
});
test('local and v10 swap routes do not reuse speculative policies',async()=>{
 for(const type of ['local','v10']){const f=fixture();if(type==='local')delete f.q.serviceMeta;else f.q.kind='v10';assert.equal(f.context.warmPublicSubmission(),false);await tick();assert.equal(f.events.length,0);}
});
test('a saved-block canonical mismatch rebuilds policy and gas on the existing click path',async()=>{
 const f=fixture();f.policyGate.resolve();f.gasGate.resolve();f.context.warmPublicSubmission();await tick();await tick();
 const original=f.context.transactionRead;f.context.swapPublicRpc=()=>async payload=>payload.method==='eth_getBlockByNumber'&&payload.params[0]!=='latest'?{number:'0x123',hash:'0x'+'ff'.repeat(32)}:original(payload);
 f.receiptGate.resolve();await f.context.executeSwap(f.q);assert.equal(f.events.filter(method=>method==='policy').length,2);assert.equal(f.events.filter(method=>method==='eth_estimateGas').length,2);assert.equal(f.sent.length,1);
});
test('in-place quote mutation after a warm hit fails the final intent binding',async()=>{
 const f=fixture(),guardGate=deferred(),original=f.wallet.provider.request;
 f.wallet.provider.request=async payload=>{if(payload.method==='eth_getCode')await guardGate.promise;return original(payload);};
 f.policyGate.resolve();f.gasGate.resolve();f.context.warmPublicSubmission();await tick();await tick();const running=f.context.executeSwap(f.q);await tick();
 f.q.stages[0].branches[0].path[1]=router;guardGate.resolve();f.receiptGate.resolve();await running;assert.equal(f.sent.length,0);
});
