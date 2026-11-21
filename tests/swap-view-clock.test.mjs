import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ethers} from 'ethers';
import {createServiceClock} from '../src/swap-service-clock.mjs';
import {validateServiceQuote} from '../src/swap-service-client.mjs';
import {createSubmissionWarmup} from '../src/swap-submission-warmup.mjs';
import {quoteFieldState,balanceFieldState} from '../src/swap-display.mjs';

const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const clockHelpers=[...source.matchAll(/^function (?:quoteNow|warmNow)\([^\n]+$/gm)].map(match=>match[0]).join('\n');
const expired=extract('  function refreshExpiredServiceQuote(', '  function checkServiceQuote(');
const inputError=extract('  function inputError()', '  function needsApproval()');
const serviceCheck=extract('  function checkServiceQuote(', '  async function handleSwapClick(');
const preview=extract('  let previewController =', '  // —— 报价');
const presented=extract('  function presentedQuote()', '  function renderPanels()');
const trade=extract('  function renderTrade()', '  function priceText(');
const U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',R='0x'+'33'.repeat(20),A='0x'+'44'.repeat(20);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let wall=10000,mono=1000;
 const time=createServiceClock({clock:()=>wall,monotonic:()=>mono}),ticket=time.start(6500);mono+=100;
 time.publish(time.measure(new Headers({'x-fstswap-time-nonce':ticket.nonce,'x-fstswap-server-time':'14240'}),ticket));
 const config={version:'1.11',platformFeeBps:30,feeReceiver:U,wbnb:F,defaultFeeToken:U,feeConfigVersion:1n,adaptersOff:[]};
 const q={kind:'v10',method:'swapTokenToToken',first:{adapter:A,path:[U,F]},amountIn:1000000000000000001n,out:5n,lpFee:3000000000000000n,feeToken:U,impact:0,poolCheckedAt:14240};
 const meta={schema:1,chainId:56,router:R,input:{chainId:56,tokenIn:U,tokenOut:F,amountIn:String(q.amountIn),slippageBps:0,singleHop:false},config,
  blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),quotedAt:14240,expiresAt:29240};
 q.serviceMeta=meta;q.serviceExpiresAt=meta.expiresAt;
 const state={quote:q,amount:'1.000000000000000001',quoteError:'',balances:{},balanceErrors:{},balancePending:{},config},timers=[],paint=[],events=[];
 const DateMock=class extends Date{static now(){return wall;}};
 const context={Date:DateMock,Promise,AbortController,DOMException,BigInt,Object,Math,Number,JSON,ethers,state,quoteFieldState,balanceFieldState,
  settings:{slippageBps:0,singleHop:false,deadlineMinutes:30},SWAP_V10_MISSING:{code:'missing'},SWAP_ADAPTERS:{fst:{adapter:A}},ZERO:ethers.ZeroAddress,
  swapActiveRouter:()=>R,swapUnits:ethers.parseUnits,validateServiceQuote,
  inT:()=>({key:'usdt',address:U,symbol:'USDT',decimals:18}),outT:()=>({key:'fist',address:F,symbol:'FIST',decimals:6}),page:{inKey:'usdt',outKey:'fist'},
  tr:(_zh,en)=>en,T:text=>text,render:()=>events.push('render'),scheduleQuote:ms=>events.push(ms),closeModal:()=>events.push('close'),
  swapService:{now:()=>time.now(),timeBounds:()=>time.bounds(),available:()=>true,quote:async()=>({...meta,quote:{...q}})},
  document:{hidden:false},navigator:{onLine:true},main:{isConnected:true},previewController:null,previewExpiryTimer:null,
  stopPairPrice(){context.previewController=null;state.preview=null;},renderTrade:()=>{},
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},
  card:{querySelector:()=>null},tradeRow:{replaceWith:()=>{}},priceText:()=>'',detailsEl:()=>({}),
  part(key){paint.push(key);return{querySelector:()=>({querySelector:()=>({}),addEventListener(){}}),replaceWith(){},after(){}};},
  createSubmissionWarmup:options=>createSubmissionWarmup({clock:()=>wall,...options}),
 };
 vm.createContext(context);vm.runInContext(clockHelpers+'\n'+presented+expired+inputError+serviceCheck,context);
 return{context,state,q,time,timers,paint,events,setWall:value=>{wall=value;},advance:ms=>{mono+=ms;wall+=ms;},get wall(){return wall;}};
}

test('the real quote expiry and input guard use 15s service time despite a backward device-clock jump',()=>{
 const f=fixture();assert.equal(f.context.refreshExpiredServiceQuote(f.q),false);assert.equal(f.context.inputError(),'');
 f.setWall(f.wall-3600000);f.advance(14900);
 assert.equal(f.context.inputError(),'Refreshing quote…');
 assert.equal(f.context.refreshExpiredServiceQuote(f.q),true);assert.equal(f.state.quote,null);assert.deepEqual(f.events,['render',0,'close']);
});

test('service calibration does not change the expiry domain of a local fallback quote',()=>{
 const f=fixture(),local={...f.q,serviceMeta:undefined,serviceExpiresAt:f.wall+100};f.state.quote=local;
 assert.equal(f.context.refreshExpiredServiceQuote(local),false,'server time is already past this local deadline but must not be applied');
 f.advance(100);assert.equal(f.context.refreshExpiredServiceQuote(local),true);
});

test('the real pre-send service validator accepts a current quote after either wall-clock jump but still rejects original expiry and future metadata',()=>{
 for(const jump of [-3600000,3600000]){
  const f=fixture();f.setWall(f.wall+jump);assert.doesNotThrow(()=>f.context.checkServiceQuote(f.q));
  f.advance(14900);assert.throws(()=>f.context.checkServiceQuote(f.q),{code:'UNSAFE_QUOTE'});
 }
 const f=fixture();f.q.serviceMeta.quotedAt=f.time.bounds().lower+2001;assert.throws(()=>f.context.checkServiceQuote(f.q),{code:'UNSAFE_QUOTE'});
});

test('the real preview timer uses conservative service lifetime and marks its time domain for render/reuse',async()=>{
 const f=fixture();f.state.amount='';f.state.quote=null;vm.runInContext(preview,f.context);
 await f.context.refreshPairPrice();assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,14900);
 assert.ok(f.state.preview.serviceMeta,'the preview must retain its remote time-domain marker');
 const saved=f.state.preview;f.setWall(f.wall+3600000);await f.context.refreshPairPrice({reuse:true});assert.equal(f.state.preview,saved);assert.equal(f.timers.length,1);
});

test('the real preview renderer cannot keep an expired unit price visible after a backward wall-clock jump',()=>{
 const f=fixture();f.state.amount='';f.state.preview=f.q;f.state.quote=null;f.setWall(f.wall-3600000);f.advance(14900);
 vm.runInContext(trade+'\nrenderTrade();',f.context);assert.deepEqual(f.paint,['swap_empty']);
});

test('the real page warmup construction uses the quote domain so a wall jump neither loses a valid remote slot nor extends its 2s cache',async()=>{
 const declaration=source.match(/^\s*const submissionWarmup=createSubmissionWarmup\([^\n]+$/m)[0].trim().replace(/^const /,'var ');
 for(const jump of [-3600000,3600000]){
  const f=fixture();vm.runInContext(declaration,f.context);
  const identity={quote:f.q,provider:{},providerRequest(){},key:'same',expiresAt:f.q.serviceExpiresAt};
  assert.equal(f.context.submissionWarmup.start(identity,async()=>({expiresAt:identity.expiresAt})),true);await tick();
  f.setWall(f.wall+jump);assert.ok(f.context.submissionWarmup.take(identity,()=>true));
  f.context.submissionWarmup.start(identity,async()=>({expiresAt:identity.expiresAt}));await tick();f.advance(2000);
  assert.equal(f.context.submissionWarmup.take(identity,()=>true),null);
 }
});
