// Execute the real view preview/lifecycle functions with an injected monotonic
// clock. No quote amount protection, service timeout or cooldown constant changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const slice=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const preview=slice('  let previewController =', '  // —— 报价');
const lifecycle=slice('  function resumeIdleReads()', '  function scheduleQuote(');
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const U='0x'+'11'.repeat(20),F='0x'+'22'.repeat(20),C='0x'+'33'.repeat(20);
function fixture(){
 let now=0,coolUntil=0,nextTimer=0,paint=0;const timers=new Map(),calls=[],queue=[],events=new EventTarget(),doc=new EventTarget();doc.hidden=false;
 const pair=[{address:U,decimals:18},{address:F,decimals:6}],state={amount:'',transactionBusy:false,preview:null,quote:null},main={isConnected:true};
 const remote=(out=4000000n,expires=now+15000)=>({quotedAt:now,expiresAt:expires,quote:{out,amountIn:10n**18n,poolCheckedAt:now}});
 const context={state,main,settings:{slippageBps:50,singleHop:false},document:doc,navigator:{onLine:true},AbortController,DOMException,BigInt,Object,Math,Number,JSON,
  inT:()=>pair[0],outT:()=>pair[1],ZERO:'0x'+'00'.repeat(20),quoteNow:()=>now,swapActiveRouter:()=>U,SWAP_ADAPTERS:{},renderTrade(){paint++;},
  otherBalances:{pause(){},schedule(){}},cancelSubmissionWarm(){},approvals:{pending:()=>false},approvalIdentity:()=>({}),
  addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{id,fn,at:now+Math.max(0,ms)});return id;},clearTimeout(id){timers.delete(id);},
  swapService:{now:()=>now,available:()=>now>=coolUntil,async quote(input,options){calls.push({input,options,at:now});return queue.length?queue.shift()(input,options):remote();}},
 };
 vm.createContext(context);vm.runInContext(preview+'\n'+lifecycle+'\nglobalThis.pairHarness={refresh:refreshPairPrice,stop:stopPairPrice};',context);
 const advance=async ms=>{const until=now+ms;for(let count=0;count<200;count++){const next=[...timers.values()].filter(t=>t.at<=until).sort((a,b)=>a.at-b.at||a.id-b.id)[0];if(!next){now=until;await tick();return;}now=next.at;timers.delete(next.id);next.fn();await tick();}throw Error('Unbounded preview scheduling');};
 return{context,state,main,pair,doc,events,timers,calls,remote,advance,async refresh(options){await context.pairHarness.refresh(options);await tick();},stop:()=>context.pairHarness.stop(),enqueue:fn=>queue.push(fn),coolFor:ms=>{coolUntil=now+ms;},get now(){return now;},get paint(){return paint;}};
}
test('empty-input unit price recovers automatically after the original thirty-second transport cooldown',async()=>{
 const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();assert.equal(f.state.preview,null);assert.equal(f.calls.length,1);
 await f.advance(29999);assert.equal(f.calls.length,1,'cooldown must not be bypassed by retry polling');await f.advance(1);
 assert.equal(f.calls.length,2,'a new read must be scheduled once the service is available');assert.ok(f.state.preview);assert.equal(f.state.preview.serviceExpiresAt,45000);assert.equal(f.calls[1].input.amountIn,10n**18n);assert.equal(f.calls[1].options.fresh,true,'recovery must not revive a completed expired cache');
});
test('a page arriving during cooldown waits without issuing HTTP and then starts its unit-price read',async()=>{
 const f=fixture();f.coolFor(30000);await f.refresh();assert.equal(f.calls.length,0);await f.advance(30000);assert.equal(f.calls.length,1);assert.ok(f.state.preview);
});
test('hidden and offline lifecycle pauses remove recovery, then visibility or online resumes current reads',async()=>{
 for(const mode of['hidden','offline']){
  const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();
  if(mode==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}else{f.context.navigator.onLine=false;f.events.dispatchEvent(new Event('offline'));}
  assert.equal(f.timers.size,0,mode+' must cancel outstanding preview recovery');await f.advance(60000);assert.equal(f.calls.length,1);
  if(mode==='hidden'){f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));}else{f.context.navigator.onLine=true;f.events.dispatchEvent(new Event('online'));}
  await tick();assert.equal(f.calls.length,2);assert.ok(f.state.preview);
 }
});
test('token changes cancel old retry ownership and ignored callbacks cannot clear the new pair recovery',async()=>{
 const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();const old=[...f.timers.values()][0];assert.ok(old);
 f.pair[1]={address:C,decimals:18};f.stop();await f.refresh();const current=[...f.timers.values()][0];assert.ok(current);assert.notEqual(current.id,old.id);
 old.fn();await tick();assert.ok(f.timers.has(current.id),'a cleared old callback must not steal the new timer');await f.advance(30000);assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.tokenOut,C);assert.ok(f.state.preview);
});
test('leaving a page cancels the timer and late results cannot paint or schedule recovery',async()=>{
 const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();const old=[...f.timers.values()][0];assert.ok(old);f.main.isConnected=false;f.stop();old.fn();await f.advance(60000);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);assert.equal(f.state.preview,null);
 const other=fixture();let resolve;other.enqueue(()=>new Promise(r=>resolve=r));const pending=other.refresh();await tick();other.main.isConnected=false;other.stop();resolve(other.remote());await pending;assert.equal(other.state.preview,null);assert.equal(other.timers.size,0);
});
test('expired preview is cleared at its original expiry before fetching again and an expired response never appears',async()=>{
 const f=fixture();f.enqueue(()=>f.remote(4000000n,1200));await f.refresh();const original=f.state.preview;assert.equal(original.serviceExpiresAt,1200);
 let resolve;f.enqueue(()=>new Promise(r=>resolve=r));await f.advance(1200);assert.equal(f.state.preview,null,'the original unit price cannot remain visible while a fresh response is pending');assert.equal(original.serviceExpiresAt,1200);assert.equal(f.calls.length,2);
 resolve(f.remote(8000000n));await tick();assert.equal(f.state.preview.out,8000000n);assert.equal(original.serviceExpiresAt,1200);
 const other=fixture();other.enqueue(()=>other.remote(4000000n,0));await other.refresh();assert.equal(other.state.preview,null);await other.advance(6000);assert.ok(other.state.preview);assert.equal(other.calls.length,2);
});
test('typed amounts and hard route failures do not acquire empty-input retry polling',async()=>{
 const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();f.state.amount='3';await f.advance(60000);assert.equal(f.calls.length,1);assert.equal(f.state.amount,'3');assert.equal(f.state.quote,null);
 const hard=fixture();hard.enqueue(()=>{throw Object.assign(Error('NO_ROUTE'),{code:'NO_ROUTE'});});await hard.refresh();await hard.advance(60000);assert.equal(hard.calls.length,1);assert.equal(hard.state.preview,null);
});
test('same-pair reuse notifications cannot keep postponing a pending cooldown recovery',async()=>{
 const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();
 for(let i=0;i<5;i++){await f.advance(5000);await f.refresh({reuse:true});}
 await f.advance(5000);assert.equal(f.calls.length,2);assert.equal(f.calls[1].at,30000);assert.ok(f.state.preview);
});
test('pagehide cancels a preserved document recovery and pageshow resumes without reviving its old preview',async()=>{
 const f=fixture();f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();assert.ok(f.timers.size);
 f.events.dispatchEvent(new Event('pagehide'));assert.equal(f.timers.size,0);await f.advance(60000);assert.equal(f.calls.length,1);assert.equal(f.state.preview,null);
 f.events.dispatchEvent(new Event('pageshow'));await tick();assert.equal(f.calls.length,2);assert.ok(f.state.preview);
});
// Real settings handler wiring: empty amount makes the separate amount quote
// scheduler inert, exactly the state which originally stranded this preview.
function settingsControls(f){
 let current;
 const node=()=>{const n=new EventTarget();n.className='fpFSKc hQBzuZ iRRrwD';n.value='';n.setAttribute=()=>{};n.querySelector=()=>null;n.querySelectorAll=()=>[];return n;};
 f.context.part=()=>{
  const presets=Array.from({length:4},node),slip=node(),custom=node(),deadlines=Array.from({length:3},node),deadline=node(),expert=node(),singleHop=node(),button=node(),fly=node(),fresh=node();
  slip.closest=()=>custom;
  const group=(buttons,input)=>({querySelectorAll:()=>[{querySelectorAll:()=>buttons}],querySelector:()=>input});
  fly.querySelectorAll=()=>[group(presets,slip),group(deadlines,deadline)];
  fly.querySelector=key=>key==='#toggle-expert-mode-button'?expert:singleHop;
  for(const toggle of[expert,singleHop])toggle.querySelectorAll=()=>[node(),node()];
  fresh.querySelector=key=>key==='#open-settings-dialog-button'?button:fly;fresh.childNodes=[];
  current={presets,slip,singleHop};return fresh;
 };
 Object.assign(f.context,{settingsWrap:{replaceChildren(){}},saveSettings(){},render(){},renderBottom(){},scheduleQuote(){},queueSubmissionWarm(){}});f.state.settingsOpen=true;
 vm.runInContext(slice('  function dropDisplayedQuote()', '  // —— 设置弹层')+slice('  function renderSettings()', '  const closeSettings ='),f.context);f.context.renderSettings();return()=>current;
}
test('changing slippage during unit-price cooldown cancels the old identity and rearms the new settings',async()=>{
 const f=fixture(),controls=settingsControls(f);f.enqueue(()=>{f.coolFor(30000);return null;});await f.refresh();await f.advance(5000);
 controls().presets[3].dispatchEvent(new Event('click'));await tick();assert.equal(f.context.settings.slippageBps,100);
 await f.advance(60000);assert.ok(f.calls.some(c=>c.input.slippageBps===100),'the actual preset click must start a new-identity recovery');assert.ok(f.calls.slice(1).every(c=>c.input.slippageBps===100));assert.ok(f.state.preview);
});
test('changing single-hop while a unit price is visible clears it and requests the new identity instead of stranding expiry',async()=>{
 const f=fixture(),controls=settingsControls(f);await f.refresh();const original=f.state.preview;assert.equal(original.serviceExpiresAt,15000);await f.advance(5000);
 let resolve;f.enqueue(()=>new Promise(r=>resolve=r));controls().singleHop.dispatchEvent(new Event('click'));await tick();assert.equal(f.context.settings.singleHop,true);
 assert.equal(f.calls.length,2,'the actual single-hop toggle must issue a fresh current-settings read');assert.equal(f.state.preview,null,'the old unit price must not be displayed under new route settings');assert.equal(f.calls[1].input.singleHop,true);assert.equal(f.calls[1].options.fresh,true);
 await f.advance(1000);assert.equal(f.state.preview,null);resolve(f.remote(8000000n));await tick();assert.equal(f.state.preview.out,8000000n);await f.advance(9000);assert.equal(original.serviceExpiresAt,15000);assert.equal(f.state.preview.out,8000000n);await f.advance(60000);assert.ok(f.calls.slice(1).every(c=>c.input.singleHop));assert.ok(f.state.preview);
});
test('selected token metadata changes cancel the old unit price and reprice using the new precision',async()=>{
 const f=fixture();let changed;
 Object.assign(f.state,{balances:{},balanceErrors:{},balancePending:{}});
 Object.assign(f.context,{page:{inKey:'usdt',outKey:'fist'},balanceRequests:new Map(),refreshBalances(){},onTokensChanged(fn){changed=fn;return()=>{};},selectedTokenIdentity:()=>JSON.stringify(f.pair),selectedTokenSignature:JSON.stringify(f.pair),render(){f.context.selectedTokenSignature=f.context.selectedTokenIdentity();},renderPanels(){},renderBottom(){},scheduleQuote(){}});
 vm.runInContext(slice('  const stopTokens=onTokensChanged(', '  const stopApprovals ='),f.context);await f.refresh();
 changed();await tick();assert.equal(f.calls.length,1,'unrelated metadata updates must not restart the selected unit price');
 f.pair[0]={...f.pair[0],decimals:6};changed();await tick();assert.equal(f.calls.length,2,'selected-token precision changes must own a new unit-price read');assert.equal(f.calls[1].input.amountIn,10n**6n);assert.equal(f.calls[1].options.fresh,true);assert.ok(f.state.preview);
});
