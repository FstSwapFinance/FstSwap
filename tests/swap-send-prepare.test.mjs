import test from 'node:test';
import assert from 'node:assert/strict';
import {sendWalletOnce} from '../src/swap-send.mjs';
const account='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32),blockHash='0x'+'44'.repeat(32);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(){
 const map=new Map(),events=[],sent=[],f={events,sent,map};
 const storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const transaction={from:account,to:target,data:'0x1234',value:'0x0'};
 let locked=false;
 const locks={request:async(_,opts,fn)=>{if(locked)return fn(null);locked=true;events.push('lock');try{return await fn({});}finally{events.push('unlock');locked=false;}}};
 f.currentAccount=account;f.chain='0x38';f.code='0x1234';
 const block={number:'0x1',hash:blockHash};
 const provider={request:async({method,params})=>{
  events.push(method);
  if(method==='eth_chainId')return f.chain;
  if(method==='eth_accounts')return[f.currentAccount];
  if(method==='eth_getCode'){if(f.guardGate)await f.guardGate.promise;return f.code;}
  if(method==='eth_getBlockByNumber')return block;
  if(method==='eth_getTransactionCount'){assert.equal(params[1],'pending');return '0x7';}
  if(method==='eth_sendTransaction'){sent.push(params[0]);return hash;}
  throw Error('Unexpected wallet request '+method);
 }};
 const read=async({method})=>{
  if(method==='eth_getBlockByNumber'){events.push('read-latest');return block;}
  if(method==='eth_getTransactionReceipt'){events.push('recover-receipt');if(f.recoveryGate)await f.recoveryGate.promise;return null;}
  throw Error('Unexpected read '+method);
 };
 return Object.assign(f,{provider,transaction,storage,locks,read,send:(options={})=>sendWalletOnce({provider,read,transaction,storage,locks,...options})});
}

test('diagnostics cannot run between final intent validation and the actual wallet request',async()=>{
 const f=fixture();let validated=false,observerInGap=false;
 await f.send({beforeSubmit:()=>{validated=true;return true;},onTiming:()=>{if(validated&&f.sent.length===0)observerInGap=true;}});
 assert.equal(observerInGap,false);assert.equal(f.sent.length,1);
});
test('optional timing marks real guarded send invocation without extra wallet calls or payloads',async()=>{
 const f=fixture(),phases=[];await f.send({prepare:async()=>({}),onTiming:(...args)=>{assert.equal(args.length,1);assert.equal(typeof args[0],'string');phases.push(args[0]);f.events.push('timing:'+args[0]);}});
 for(const phase of ['lock_wait','lock_acquired','recovery_done','guard_start','guard_done','prepare_start','prepare_done','final_guard_start','final_guard_done','send_invoked','wallet_result'])assert.ok(phases.includes(phase),phase);
 assert.equal(phases.includes('wallet_visible'),false);assert.ok(f.events.indexOf('timing:send_invoked')>f.events.indexOf('eth_sendTransaction'));
 assert.equal(f.events.filter(event=>event==='eth_sendTransaction').length,1);assert.equal(f.sent[0].nonce,'0x7');
});
test('timing callback errors are isolated from guard and send behavior',async()=>{
 const f=fixture();assert.equal((await f.send({prepare:async()=>({}),onTiming:()=>{throw Error('diagnostic failure');}})).hash,hash);assert.equal(f.sent.length,1);
});
test('timing a rejected guard never records a send invocation',async()=>{
 const f=fixture(),phases=[];f.chain='0x1';await assert.rejects(f.send({onTiming:phase=>phases.push(phase)}),{code:'WALLET_CHANGED'});assert.equal(f.sent.length,0);assert.equal(phases.includes('send_invoked'),false);
});
test('cancellation from a pre-send timing callback cannot reach the wallet prompt',async()=>{
 const f=fixture(),controller=new AbortController();await assert.rejects(f.send({signal:controller.signal,prepare:async()=>({}),onTiming:phase=>{if(phase==='final_guard_done')controller.abort();}}),{name:'AbortError'});assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('UI cancellation after the send invocation still retains the original returned hash',async()=>{
 const f=fixture(),controller=new AbortController();const result=await f.send({signal:controller.signal,onTiming:phase=>{if(phase==='send_invoked')controller.abort();}});
 assert.equal(controller.signal.aborted,true);assert.equal(result.hash,hash);assert.equal(f.sent.length,1);assert.equal(JSON.parse(f.map.get('fstswap-wallet-intent-v1:56:'+account)).hash,hash);
});

// A serial implementation either sends before prepare finishes or cannot start
// wallet guards while its prepare gate is unresolved.
test('read-only preparation overlaps the first wallet guards and still gates sending',async()=>{
 const f=fixture(),prepareGate=deferred();f.guardGate=deferred();
 const running=f.send({prepare:async()=>{f.events.push('prepare');await prepareGate.promise;return{gasLimit:65000n,gasPrice:10n};}});
 await tick();assert.ok(f.events.includes('prepare'));assert.ok(f.events.includes('eth_getCode'));assert.equal(f.sent.length,0);
 prepareGate.resolve();await tick();assert.equal(f.sent.length,0);
 f.guardGate.resolve();const result=await running;
 assert.equal(result.hash,hash);assert.equal(f.sent.length,1);assert.equal(f.sent[0].gas,'0xfde8');assert.equal(f.sent[0].gasPrice,'0xa');
 assert.ok(f.events.indexOf('eth_getTransactionCount')>f.events.indexOf('prepare'));
});
test('preparation does not start before pending recovery or outside the wallet lock',async()=>{
 const f=fixture();f.recoveryGate=deferred();
 f.storage.setItem('fstswap-wallet-intent-v1:56:'+account,JSON.stringify({hash,transaction:f.transaction}));
 let prepared=false;const running=f.send({prepare:async()=>{prepared=true;return{};}});const rejected=assert.rejects(running,{code:'TX_PENDING'});
 await tick();assert.equal(prepared,false);assert.equal(f.events[0],'lock');assert.equal(f.sent.length,0);
 f.recoveryGate.resolve();await rejected;assert.equal(prepared,false);assert.equal(f.sent.length,0);
});
test('a failed wallet guard aborts still-running preparation without sending',async()=>{
 const f=fixture();f.chain='0x1';let signal;
 await assert.rejects(f.send({prepare:({signal:active})=>{signal=active;return new Promise((_,reject)=>active.addEventListener('abort',()=>reject(active.reason),{once:true}));}}),{code:'WALLET_CHANGED'});
 assert.equal(signal?.aborted,true);assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('a failed mandatory preparation never opens the wallet payment prompt',async()=>{
 const f=fixture();
 await assert.rejects(f.send({prepare:async()=>{throw Object.assign(Error('simulation failed'),{code:'UNSAFE_QUOTE'});}}),{code:'UNSAFE_QUOTE'});
 assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('an insufficient allowance returns to authorization without storage or send despite read-only nonce prefetch',async()=>{
 const f=fixture(),policy={assertFresh:()=>true};
 const result=await f.send({prepare:async()=>({needsApproval:true,policy})});
 assert.equal(result.needsApproval,true);assert.equal(result.preparation.policy,policy);assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
 // Fetching a pending nonce is read-only; preparation must still prevent intent
 // storage and any payment/signature request when approval is insufficient.
 assert.equal(f.events.filter(event=>event==='eth_getTransactionCount').length,1);
});
test('an account change during preparation is checked again before sending',async()=>{
 const f=fixture(),gate=deferred();
 const running=f.send({prepare:async()=>{await gate.promise;return{};}});const rejected=assert.rejects(running,{code:'WALLET_CHANGED'});
 await tick();f.currentAccount='0x'+'55'.repeat(20);gate.resolve();await rejected;assert.equal(f.sent.length,0);
});
test('a network change during preparation is checked again before sending',async()=>{
 const f=fixture(),gate=deferred();
 const running=f.send({prepare:async()=>{await gate.promise;return{};}});const rejected=assert.rejects(running,{code:'WALLET_CHANGED'});
 await tick();f.chain='0x1';gate.resolve();await rejected;assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('sending waits for both post-preparation identity reads while nonce stays prefetched',async()=>{
 const f=fixture(),prepareGate=deferred(),chainGate=deferred(),accountGate=deferred(),original=f.provider.request;
 const counts=new Map();
 f.provider.request=payload=>{
  const n=(counts.get(payload.method)||0)+1;counts.set(payload.method,n);
  if(n===2&&payload.method==='eth_chainId')return chainGate.promise;
  if(n===2&&payload.method==='eth_accounts')return accountGate.promise;
  return original(payload);
 };
 const running=f.send({prepare:async()=>{await prepareGate.promise;return{};}});
 await tick();assert.equal(counts.get('eth_getTransactionCount'),1);assert.equal(counts.get('eth_chainId'),1);assert.equal(counts.get('eth_accounts'),1);
 prepareGate.resolve();await tick();assert.equal(counts.get('eth_chainId'),2);assert.equal(counts.get('eth_accounts'),2);assert.equal(f.sent.length,0);
 chainGate.resolve('0x38');await tick();assert.equal(f.sent.length,0);
 accountGate.resolve([account]);await running;assert.equal(f.sent.length,1);assert.equal(f.sent[0].nonce,'0x7');
});
for(const pending of ['nonce','block'])for(const prepared of [false,true])for(const changed of ['account','network']){
 test(`wallet ${changed} change while waiting for ${pending} rejects sending (${prepared?'prepared':'direct'})`,async()=>{
  const f=fixture(),gate=deferred(),original=f.provider.request;
  f.provider.request=payload=>{
   if(payload.method===(pending==='nonce'?'eth_getTransactionCount':'eth_getBlockByNumber'))return gate.promise;
   return original(payload);
  };
  const running=f.send(prepared?{prepare:async()=>({})}:{}),rejected=assert.rejects(running,{code:'WALLET_CHANGED'});
  await tick();if(changed==='account')f.currentAccount='0x'+'55'.repeat(20);else f.chain='0x1';
  gate.resolve(pending==='nonce'?'0x7':{number:'0x1',hash:blockHash});await rejected;
  assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
 });
}
test('changed quote settings cannot pass beforeSubmit after parallel preparation',async()=>{
 const f=fixture();let current=true;
 await assert.rejects(f.send({prepare:async()=>{current=false;return{};},beforeSubmit:()=>current}),{code:'REQUEST_CHANGED'});
 assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('preparation cannot replace transaction identity or the provider',async()=>{
 for(const field of ['transaction','from','to','data','value','provider','nonce','chainId','quote','settings']){
  const f=fixture();await assert.rejects(f.send({prepare:async()=>({[field]:'0x1'})}),{code:'INVALID_PREPARATION'},field);assert.equal(f.sent.length,0,field);
 }
});
test('mutation of the caller transaction or provider during prepare rejects sending',async()=>{
 for(const change of [f=>{f.transaction.to=account;},f=>{f.transaction.from=target;},f=>{f.transaction.data='0x4321';},f=>{f.transaction.value='0x1';},f=>{f.provider.request=async()=>hash;}]){
  const f=fixture();await assert.rejects(f.send({prepare:async()=>{change(f);return{};}}),{code:'REQUEST_CHANGED'});assert.equal(f.sent.length,0);
 }
});
test('external cancellation stops guards and preparation before any prompt',async()=>{
 const f=fixture(),controller=new AbortController();let signal;f.guardGate=deferred();
 const running=f.send({signal:controller.signal,prepare:({signal:active})=>{signal=active;return new Promise(()=>{});}});const rejected=assert.rejects(running,{name:'AbortError'});
 await tick();controller.abort();await rejected;assert.equal(signal.aborted,true);assert.equal(f.sent.length,0);f.guardGate.resolve();await tick();assert.equal(f.sent.length,0);
});
test('a concurrent click cannot start a second preparation while the first owns the lock',async()=>{
 const f=fixture(),gate=deferred();let prepares=0;
 const first=f.send({prepare:async()=>{prepares++;await gate.promise;return{};}});await tick();
 await assert.rejects(f.send({prepare:async()=>{prepares++;return{};}}),{code:'WALLET_BUSY'});assert.equal(prepares,1);
 gate.resolve();await first;assert.equal(f.sent.length,1);
});
test('a preparation that ignores its signal cannot hold the UI indefinitely',async()=>{
 const f=fixture();await assert.rejects(f.send({walletReadTimeoutMs:10,prepare:()=>new Promise(()=>{})}),{code:'WALLET_TIMEOUT'});assert.equal(f.sent.length,0);
});
test('synchronous cancellation inside beforeSubmit cannot persist or send an intent',async()=>{
 const f=fixture(),controller=new AbortController();
 await assert.rejects(f.send({signal:controller.signal,prepare:async()=>({}),beforeSubmit:()=>{controller.abort();return true;}}),{name:'AbortError'});
 assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('synchronous identity mutation inside beforeSubmit cannot reach the wallet',async()=>{
 const f=fixture();
 await assert.rejects(f.send({prepare:async()=>({}),beforeSubmit:()=>{f.transaction.to=account;return true;}}),{code:'REQUEST_CHANGED'});
 assert.equal(f.sent.length,0);assert.equal(f.map.size,0);
});
test('a late wallet hash arriving during parallel prepare prevents the next send',async()=>{
 const f=fixture(),original=f.provider.request;let reply;
 f.provider.request=payload=>payload.method==='eth_sendTransaction'?new Promise(resolve=>{f.sent.push(payload.params[0]);reply=resolve;}):original(payload);
 await assert.rejects(f.send({walletTimeoutMs:5}),{code:'WALLET_RESPONSE_UNKNOWN'});
 f.provider.request=original;const gate=deferred();
 const next=f.send({prepare:async()=>{await gate.promise;return{};}}),rejected=assert.rejects(next,{code:'TX_PENDING'});
 await tick();reply(hash);await tick();gate.resolve();await rejected;assert.equal(f.sent.length,1);
});
