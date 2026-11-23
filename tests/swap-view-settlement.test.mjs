import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('  async function showApprovalIfNeeded('),source.indexOf('  // 每次进入兑换页'));
const formatter=source.slice(source.indexOf('export function sigDown('),source.indexOf('/// 官方 Price.toSignificant')).replace('export ','');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const account='0x'+'11'.repeat(20),input='0x'+'22'.repeat(20),output='0x'+'33'.repeat(20),router='0x'+'44'.repeat(20),hash='0x'+'55'.repeat(32);

// Execute the real controller; only wallet/network and rendering boundaries are
// in memory. In particular, a returned hash and a verified receipt are separate.
function fixture(){
 const walletGate=deferred(),receiptGate=deferred(),verificationGate=deferred(),walletStarted=deferred();
 const q={kind:'agg',amountIn:100n,out:120n,route:{side:'buy'},feeToken:input,lpFee:0n};
 const state={quote:q,amount:'100',allowance:100n},settings={slippageBps:50,deadlineMinutes:20,singleHop:false};
 const tokens={in:{key:'usdt',address:input,symbol:'USDT',decimals:18},out:{key:'fist',address:output,symbol:'FIST',decimals:6}};
 const wallet={account,provider:{request:()=>{throw Error('No live wallet requests in this fixture');}}};
 const events={popups:[],history:[],submitted:[],errors:[],busy:[],verified:[],refresh:0,nativeRefresh:0},main={isConnected:true};
 let overlay=null,leased=false;
 const context={state,settings,wallet,main,AbortController,Date,
  inT:()=>tokens.in,outT:()=>tokens.out,minOut:()=>100n,quoteNow:()=>Date.now(),
  walletTiming:{begin:()=>undefined},walletTimingFailure:()=>{},submissionWarmup:{pending:()=>false},takeSubmissionWarm:()=>null,
  submissionIdentity:()=>({key:JSON.stringify([wallet.account,state.amount,tokens.in.address,tokens.out.address,settings])}),
  swapSummary:()=>['100','USDT','120','FIST'],side:()=> 'buy',tr:zh=>zh,T:zh=>zh,
  pendingModal:()=>{const owned={kind:'pending'};overlay=owned;return{isCurrent:()=>overlay===owned,dismiss:()=>{if(overlay===owned)overlay=null;}};},
  submittedModal:(...args)=>{events.submitted.push(args);overlay={kind:'submitted'};},
  closeModal:()=>{overlay=null;},errorModal:message=>{events.errors.push(message);overlay={kind:'error'};},
  refreshExpiredServiceQuote:()=>false,checkServiceQuote:()=>{},assertQuoteSafety:()=>{},
  quoteFlow:{pause(){}},otherBalances:{pause(){}},stopPairPrice:()=>{},
  swapRpcWork:{enterForeground:()=>{leased=true;return()=>{leased=false;};}},
  activeWalletController:null,activeSubmissionContext:null,refreshAllowance:async()=>{},needsApproval:()=>false,
  recheckSwapQuote:async()=>({policy:{assert(){},assertValue(){},assertFresh(){}}}),readSwapConfig:()=>{},readPoolPolicy:()=>{},transactionRead:()=>{},
  preflightSwap:async()=>({transaction:{from:account,to:router,data:'0x1234',value:'0x0'},simulated:120n,gasLimit:1n,gasPrice:1n}),
  sendTx:async(transaction,_limit,_price,beforeSubmit)=>{assert.equal(beforeSubmit(),true);walletStarted.resolve();await walletGate.promise;return{hash,transaction};},
  saveHistory:value=>events.history.push(value),popup:value=>events.popups.push(value),
  render:()=>{},renderBottom:()=>events.busy.push(Boolean(state.transactionBusy)),scheduleQuote:()=>{},
  createReceiptReadScope:()=>({read:()=>{},dispose(){}}),waitReceipt:()=>receiptGate.promise,swapV10Ready:()=>true,
  readV10Receipt:async(_read,_hash,options)=>{events.verified.push(options);return verificationGate.promise;},
  refreshBalances:async()=>{events.refresh++;},refreshNativeBalance:()=>{events.nativeRefresh++;},
 };
 vm.createContext(context);vm.runInContext(formatter+controller,context);
 return{context,state,settings,wallet,main,tokens,q,events,walletGate,receiptGate,verificationGate,walletStarted,
  execute:()=>context.executeSwap(q),getOverlay:()=>overlay,replaceOverlay:()=>{overlay={kind:'new'};},leased:()=>leased};
}

test('a transaction hash shows submitted feedback while green success and balances wait for verified settlement',async()=>{
 const f=fixture(),running=f.execute();await f.walletStarted.promise;
 assert.deepEqual(f.events.busy,[true]);
 f.walletGate.resolve();await running;
 assert.equal(f.events.submitted.length,1);assert.equal(f.events.history.length,1);assert.equal(f.state.amount,'');
 assert.equal(f.events.popups.length,0,'a hash alone is not a confirmed transaction');assert.equal(f.events.refresh,0);
 f.receiptGate.resolve();await tick();assert.equal(f.events.verified.length,1);assert.equal(f.events.popups.length,0);assert.equal(f.events.refresh,0);
 f.verificationGate.resolve({amountOut:145n});await tick();
 assert.equal(f.events.popups.length,1);assert.equal(f.events.popups[0].success,true);assert.equal(f.events.popups[0].hash,hash);
 assert.equal(f.events.popups[0].summary,'Swap 100 USDT for 0.000145 FIST');
 assert.equal(f.events.refresh,1);assert.equal(f.events.nativeRefresh,1);assert.equal(f.events.busy.at(-1),false);assert.equal(f.leased(),false);
});

test('a failed receipt verification reports failure without an earlier success or balance refresh',async()=>{
 const f=fixture(),running=f.execute();await f.walletStarted.promise;f.walletGate.resolve();await running;
 f.receiptGate.resolve();await tick();f.verificationGate.reject(Error('Settlement does not match'));await tick();
 assert.equal(f.events.popups.length,1);assert.equal(f.events.popups[0].success,false);assert.match(f.events.popups[0].summary,/Settlement does not match/);
 assert.equal(f.events.refresh,0);assert.equal(f.events.nativeRefresh,0);
});

test('a display refresh failure cannot relabel an already verified settlement as failed',async()=>{
 const f=fixture();f.context.refreshBalances=async()=>{throw Error('Balance RPC unavailable');};
 const running=f.execute();await f.walletStarted.promise;f.walletGate.resolve();await running;
 f.receiptGate.resolve();f.verificationGate.resolve({amountOut:145n});await tick();
 assert.equal(f.events.popups.length,1);assert.equal(f.events.popups[0].success,true);assert.equal(f.events.nativeRefresh,1);
});

test('the retained legacy receipt verifier supplies the confirmed received amount too',async()=>{
 const f=fixture();f.context.swapV10Ready=()=>false;f.context.readSwapReceipt=f.context.readV10Receipt;
 const running=f.execute();await f.walletStarted.promise;f.walletGate.resolve();await running;
 f.receiptGate.resolve();f.verificationGate.resolve({amountOut:150n});await tick();
 assert.equal(f.events.popups.length,1);assert.equal(f.events.popups[0].success,true);
 assert.equal(f.events.popups[0].summary,'Swap 100 USDT for 0.00015 FIST');
});

for(const [label,change]of[
 ['amount',f=>{f.state.amount='250';}],
 ['account',f=>{f.wallet.account='0x'+'66'.repeat(20);}],
 ['provider',f=>{f.wallet.provider={request:()=>{throw Error('New wallet must remain untouched');}};}],
 ['pair',f=>{f.tokens.out={...f.tokens.out,address:'0x'+'77'.repeat(20),symbol:'OTHER'};}],
 ['page',f=>{f.main.isConnected=false;}],
])test(`a hash returning after the ${label} changes cannot clear the new form or replace its modal`,async()=>{
 const f=fixture(),running=f.execute();await f.walletStarted.promise;change(f);f.replaceOverlay();
 const amount=f.state.amount;f.walletGate.resolve();await running;
 assert.equal(f.state.amount,amount);assert.equal(f.events.submitted.length,0);assert.equal(f.getOverlay().kind,'new');assert.equal(f.events.history.length,1);
 f.receiptGate.resolve();f.verificationGate.resolve({amountOut:145n});await tick();
 assert.equal(f.events.verified.length,1,'the original transaction still receives background verification');
 assert.equal(f.events.verified[0].account,account);assert.equal(f.events.verified[0].tokenOut,output);assert.equal(f.events.verified[0].minOut,100n);
 assert.equal(f.events.popups.length,1);assert.equal(f.events.popups[0].success,true);assert.equal(f.events.popups[0].summary,'Swap 100 USDT for 0.000145 FIST');
 if(['account','provider','page'].includes(label)){assert.equal(f.events.refresh,0);assert.equal(f.events.nativeRefresh,0);}
});

test('a late wallet rejection does not replace an overlay opened for the changed input',async()=>{
 const f=fixture(),running=f.execute();await f.walletStarted.promise;
 f.state.amount='250';f.replaceOverlay();f.walletGate.reject(Object.assign(Error('Rejected'),{code:4001}));await running;
 assert.equal(f.state.amount,'250');assert.equal(f.getOverlay().kind,'new');assert.deepEqual(f.events.errors,[]);assert.equal(f.events.history.length,0);
 assert.equal(f.events.busy.at(-1),false);assert.equal(f.leased(),false);
});

test('an overlay opened during the error allowance refresh is still owned by its new interaction',async()=>{
 const f=fixture(),catchStarted=deferred(),allowanceGate=deferred();let reads=0;
 f.context.refreshAllowance=async()=>{if(++reads===2){catchStarted.resolve();await allowanceGate.promise;}};
 const running=f.execute();await f.walletStarted.promise;f.walletGate.reject(Error('Wallet request failed'));
 await catchStarted.promise;f.replaceOverlay();allowanceGate.resolve();await running;
 assert.equal(f.getOverlay().kind,'new');assert.deepEqual(f.events.errors,[]);assert.equal(f.state.amount,'100');
});

test('opening a newer overlay while payment is pending prevents submitted feedback from replacing it',async()=>{
 const f=fixture(),running=f.execute();await f.walletStarted.promise;f.replaceOverlay();f.walletGate.resolve();await running;
 assert.equal(f.events.submitted.length,0);assert.equal(f.getOverlay().kind,'new');assert.equal(f.state.amount,'');
 f.receiptGate.resolve();f.verificationGate.resolve();await tick();
});

function modalFixture(){
 const timers=[],requests=[],token={key:'fist',address:output,symbol:'FIST',decimals:6};let current;
 const provider={request:async payload=>requests.push(payload)},wallet={provider};
 const context={Promise,wallet,outT:()=>token,tr:zh=>zh,
  tpl:()=>{
   const label={firstChild:{nodeValue:''}},add={querySelector:()=>label,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},remove(){this.removed=true;}};
   const overlay={isConnected:false,add,label,link:{},text:{},querySelector:selector=>selector==='button.gbLYuj'?add:selector.includes('/tx/')?overlay.link:selector==='.css-hzsvkq'?overlay.text:null,querySelectorAll:()=>[]};return overlay;
  },
  openModal:overlay=>{if(current)current.isConnected=false;current=overlay;current.isConnected=true;},
  closeModal:()=>{if(current)current.isConnected=false;current=null;},
  setTimeout:fn=>{timers.push(fn);return timers.length;},
 };
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function pendingModal('),source.indexOf('  function errorModal(')),context);
 return{context,timers,requests,token,provider,wallet,current:()=>current};
}

test('pending dismissal and submitted auto-close cannot close a newer modal',()=>{
 const f=modalFixture(),pending=f.context.pendingModal('Awaiting wallet');assert.equal(pending.isCurrent(),true);
 f.context.submittedModal(hash);const submitted=f.current();pending.dismiss();assert.equal(f.current(),submitted);
 f.context.pendingModal('New operation');const latest=f.current();f.timers[0]();assert.equal(f.current(),latest);
});

test('the submitted add-token action keeps the receiving token and provider captured when shown',async()=>{
 const f=modalFixture();f.context.submittedModal(hash,{token:f.token,provider:f.provider});const submitted=f.current();
 f.token.address=input;f.token.symbol='OTHER';f.token.decimals=18;
 f.wallet.provider={request:async()=>assert.fail('must not use a replacement provider')};
 submitted.add.listeners.click();await tick();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'wallet_watchAsset');
 assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].params.options)),{address:output,symbol:'FIST',decimals:6});
});
