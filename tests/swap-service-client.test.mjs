import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceClient} from '../src/swap-service-client.mjs';
const a='0x55d398326f99059ff775485246999027b3197955',b='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',router='0x'+'33'.repeat(20),adapter='0x'+'44'.repeat(20),zero='0x'+'00'.repeat(20);
const input={tokenIn:a,tokenOut:b,amountIn:1000000000000000001n,slippageBps:0,singleHop:false};
const options={router,adapters:{fst:{adapter}}},clock=()=>10000;
const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$bigint:x.toString()}:x);
const data=()=>({schema:1,chainId:56,router,blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),quotedAt:9500,expiresAt:20000,input:{chainId:56,...input,amountIn:input.amountIn.toString()},config:{version:'1.11',platformFeeBps:30,feeReceiver:a,wbnb:b,defaultFeeToken:a,feeConfigVersion:1n,adaptersOff:[]},quote:{kind:'v10',method:'swapTokenToToken',first:{adapter,path:[a,b]},amountIn:input.amountIn,out:5n,lpFee:3000000000000000n,feeToken:a,impact:0,poolCheckedAt:5000}});
const clientFor=(value,status=200)=>createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>new Response(encode(value),{status})});
test('API quote preserves exact integers and matches explicit zero slippage',async()=>{let wire;const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async(_,o)=>{wire=JSON.parse(o.body);return new Response(encode(data()));}});const q=await c.quote(input,options);assert.equal(q.quote.amountIn,input.amountIn);assert.equal(wire.amountIn,input.amountIn.toString());assert.equal(wire.slippageBps,0);});
test('wrong input, router, chain, block and expiry responses cannot be used',async()=>{
 for(const change of [v=>v.input.amountIn='2',v=>v.input.tokenOut=a,v=>v.input.singleHop=true,v=>v.input.slippageBps=50,v=>v.chainId=97,v=>v.router=a,v=>v.blockHash='bad',v=>v.expiresAt=9999,v=>v.quotedAt=13000,v=>v.quote.first.adapter=a,v=>v.quote.poolCheckedAt=10000,v=>v.quote.out=0n]){const d=data();change(d);assert.equal(await clientFor(d).quote(input,options),null);}
});
test('liquidity and price policy failures propagate, never trigger a weaker browser fallback',async()=>{for(const error of ['NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','POOL_LIQUIDITY'])await assert.rejects(clientFor({error},422).quote(input,options),{code:error});});
test('network failures fall back with a cooldown, independent from balance reads',async()=>{let attempts=0;const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>{attempts++;throw Error('offline');}});assert.equal(await c.quote(input,options),null);assert.equal(await c.quote(input,options),null);assert.equal(attempts,1);assert.equal(await c.balances(a,[{key:'b',address:b}]),null);assert.equal(attempts,2);});
test('balance response maps exact amounts and keeps a failed asset separate from zero',async()=>{const c=clientFor({schema:1,chainId:56,account:a,blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),readAt:9999,balances:{[a]:'1000000000000000001',[zero]:'0'},failedTokens:[b]});const result=await c.balances(a,[{key:'a',address:a},{key:'bnb',address:null},{key:'b',address:b}]);assert.deepEqual(result,{balances:{a:1000000000000000001n,bnb:0n},failed:['b']});});
test('balance responses from another account, omitted tokens or stale reads fall back',async()=>{const d={schema:1,chainId:56,account:a,blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),readAt:9999,balances:{[b]:'1'},failedTokens:[]};for(const patch of [{account:b},{balances:{}},{readAt:-6000},{balances:{[b]:1}},{failedTokens:[b]}])assert.equal(await clientFor({...d,...patch}).balances(a,[{key:'b',address:b}]),null);});
test('fee conversion accepts its explicit empty second leg',async()=>{const d=data(),alt='0x'+'11'.repeat(20),alt2='0x'+'22'.repeat(20),request={...input,tokenIn:alt,tokenOut:alt2};d.input={...d.input,tokenIn:alt,tokenOut:alt2};d.quote.first.path=[alt,alt2];d.quote.method='swapTokenToTokenWithFee';d.quote.conversion={first:{adapter,path:[alt,a]},second:{adapter:zero,path:[]},minOut:d.quote.lpFee,feeToken:a,configVersion:1n};assert.ok(await clientFor(d).quote(request,options));});

test('actual execution path, method and fee asset must match the requested trade',async()=>{for(const change of [v=>v.quote.first.path=[router,a],v=>v.quote.method='swapBnbToToken',v=>v.quote.second={adapter,path:[router,b]},v=>v.quote.feeToken=b,v=>v.quote.lpFee=1000000000000000000n,v=>v.quote.maxIn=2n,v=>v.quote.kind='agg']){const d=data();change(d);assert.equal(await clientFor(d).quote(input,options),null);}});

test('alternative hidden route representations are rejected',async()=>{
 const d=data();d.quote.route={first:d.quote.first};assert.equal(await clientFor(d).quote(input,options),null);
 const native={...input,tokenIn:zero},v=data();v.input.tokenIn=zero;v.quote.kind='agg';v.quote.feeToken=zero;
 v.quote.route={side:'buy',first:{adapter,path:[a,b]},estimateOut:v.quote.out,platformFee:v.quote.lpFee,feeBps:30,reserve:500000000000000n,swapBudget:996500000000000001n};
 const nativeOptions={router,adapters:{fst:{adapter,weth:a}}};
 assert.ok(await clientFor(v).quote(native,nativeOptions));
 for(const patch of [{legs:[{adapter,path:[a,router]}]},{amountsIn:[1n]}])assert.equal(await clientFor({...v,quote:{...v.quote,route:{...v.quote.route,...patch}}}).quote(native,nativeOptions),null);
});

const balanceData=()=>({schema:1,chainId:56,account:a,blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),readAt:9999,balances:{[b]:'42'},failedTokens:[]});
const balanceTokens=[{key:'b',address:b}];
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function promptly(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Request did not settle after cancellation or timeout')),150);})]);}
 finally{clearTimeout(timer);}
}

test('caller cancellation settles a quote whose fetch ignores its signal and never resolves',async()=>{
 const controller=new AbortController();let attempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>++attempts===1?new Promise(()=>{}):new Response(encode(data()))});
 const pending=c.quote(input,{...options,signal:controller.signal});controller.abort();
 await assert.rejects(promptly(pending),{name:'AbortError'});
 assert.equal(c.available(),true);assert.ok(await c.quote(input,options));assert.equal(attempts,2);
});

test('caller cancellation settles a quote whose body ignores its signal and never resolves',async()=>{
 const reading=deferred(),controller=new AbortController();let attempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>++attempts===1?{ok:true,text:()=>{reading.resolve();return new Promise(()=>{});}}:new Response(encode(data()))});
 const pending=c.quote(input,{...options,signal:controller.signal});await reading.promise;controller.abort();
 await assert.rejects(promptly(pending),{name:'AbortError'});
 assert.equal(c.available(),true);assert.ok(await c.quote(input,options));assert.equal(attempts,2);
});

test('timeouts bound ignored fetch and body signals without disabling the other service action',async()=>{
 for(const phase of ['fetch','body']){
  const c=createServiceClient({base:'https://test.invalid',clock,quoteTimeout:5,fetchImpl:async url=>{
   if(url.endsWith('/balances'))return new Response(encode(balanceData()));
   return phase==='fetch'?new Promise(()=>{}):{ok:true,text:()=>new Promise(()=>{})};
  }});
  assert.equal(await promptly(c.quote(input,options)),null);assert.equal(c.available(),false);
  assert.deepEqual(await c.balances(a,balanceTokens),{balances:{b:42n},failed:[]});
 }
});

test('a late fetch rejection after cancellation is handled and does not affect the next quote',async()=>{
 let rejectLate,attempts=0;const controller=new AbortController();
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>++attempts===1?new Promise((_,reject)=>{rejectLate=reject;}):new Response(encode(data()))});
 const pending=c.quote(input,{...options,signal:controller.signal});controller.abort();
 await assert.rejects(promptly(pending),{name:'AbortError'});rejectLate(Error('late offline failure'));
 await new Promise(resolve=>setImmediate(resolve));assert.ok(await c.quote(input,options));assert.equal(attempts,2);
});

test('pre-aborted quote and balance requests reject without fetching, including unavailable services',async()=>{
 for(const base of ['https://test.invalid','']){
  let attempts=0;const controller=new AbortController();controller.abort(Error('superseded'));
  const c=createServiceClient({base,clock,fetchImpl:async()=>{attempts++;return new Response(encode(data()));}});
  await assert.rejects(c.quote(input,{...options,signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(c.balances(a,balanceTokens,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(attempts,0);
 }
});

test('canceling an active quote aborts its request and permits the next quote immediately',async()=>{
 const started=deferred(),controller=new AbortController();let attempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async(_,request)=>{
  if(++attempts>1)return new Response(encode(data()));
  return new Promise((_,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});started.resolve();});
 }});
 const pending=c.quote(input,{...options,signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});
 await started.promise;controller.abort();await rejected;
 assert.equal(c.available(),true);assert.ok(await c.quote(input,options));assert.equal(attempts,2);
});

test('a quote that ignores cancellation and returns late cannot become a result or trigger cooldown',async()=>{
 const response=deferred(),controller=new AbortController();let attempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>++attempts===1?response.promise:new Response(encode(data()))});
 const pending=c.quote(input,{...options,signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});
 controller.abort({code:'UNSAFE_QUOTE'});response.resolve(new Response(encode(data())));await rejected;
 assert.equal(c.available(),true);assert.ok(await c.quote(input,options));assert.equal(attempts,2);
});

test('cancellation while reading a quote body rejects even when the body read ignores its signal',async()=>{
 const reading=deferred(),body=deferred(),controller=new AbortController();let attempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>++attempts===1?{ok:true,text:()=>{reading.resolve();return body.promise;}}:new Response(encode(data()))});
 const pending=c.quote(input,{...options,signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});
 await reading.promise;controller.abort();body.resolve(encode(data()));await rejected;
 assert.ok(await c.quote(input,options));assert.equal(attempts,2);
});

test('caller cancellation takes precedence over a late business error',async()=>{
 const response=deferred(),controller=new AbortController();
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>response.promise});
 const pending=c.quote(input,{...options,signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});
 controller.abort();response.resolve(new Response(encode({error:'UNSAFE_QUOTE'}),{status:422}));await rejected;
 assert.equal(c.available(),true);
});

test('cancellation detected during response validation still rejects quote and balance results',async()=>{
 for(const action of ['quote','balances']){
  const controller=new AbortController();let validating=false;
  const c=createServiceClient({base:'https://test.invalid',clock:()=>{if(validating)controller.abort();return 10000;},fetchImpl:async()=>{validating=true;return new Response(encode(action==='quote'?data():balanceData()));}});
  const pending=action==='quote'?c.quote(input,{...options,signal:controller.signal}):c.balances(a,balanceTokens,{signal:controller.signal});
  await assert.rejects(pending,{name:'AbortError'});
 }
});

test('canceling a balance read does not start a balance or quote cooldown',async()=>{
 const response=deferred(),controller=new AbortController();let balanceAttempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async url=>url.endsWith('/quote')?new Response(encode(data())):++balanceAttempts===1?response.promise:new Response(encode(balanceData()))});
 const pending=c.balances(a,balanceTokens,{signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});
 controller.abort();response.resolve(new Response(encode(balanceData())));await rejected;
 assert.equal(c.available(),true);assert.ok(await c.quote(input,options));
 assert.deepEqual(await c.balances(a,balanceTokens),{balances:{b:42n},failed:[]});assert.equal(balanceAttempts,2);
});

test('quote timeout still falls back with cooldown while balances remain available',async()=>{
 let quoteAttempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,quoteTimeout:5,fetchImpl:async(url,request)=>{
  if(url.endsWith('/balances'))return new Response(encode(balanceData()));
  quoteAttempts++;return new Promise((_,reject)=>{const keepAlive=setTimeout(()=>reject(Error('timeout did not abort')),250);request.signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(request.signal.reason);},{once:true});});
 }});
 assert.equal(await c.quote(input,options),null);assert.equal(c.available(),false);
 assert.equal(await c.quote(input,options),null);assert.equal(quoteAttempts,1);
 assert.deepEqual(await c.balances(a,balanceTokens),{balances:{b:42n},failed:[]});
 const controller=new AbortController();controller.abort();
 await assert.rejects(c.quote(input,{...options,signal:controller.signal}),{name:'AbortError'});
});

test('balance failures do not disable quotes',async()=>{
 let balanceAttempts=0;
 const c=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async url=>{if(url.endsWith('/quote'))return new Response(encode(data()));balanceAttempts++;throw Error('offline');}});
 assert.equal(await c.balances(a,balanceTokens),null);assert.equal(await c.balances(a,balanceTokens),null);assert.equal(balanceAttempts,1);
 assert.equal(c.available(),true);assert.ok(await c.quote(input,options));
});
