import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startDefaultSwapReads} from '../src/swap-startup.mjs';
const startupModule=new URL('../src/swap-startup.mjs',import.meta.url),startupSource=readFileSync(startupModule,'utf8');
const serviceImport=startupSource.match(/from\s+['"]([^'"]*swap-service-client\.mjs[^'"]*)['"]/);
const balanceImport=startupSource.match(/from\s+['"]([^'"]*swap-balances\.mjs[^'"]*)['"]/);
assert.ok(serviceImport&&balanceImport,'startup must declare its actual service and balance graph');
const {swapService}=await import(new URL(serviceImport[1],startupModule));
const {invalidateWalletBalances}=await import(new URL(balanceImport[1],startupModule));

const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),tick=()=>new Promise(resolve=>setImmediate(resolve));
const storage=value=>({getItem:key=>key==='swap_settings_v2'?value:null});
function wallet(account=A){
 const listeners=new Set();return{account,listeners,provider:{request(){throw Error('startup must not call a wallet');}},
  subscribe(fn){listeners.add(fn);if(this.account)fn(this);return()=>listeners.delete(fn);},
  notify(){for(const fn of listeners)fn(this);}};
}
function fixture(options={}){
 const quoteCalls=[],balanceCalls=[],w=wallet(),events=new EventTarget();
 const service={quote:async(input,binding)=>{quoteCalls.push({input,binding});return null;}};
 const readBalances=async(request,account,tokens,options)=>{balanceCalls.push({request,account,tokens,options});return{balances:{},failed:[]};};
 const dispose=startDefaultSwapReads({wallet:w,events,service,readBalances,storage:storage(null),...options});
 return{quoteCalls,balanceCalls,w,events,dispose};
}

test('default unit quote and three-token balances start in parallel before ethers loads',async t=>{
 const prior=globalThis.ethers;delete globalThis.ethers;t.after(()=>{globalThis.ethers=prior;});
 const quoteCalls=[],balanceCalls=[],w=wallet();
 const dispose=startDefaultSwapReads({wallet:w,events:new EventTarget(),storage:storage(null),
  service:{quote:(input,binding)=>{quoteCalls.push({input,binding});return new Promise(()=>{});}},
  readBalances:(request,account,tokens,options)=>{balanceCalls.push({request,account,tokens,options});return new Promise(()=>{});}});
 t.after(dispose);await tick();assert.equal(quoteCalls.length,1);assert.equal(balanceCalls.length,1);
 assert.equal(quoteCalls[0].input.amountIn,10n**18n);assert.equal(balanceCalls[0].account,A);
 dispose();assert.equal(quoteCalls[0].binding.signal.aborted,true);assert.equal(balanceCalls[0].options.signal.aborted,true);
});

test('startup matches canonical keys, decimals, exact addresses and saved zero slippage/single-hop options',async()=>{
 const f=fixture({storage:storage(JSON.stringify({slippageBps:0,singleHop:true}))});await tick();f.dispose();
 assert.equal(f.quoteCalls.length,1);const {input,binding}=f.quoteCalls[0];
 assert.equal(input.tokenIn.toLowerCase(),'0x55d398326f99059ff775485246999027b3197955');
 assert.equal(input.tokenOut.toLowerCase(),'0xc9882def23bc42d53895b8361d0b1edc7570bc6a');
 assert.equal(input.slippageBps,0);assert.equal(input.singleHop,true);assert.ok(binding.router);assert.ok(binding.adapters.fst);
 assert.deepEqual(f.balanceCalls[0].tokens.map(token=>[token.key,token.decimals,token.address?.toLowerCase()??null]),[
  ['usdt',18,input.tokenIn.toLowerCase()],['fist',6,input.tokenOut.toLowerCase()],['bnb',18,null],
 ]);
 assert.notEqual(f.balanceCalls[0].options.fresh,true);
});

test('repeat notifications do not duplicate reads, and changing accounts cancels only old balances',async()=>{
 const f=fixture();await tick();f.w.notify();f.w.notify();await tick();
 assert.equal(f.quoteCalls.length,1);assert.equal(f.balanceCalls.length,1);
 f.w.account=B;f.w.notify();await tick();assert.equal(f.quoteCalls.length,1);assert.equal(f.balanceCalls.length,2);
 assert.equal(f.quoteCalls[0].binding.signal.aborted,false);assert.equal(f.balanceCalls[0].options.signal.aborted,true);
 assert.equal(f.balanceCalls[1].account,B);assert.equal(f.balanceCalls[1].options.signal.aborted,false);f.dispose();
});

test('inactive routes send no requests and leaving the swap route cancels its work',async()=>{
 let active=false;const f=fixture({active:()=>active});await tick();f.w.notify();await tick();assert.equal(f.quoteCalls.length,0);assert.equal(f.balanceCalls.length,0);
 active=true;f.events.dispatchEvent(new Event('hashchange'));await tick();assert.equal(f.quoteCalls.length,1);assert.equal(f.balanceCalls.length,1);
 active=false;f.events.dispatchEvent(new Event('hashchange'));assert.equal(f.quoteCalls[0].binding.signal.aborted,true);assert.equal(f.balanceCalls[0].options.signal.aborted,true);
 f.w.account=B;f.w.notify();await tick();assert.equal(f.quoteCalls.length,1);assert.equal(f.balanceCalls.length,1);f.dispose();
});

test('an unconnected visitor can prefetch the price without prompting or reading a nonexistent account balance',async()=>{
 const w=wallet(null),f=fixture({wallet:w});await tick();assert.equal(f.quoteCalls.length,1);assert.equal(f.balanceCalls.length,0);
 w.account=A;w.notify();await tick();assert.equal(f.balanceCalls.length,1);assert.equal(f.balanceCalls[0].account,A);
 assert.equal(f.quoteCalls.length,1,'silent wallet restoration must preserve the original account-independent quote');
 assert.equal(f.quoteCalls[0].binding.signal.aborted,false);f.dispose();
});

test('null to A to B keeps an unfinished default quote alive while switching its balance subscriptions',async()=>{
 const w=wallet(null),quoteCalls=[],balanceCalls=[];
 const dispose=startDefaultSwapReads({wallet:w,events:new EventTarget(),storage:storage(null),
  service:{quote:(input,binding)=>{quoteCalls.push({input,binding});return new Promise(()=>{});}},
  readBalances:(_request,account,_tokens,options)=>{balanceCalls.push({account,options});return new Promise(()=>{});}});
 await tick();w.account=A;w.notify();await tick();w.account=B;w.notify();await tick();
 assert.equal(quoteCalls.length,1);assert.equal(quoteCalls[0].binding.signal.aborted,false);
 assert.deepEqual(balanceCalls.map(call=>call.account),[A,B]);assert.equal(balanceCalls[0].options.signal.aborted,true);assert.equal(balanceCalls[1].options.signal.aborted,false);dispose();
});

test('a changed quote setting replaces only the quote while retaining the current account balance read',async()=>{
 let saved=JSON.stringify({slippageBps:50,singleHop:false});const f=fixture({storage:{getItem:()=>saved}});await tick();
 saved=JSON.stringify({slippageBps:0,singleHop:true});f.w.notify();await tick();
 assert.equal(f.quoteCalls.length,2);assert.equal(f.quoteCalls[0].binding.signal.aborted,true);assert.equal(f.quoteCalls[1].input.slippageBps,0);
 assert.equal(f.balanceCalls.length,1);assert.equal(f.balanceCalls[0].options.signal.aborted,false);f.dispose();
});

test('dispose removes subscriptions and handles late quote and balance failures internally',async()=>{
 let rejectQuote,rejectBalance;const w=wallet(),events=new EventTarget();
 const dispose=startDefaultSwapReads({wallet:w,events,storage:storage(null),
  service:{quote:()=>new Promise((_,reject)=>{rejectQuote=reject;})},readBalances:()=>new Promise((_,reject)=>{rejectBalance=reject;})});
 await tick();assert.equal(w.listeners.size,1);dispose();assert.equal(w.listeners.size,0);
 rejectQuote(Error('late quote'));rejectBalance(Error('late balances'));await tick();events.dispatchEvent(new Event('hashchange'));w.notify();
});

test('fallback reads forward the shared physical batch signal rather than the startup subscriber signal',async t=>{
 const prior=globalThis.ethers;globalThis.ethers={Interface(){}};t.after(()=>{globalThis.ethers=prior;});
 const physical=new AbortController(),calls=[];
 const f=fixture({request:async(payload,options)=>{calls.push({payload,options});return'0x1';},
  readBalances:async(request,_account,_tokens,options)=>{assert.notEqual(physical.signal,options.signal);await request({method:'eth_call'},{signal:physical.signal});return{balances:{},failed:[]};}});
 await tick();assert.equal(calls.length,1);assert.equal(calls[0].options.signal,physical.signal);f.dispose();
});

test('missing ethers never starts or waits for a local fallback RPC',async t=>{
 const prior=globalThis.ethers;delete globalThis.ethers;t.after(()=>{globalThis.ethers=prior;});let calls=0,failed=false;
 const f=fixture({request:async()=>{calls++;return'0x1';},readBalances:async request=>{try{await request({method:'eth_call'},{signal:new AbortController().signal});}catch{failed=true;}return{balances:{},failed:[]};}});
 await tick();assert.equal(calls,0);assert.equal(failed,true);assert.equal(f.quoteCalls.length,1);f.dispose();
});

test('the actual balance reader can use the shared API before ethers exists without a fallback or wallet request',async t=>{
 const prior=globalThis.ethers,original=swapService.balances;delete globalThis.ethers;invalidateWalletBalances();let balanceCalls=0;
 swapService.balances=async()=>{balanceCalls++;return{balances:{usdt:1n,fist:2n,bnb:3n},failed:[]};};
 t.after(()=>{swapService.balances=original;globalThis.ethers=prior;invalidateWalletBalances();});
 const dispose=startDefaultSwapReads({wallet:wallet(),events:new EventTarget(),storage:storage(null),service:{quote:async()=>null},request:()=>{throw Error('must not use RPC');}});
 t.after(dispose);await tick();assert.equal(balanceCalls,1);
});

test('malformed or unavailable storage uses normal defaults without surfacing a startup failure',async()=>{
 for(const store of [storage('{bad'),{getItem(){throw Error('storage blocked');}}]){
  const f=fixture({storage:store});await tick();assert.equal(f.quoteCalls[0].input.slippageBps,50);assert.equal(f.quoteCalls[0].input.singleHop,false);f.dispose();
 }
});
