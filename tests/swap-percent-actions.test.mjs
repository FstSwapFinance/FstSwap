// Native browser DOM for the actual Swap panel, renderPanels and percentage
// handler. Source-only fixture: no application build, network or real wallet.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {TPL} from '../src/swap-official-tpl.mjs';
import * as amount from '../src/swap-amount.mjs';
import {quoteFieldState,balanceFieldState} from '../src/swap-display.mjs';

const source=await readFile(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const panelCode=extract('  function panel(', '  function formatBalance(');
const presentedCode=extract('  function presentedQuote()', '  function renderPanels()');
const panelsCode=extract('  function renderPanels()', '  // —— 价格行');
const handlerCode=extract('  function setBalanceFraction(', '  const missing =');
const applyCode=extract('  function applyBalanceAmount(', '  function cancelNativeMax(');
const cancelCode=extract('  function cancelNativeMax(', '  async function readNativeMaxTransaction(');
const nativeHandlerCode=extract('  async function setNativeBalanceFraction(', '  function setBalanceFraction(');
const nativeSource=await readFile(new URL('../src/swap-native-max.mjs',import.meta.url),'utf8');
const vendor=await readFile(new URL('../assets/vendor/ethers-6.15.0-fst.min.js',import.meta.url),'utf8');
const css=(await readFile(new URL('../src/swap-official.css',import.meta.url),'utf8'))+'\n'+await readFile(new URL('../src/swap-ui.css',import.meta.url),'utf8');
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,{input='usdt',balance='123456789123456789123',connected=true,error=false,width=430,gasFailure=false,estimateFailure=false,deferEstimate=false}={}){
 const page=await browser.newPage({viewport:{width,height:900}});t.after(()=>page.close());
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent(TPL.swap_quoted);await page.addStyleTag({content:css});await page.addScriptTag({content:vendor});
 await page.evaluate(({template,input,balance,connected,error,panelCode,panelsCode,handlerCode,applyCode,cancelCode,nativeHandlerCode,nativeSource,gasFailure,estimateFailure,deferEstimate,amountFunctions,displayFunctions,presentedCode})=>{
  const TOKENS={usdt:{key:'usdt',symbol:'USDT',decimals:18,address:'0x'+'11'.repeat(20)},fist:{key:'fist',symbol:'FIST',decimals:6,address:'0x'+'22'.repeat(20)},bnb:{key:'bnb',symbol:'BNB',decimals:18,address:null}};
  const page={inKey:input,outKey:input==='fist'?'usdt':'fist'};
  const state={amount:'',quote:null,quoteError:'NO_ROUTE',quoteErrorReason:'old',refocus:false,nativeMaxBusy:false,seq:0,balanceEpoch:0,transactionBusy:false,balancePending:{},balances:{[input]:balance==null?null:BigInt(balance)},balanceErrors:{[input]:error}};
  let walletCalls=0,pickerCalls=0,stops=0,renders=0,selectedTokenSignature;
  let nativeMaxJob=null,quoteExpiryTimer=null,quotePauses=0;
  const quoteFlow={pause(){quotePauses++;}},otherBalances={pause(){},schedule(){}};
  const settings={slippageBps:50,singleHop:false,deadlineMinutes:30};
  const wallet={chainId:56,account:connected?'0x'+'aa'.repeat(20):null,provider:{request(){walletCalls++;throw Error('No wallet request is allowed in this read-only fixture');}}};
  const main=document.querySelector('main');main.classList.add('fst-swap-card');
  const panelsCol=document.querySelector('#swap-page').firstElementChild.firstElementChild;
  const inT=()=>TOKENS[page.inKey],outT=()=>TOKENS[page.outKey],selectedTokenIdentity=()=>page.inKey+':'+page.outKey;
  const tr=(_zh,en)=>en,formatBalance=(value,token)=>ethers.formatUnits(value,token.decimals),swapFormatUnits=ethers.formatUnits;
  const part=(name,selector)=>{const el=document.createElement('template');el.innerHTML=template[name];return el.content.querySelector(selector)?.cloneNode(true);};
  const applyTokenLogo=()=>{},openTokenModal=()=>{pickerCalls++;},onAmountInput=()=>{},flip=()=>{};
  const stopPairPrice=()=>{stops++;},scheduled=[],rpcCalls=[],built=[],popups=[];
  let releaseEstimate;const estimateGate=new Promise(resolve=>releaseEstimate=resolve);
  const transactionRead=async payload=>{rpcCalls.push(payload.method);if(payload.method==='eth_gasPrice'){if(gasFailure)throw Error('Gas price unavailable');return '0x2faf080';}if(payload.method==='eth_estimateGas'){if(deferEstimate)await estimateGate;if(estimateFailure)throw Error('Gas estimate unavailable');return '0x249f0';}if(payload.method==='eth_getBalance')return '0x'+state.balances[page.inKey].toString(16);throw Error('Unexpected public RPC '+payload.method);};
  const readNativeMaxTransaction=async amount=>{built.push(amount.toString());return{from:wallet.account,to:'0x'+'33'.repeat(20),value:'0x'+amount.toString(16),data:'0x1234'};};
  const popup=options=>popups.push(options),cancelSubmissionWarm=()=>{},renderBottom=()=>{},renderTrade=()=>{},refreshPairPrice=async()=>{};
  const scheduleQuote=delay=>scheduled.push(delay);
  const limitAmountDecimals=eval('('+amountFunctions.limitAmountDecimals+')');
  const formatPaymentInput=eval('('+amountFunctions.formatPaymentInput+')');
  const formatAmountInput=eval('('+amountFunctions.formatAmountInput+')');
  const balanceFraction=eval('('+amountFunctions.balanceFraction+')');
  const quoteFieldState=eval('('+displayFunctions.quoteFieldState+')'),balanceFieldState=eval('('+displayFunctions.balanceFieldState+')');
  const swapUnits=ethers.parseUnits,quoteNow=()=>Date.now();
  const presentedQuote=eval('('+presentedCode+')');
  const nativeBalanceFraction=eval('(()=>{'+nativeSource.replace(/^import[^\n]*\n/,'').replace('export async function','async function')+';return nativeBalanceFraction;})()');
  let panel,renderPanels,setBalanceFraction,setNativeBalanceFraction,applyBalanceAmount,cancelNativeMax;
  const render=()=>{renders++;renderPanels();};
  panel=eval('('+panelCode+')');renderPanels=eval('('+panelsCode+')');applyBalanceAmount=eval('('+applyCode+')');cancelNativeMax=eval('('+cancelCode+')');setBalanceFraction=eval('('+handlerCode+')');if(nativeHandlerCode.trim())setNativeBalanceFraction=eval('('+nativeHandlerCode+')');
  renderPanels();
  let oldAction;
  window.__swapPercent={
   state:()=>({amount:state.amount,quote:state.quote,quoteError:state.quoteError,quoteErrorReason:state.quoteErrorReason,scheduled:[...scheduled],stops,renders,walletCalls,pickerCalls,busy:state.nativeMaxBusy,quotePauses,rpcCalls:[...rpcCalls],built:[...built],popups:[...popups],display:main.querySelector('#swap-currency-input input').value,output:main.querySelector('#swap-currency-output input').value}),
   setAccount:value=>wallet.account=value,setToken:key=>page.inKey=key,
   setAmount:value=>state.amount=value,setProvider:()=>wallet.provider={request:wallet.provider.request},setChain:value=>wallet.chainId=value,releaseEstimate:()=>releaseEstimate(),setSettings:()=>settings.slippageBps=100,
   disconnectMain:()=>main.remove(),
   setBalance:value=>state.balances[page.inKey]=value==null?null:BigInt(value),
   setError:value=>state.balanceErrors[page.inKey]=value,
   render:renderPanels,
   capture:percent=>oldAction=main.querySelector('#swap-currency-input [data-percent="'+percent+'"]'),
   invokeOld:()=>oldAction.click(),
  };
 },{template:TPL,input,balance,connected,error,panelCode,panelsCode,handlerCode,applyCode,cancelCode,nativeHandlerCode,nativeSource,gasFailure,estimateFailure,deferEstimate,amountFunctions:Object.fromEntries(['formatAmountInput','formatPaymentInput','limitAmountDecimals','balanceFraction'].map(key=>[key,amount[key].toString()])),displayFunctions:{quoteFieldState:quoteFieldState.toString(),balanceFieldState:balanceFieldState.toString()},presentedCode});
 t.after(()=>assert.deepEqual(pageErrors,[],'native panel fixture has no JavaScript errors'));
 return page;
}
const action=(page,percent)=>page.locator('#swap-currency-input .fst-balance-actions [data-percent="'+percent+'"]');
const actions=page=>page.locator('#swap-currency-input .fst-balance-actions button');
const snapshot=page=>page.evaluate(()=>window.__swapPercent.state());

test('Swap exposes four semantic shortcuts only on the paying panel',async t=>{
 const page=await fixture(t);
 assert.deepEqual(await actions(page).allTextContents(),['25%','50%','75%','Max']);
 assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>({type:n.type,percent:n.dataset.percent,label:n.getAttribute('aria-label')}))),[25,50,75,100].map(percent=>({type:'button',percent:String(percent),label:percent+'% available balance USDT'})));
 assert.equal(await page.locator('#swap-currency-input .fst-balance-actions').getAttribute('role'),'group');
 assert.equal(await page.locator('#swap-currency-output .fst-balance-actions').count(),0);
 assert.equal(await page.locator('#swap-currency-output input').evaluate(n=>n.readOnly),true);
 const before=(await snapshot(page)).output;await page.locator('#swap-currency-output input').press('7');assert.equal((await snapshot(page)).output,before);
});
test('Swap percentages preserve full wei while showing four decimal places and scheduling once',async t=>{
 const expected=[[25,'30.86419728086419728','30.8641'],[50,'61.728394561728394561','61.7283'],[75,'92.592591842592591842','92.5925'],[100,'123.456789123456789123','123.4567']];
 for(const[percent,full,display]of expected){
  const page=await fixture(t);await action(page,percent).click();const s=await snapshot(page);
  assert.equal(s.amount,full);assert.equal(s.display,display);assert.deepEqual(s.scheduled,[0]);assert.equal(s.stops,1);assert.equal(s.renders,1);
  assert.equal(s.quote,null);assert.equal(s.quoteError,'');assert.equal(s.quoteErrorReason,'');assert.equal(s.walletCalls,0);assert.equal(s.pickerCalls,0);
 }
});
test('a six-decimal token uses its own precision without losing Max remainder',async t=>{
 const expected=[[25,'12.302219','12.3022'],[50,'24.604439','24.6044'],[75,'36.906658','36.9066'],[100,'49.208878','49.2088']];
 for(const[percent,full,display]of expected){
  const page=await fixture(t,{input:'fist',balance:'49208878'});await action(page,percent).click();const s=await snapshot(page);
  assert.equal(s.amount,full);assert.equal(s.display,display);assert.deepEqual(s.scheduled,[0]);assert.equal(s.walletCalls,0);
 }
});
test('a positive Max smaller than four displayed decimals never looks like a zero payment',async t=>{
 const page=await fixture(t,{input:'fist',balance:'9'});
 await action(page,100).click();
 const input=page.locator('#swap-currency-input input');
 assert.equal((await snapshot(page)).amount,'0.000009');
 assert.equal(await input.inputValue(),'0.000009');
 assert.equal(await input.getAttribute('title'),'0.000009');
});
test('a panel refresh keeps the cursor and selection within the payment amount',async t=>{
 const page=await fixture(t);
 await page.evaluate(()=>{
  window.__swapPercent.setAmount('12.3456');window.__swapPercent.render();
  const input=document.querySelector('#swap-currency-input input');
  input.focus();input.setSelectionRange(1,4,'backward');
  window.__swapPercent.render();
 });
 assert.deepEqual(await page.locator('#swap-currency-input input').evaluate(input=>[document.activeElement===input,input.selectionStart,input.selectionEnd,input.selectionDirection]),[true,1,4,'backward']);
});
test('BNB fractions reserve current route Gas and price headroom instead of fixed 0.01 BNB',async t=>{
 const expected=[[25,'0.003988743275'],[50,'0.00797748655'],[75,'0.011966229825'],[100,'0.0159549731']];
 for(const[percent,full]of expected){
  const page=await fixture(t,{input:'bnb',balance:'15966673100000000'});await action(page,percent).click();
  await page.waitForFunction(()=>window.__swapPercent.state().amount!=='');const s=await snapshot(page);
  assert.equal(s.amount,full);assert.deepEqual(s.scheduled,[0]);assert.equal(s.walletCalls,0);assert.equal(s.busy,false);assert.equal(s.quotePauses,1,'native sizing pauses background quotes');
  assert.equal(s.rpcCalls.filter(m=>m==='eth_gasPrice').length,1);assert.ok(s.rpcCalls.filter(m=>m==='eth_estimateGas').length>=2);
  assert.equal(s.built.at(-1),ethersUnits(full));
 }
});
function ethersUnits(text){const[a,b='']=text.split('.');return(BigInt(a)*10n**18n+BigInt(b.padEnd(18,'0'))).toString();}
test('disconnected, unknown, failed and zero balances disable every action and cannot mutate input',async t=>{
 for(const options of[{connected:false},{balance:null},{error:true},{balance:'0'}]){
  const page=await fixture(t,options);assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[true,true,true,true]);
  await actions(page).evaluateAll(nodes=>nodes.forEach(n=>n.dispatchEvent(new Event('click'))));
  const s=await snapshot(page);assert.equal(s.amount,'');assert.deepEqual(s.scheduled,[]);assert.equal(s.stops,0);assert.equal(s.walletCalls,0);
 }
});
test('a BNB balance below old 0.01 reserve remains usable when actual Gas fits',async t=>{
 const page=await fixture(t,{input:'bnb',balance:'1000000000000000'});assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[false,false,false,false]);
 await action(page,100).click();await page.waitForFunction(()=>window.__swapPercent.state().amount!=='');
 assert.equal((await snapshot(page)).amount,'0.0009883');assert.equal((await snapshot(page)).walletCalls,0);
 const token=await fixture(t,{balance:'3'});assert.deepEqual(await actions(token).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[true,false,false,false]);
 await action(token,100).click();assert.equal((await snapshot(token)).amount,'0.000000000000000003');
});
test('failed Gas price or estimate leaves the native input untouched and restores controls',async t=>{
 for(const failure of ['gasFailure','estimateFailure']){
  const page=await fixture(t,{input:'bnb',[failure]:true});await action(page,100).click();
  await page.waitForFunction(()=>!window.__swapPercent.state().busy);const s=await snapshot(page);
  assert.equal(s.amount,'');assert.deepEqual(s.scheduled,[]);assert.equal(s.walletCalls,0);assert.equal(s.popups.length,1);
  assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[false,false,false,false]);
 }
});
test('pending native Gas reads cannot overwrite a changed account, token, amount, balance or settings',async t=>{
 for(const mutation of ['account','token','amount','balance','provider','settings']){
  const page=await fixture(t,{input:'bnb',deferEstimate:true});await action(page,100).click();
  await page.waitForFunction(()=>window.__swapPercent.state().rpcCalls.includes('eth_estimateGas'));
  assert.equal((await snapshot(page)).busy,true);
  await page.evaluate(mutation=>{const api=window.__swapPercent;if(mutation==='account')api.setAccount('0x'+'bb'.repeat(20));if(mutation==='token')api.setToken('usdt');if(mutation==='amount')api.setAmount('0.0002');if(mutation==='balance')api.setBalance('123456789123456789124');if(mutation==='provider')api.setProvider();if(mutation==='settings')api.setSettings();api.releaseEstimate();},mutation);
  await page.waitForFunction(()=>!window.__swapPercent.state().busy);const s=await snapshot(page);
  assert.equal(s.amount,mutation==='amount'?'0.0002':'');assert.deepEqual(s.scheduled,[]);assert.equal(s.walletCalls,0);
 }
});
test('stale account, token, balance and error callbacks cannot reuse old shortcuts',async t=>{
 for(const mutation of['account','token','balance','error']){
  const page=await fixture(t);await page.evaluate(()=>window.__swapPercent.capture(100));
  await page.evaluate(mutation=>{
   const api=window.__swapPercent;
   if(mutation==='account')api.setAccount('0x'+'bb'.repeat(20));
   if(mutation==='token')api.setToken('bnb');
   if(mutation==='balance')api.setBalance('123456789123456789124');
   if(mutation==='error')api.setError(true);
   api.invokeOld();
  },mutation);
  const s=await snapshot(page);assert.equal(s.amount,'');assert.deepEqual(s.scheduled,[]);assert.equal(s.stops,0);assert.equal(s.walletCalls,0);
 }
});
test('keyboard Enter and Space retain focus on the newly rendered percentage button',async t=>{
 const page=await fixture(t);await action(page,25).focus();await page.keyboard.press('Enter');
 assert.equal(await action(page,25).evaluate(n=>document.activeElement===n),true);
 assert.equal(await action(page,25).evaluate(n=>getComputedStyle(n).outlineWidth),'2px');
 assert.deepEqual((await snapshot(page)).scheduled,[0]);
 await page.keyboard.press('Tab');assert.equal(await action(page,50).evaluate(n=>document.activeElement===n),true);
 await page.keyboard.press('Space');assert.equal(await action(page,50).evaluate(n=>document.activeElement===n),true);
 assert.deepEqual((await snapshot(page)).scheduled,[0,0]);assert.equal((await snapshot(page)).walletCalls,0);
});
