import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceClient, validateServiceQuote } from '../src/swap-service-client.mjs';

const U='0x55d398326f99059ff775485246999027b3197955', F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const R='0x'+'33'.repeat(20), A='0x'+'44'.repeat(20), H='0x'+'ab'.repeat(32);
const input={tokenIn:U,tokenOut:F,amountIn:1000000000000000001n,slippageBps:0,singleHop:false};
const binding={router:R,adapters:{fst:{adapter:A}}};
const wireInput={chainId:56,...input,amountIn:String(input.amountIn)};
const tokens=[{key:'fist',address:F}];
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$bigint:String(v)}:v);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function quote(at){
 return {schema:1,chainId:56,router:R,blockNumber:'0x1',blockHash:H,input:wireInput,quotedAt:at,
  expiresAt:at+15000,config:{version:'1.11',platformFeeBps:30,feeReceiver:U,wbnb:F,defaultFeeToken:U,feeConfigVersion:1n,adaptersOff:[]},
  quote:{kind:'v10',method:'swapTokenToToken',first:{adapter:A,path:[U,F]},amountIn:input.amountIn,out:5n,lpFee:3000000000000000n,feeToken:U,impact:0,poolCheckedAt:at}};
}
const balances=at=>({schema:1,chainId:56,account:U,blockNumber:'0x1',blockHash:H,readAt:at,balances:{[F]:'42'},failedTokens:[]});
function harness(respond,{wall=9900,mono=1000,server=14240,rtt=100,...options}={}){
 const state={wall,mono,server,rtt,calls:[]};
 const response=(value,init,{time=state.server,headers={}}={})=>new Response(encode(value),{headers:{
  'x-fstswap-time-nonce':new Headers(init.headers).get('x-fstswap-time-nonce')??'missing',
  'x-fstswap-server-time':String(time),...headers}});
 const client=createServiceClient({base:'https://clock.test/api/swap',clock:()=>state.wall,monotonic:()=>state.mono,...options,
  fetchImpl:async(url,init)=>{state.calls.push({url,init});state.mono+=state.rtt;state.wall+=state.rtt;return respond({url,init,state,response});}});
 const advance=(ms,{wallDelta=ms,monoDelta=ms,serverDelta=ms}={})=>{state.wall+=wallDelta;state.mono+=monoDelta;state.server+=serverDelta;};
 return {client,state,advance};
}

test('request-bound server time accepts a device 4240ms behind for quotes and balances without changing DTO time fields',async()=>{
 const h=harness(({url,init,state,response})=>response(url.endsWith('/quote')?quote(state.server):balances(state.server),init));
 const result=await h.client.quote(input,binding);
 assert.ok(result,'the original +2s local-wall guard incorrectly rejects this valid fast response');
 assert.equal(h.state.server-h.state.wall,4240);
 assert.equal(result.quotedAt,14240);assert.equal(result.expiresAt,29240);assert.equal(result.quote.poolCheckedAt,14240);
 assert.equal(h.client.now(),14340);assert.deepEqual(h.client.timeBounds(),{lower:14240,upper:14340});
 assert.equal(h.client.remainingUntil(result.expiresAt),14900);
 assert.deepEqual(await h.client.balances(U,tokens),{balances:{fist:42n},failed:[]});
 for(const {init}of h.state.calls){assert.match(new Headers(init.headers).get('x-fstswap-time-nonce'),/^[0-9a-f]{32}$/);assert.equal(JSON.parse(init.body).serverTime,undefined);}
 assert.notEqual(new Headers(h.state.calls[0].init.headers).get('x-fstswap-time-nonce'),new Headers(h.state.calls[1].init.headers).get('x-fstswap-time-nonce'));
 assert.equal(h.client.available(),true);
});

test('legacy responses without time headers keep strict local validation and cannot derive a clock from the DTO',async()=>{
 const good=harness(()=>new Response(encode(quote(9999))));assert.ok(await good.client.quote(input,binding));
 const bad=harness(()=>new Response(encode(quote(14240))));assert.equal(await bad.client.quote(input,binding),null);
 assert.equal(bad.client.available(),false);
});

test('fresh quote requests bypass backend sharing by header without changing the input schema or balance requests',async()=>{
 const h=harness(({url,init,state,response})=>response(url.endsWith('/quote')?quote(state.server):balances(state.server),init));
 assert.ok(await h.client.quote(input,binding));assert.ok(await h.client.quote(input,{...binding,fresh:true}));
 assert.deepEqual(await h.client.balances(U,tokens),{balances:{fist:42n},failed:[]});
 assert.deepEqual(h.state.calls.map(({init})=>new Headers(init.headers).get('x-fstswap-fresh')),[null,'1',null]);
 for(const {init}of h.state.calls)assert.equal(Object.hasOwn(JSON.parse(init.body),'fresh'),false);
});

test('expired and future quote DTOs cannot establish an anchor, and RTT uncertainty does not extend the original deadline',async()=>{
 for(const patch of [
  (data,s)=>{data.quotedAt=s+2001;data.quote.poolCheckedAt=s;data.expiresAt=s+15000;},
  (data,s)=>{data.quote.poolCheckedAt=s-15000;data.quotedAt=s-1;data.expiresAt=s;},
  (data,s)=>{data.quote.poolCheckedAt=s-14950;data.quotedAt=s-1;data.expiresAt=s+50;},
 ]){
  const h=harness(({init,state,response})=>{const data=quote(state.server);patch(data,state.server);return response(data,init);});
  assert.equal(await h.client.quote(input,binding),null);
  assert.equal(h.client.now(),h.state.wall,'a rejected DTO must not publish its transport clock');
 }
});

test('stale and future balances cannot establish an anchor',async()=>{
 for(const delta of [-15000,2001]){
  const h=harness(({init,state,response})=>response(balances(state.server+delta),init));
  assert.equal(await h.client.balances(U,tokens),null);assert.equal(h.client.now(),h.state.wall);
 }
});

test('transport time is published only after every chain, input, router and block binding validates',async()=>{
 for(const patch of [data=>data.chainId=97,data=>data.router=U,data=>data.input={...data.input,amountIn:'2'},data=>data.blockHash='bad']){
  const h=harness(({init,state,response})=>{const data=quote(state.server);patch(data);return response(data,init);});
  assert.equal(await h.client.quote(input,binding),null);assert.equal(h.client.now(),h.state.wall);
 }
});

test('partial, malformed and mismatched response time proof is rejected instead of using DTO or local time',async()=>{
 for(const headers of [
  {'x-fstswap-time-nonce':'00'.repeat(16)}, {'x-fstswap-time-nonce':''},
  {'x-fstswap-server-time':''}, {'x-fstswap-server-time':'NaN'}, {'x-fstswap-server-time':'1e4'},
 ]){
  const h=harness(({init,response})=>response(quote(9999),init,{time:10000,headers}));
  assert.equal(await h.client.quote(input,binding),null);assert.equal(h.client.now(),h.state.wall);
 }
});

test('a response replay with an older request nonce cannot calibrate a fresh request',async()=>{
 let previous;
 const h=harness(({init,state,response})=>{
  const nonce=new Headers(init.headers).get('x-fstswap-time-nonce');
  const result=response(quote(state.server),init,{headers:previous?{'x-fstswap-time-nonce':previous}:{}});previous=nonce;return result;
 });
 assert.ok(await h.client.quote(input,binding));const firstNow=h.client.now();
 assert.equal(await h.client.quote(input,{...binding,fresh:true}),null);assert.ok(h.client.now()>=firstNow);
});

test('an over-budget or backward monotonic request cannot become a time sample',async()=>{
 for(const rtt of [1001,-1]){
  const h=harness(({init,response})=>response(quote(9999),init,{time:10000}),{rtt,quoteTimeout:1000});
  assert.equal(await h.client.quote(input,binding),null);
 }
});

test('cache hits preserve the original timestamps and a frozen or rolled back wall clock cannot extend the 2s cache',async()=>{
 const h=harness(({init,state,response})=>response(quote(state.server),init));
 const first=await h.client.quote(input,binding);assert.ok(first);
 h.advance(1000);const hit=await h.client.quote(input,binding);assert.equal(h.state.calls.length,1);
 assert.deepEqual([hit.quotedAt,hit.expiresAt,hit.quote.poolCheckedAt],[first.quotedAt,first.expiresAt,first.quote.poolCheckedAt]);
 h.advance(1000,{wallDelta:0});assert.ok(await h.client.quote(input,binding));assert.equal(h.state.calls.length,2,'monotonic cache age must expire even without wall-clock progress');
 h.advance(2100,{wallDelta:-100000});assert.ok(await h.client.quote(input,binding));assert.equal(h.state.calls.length,3);
});

test('wall-clock jumps cannot change trusted time or revive a DTO after its original 15s lifetime',async()=>{
 const h=harness(({init,state,response})=>response(quote(state.server),init));
 const first=await h.client.quote(input,binding),before=h.client.now();assert.ok(first);
 h.state.wall+=3600000;assert.equal(h.client.now(),before);
 h.state.wall-=7200000;assert.equal(h.client.now(),before);
 h.advance(15000,{wallDelta:-15000});
 assert.equal(h.client.remainingUntil(first.expiresAt),0);
 assert.throws(()=>validateServiceQuote(first,wireInput,{...binding,clock:()=>h.client.now(),timeBounds:()=>h.client.timeBounds()}));
});

test('a later valid sample cannot move trusted time backward or renew an earlier cached deadline',async()=>{
 const h=harness(({init,state,response})=>response(quote(state.server),init));
 const first=await h.client.quote(input,binding),before=h.client.now();assert.ok(first);
 h.state.server-=1000;const second=await h.client.quote(input,{...binding,fresh:true});assert.ok(second);
 assert.ok(h.client.now()>=before);assert.equal(first.expiresAt,29240);
});

test('a canceled older response cannot publish a clock or cool a newer successful quote',async()=>{
 for(const invalid of [false,true]){
  const gate=deferred();let oldInit;
  const h=harness(({init,state,response})=>{
   if(state.calls.length===1){oldInit=init;return gate.promise;}
   return response(quote(state.server),init);
  });
  const controller=new AbortController(),older=h.client.quote(input,{...binding,signal:controller.signal});
  const rejected=assert.rejects(older,{name:'AbortError'});controller.abort();await rejected;
  assert.ok(await h.client.quote(input,{...binding,fresh:true}));
  const before=h.client.now(),data=quote(50000000);if(invalid)data.chainId=97;
  gate.resolve(new Response(encode(data),{headers:{'x-fstswap-time-nonce':new Headers(oldInit.headers).get('x-fstswap-time-nonce'),'x-fstswap-server-time':'50000000'}}));
  await tick();assert.equal(h.client.now(),before);assert.equal(h.client.available(),true);
 }
});

test('cooldown duration cannot be extended by moving the device wall clock backward',async()=>{
 const h=harness(({init,state,response})=>{if(state.calls.length===1)throw Error('offline');return response(quote(state.server),init);});
 assert.equal(await h.client.quote(input,binding),null);assert.equal(h.client.available(),false);
 h.advance(30000,{wallDelta:-100000});assert.equal(h.client.available(),true);
 assert.ok(await h.client.quote(input,binding));assert.equal(h.state.calls.length,2);
});

test('canceling an ignored fetch or body never publishes a late server clock',async()=>{
 for(const phase of ['fetch','body']){
  const gate=deferred(),started=deferred(),controller=new AbortController();
  const h=harness(({init,state,response})=>{
   const result=response(quote(state.server),init);started.resolve();
   return phase==='fetch'?gate.promise.then(()=>result):{ok:true,headers:result.headers,text:()=>gate.promise.then(()=>encode(quote(state.server)))};
  });
  const pending=h.client.quote(input,{...binding,signal:controller.signal});await started.promise;
  const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;
  gate.resolve();await tick();assert.equal(h.client.now(),h.state.wall);assert.equal(h.client.available(),true);
 }
});

test('canceling a balance response cannot establish a time anchor',async()=>{
 const gate=deferred(),controller=new AbortController();
 const h=harness(({init,state,response})=>gate.promise.then(()=>response(balances(state.server),init)));
 const pending=h.client.balances(U,tokens,{signal:controller.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;
 gate.resolve();await tick();assert.equal(h.client.now(),h.state.wall);assert.equal(h.client.available(),true);
});
