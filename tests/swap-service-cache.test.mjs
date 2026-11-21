import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceClient,validateServiceQuote} from '../src/swap-service-client.mjs';

const U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const W='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',A='0x'+'aa'.repeat(20),R='0x'+'11'.repeat(20),P='0x'+'22'.repeat(20),POOL='0x'+'44'.repeat(20);
const input={tokenIn:U,tokenOut:F,amountIn:10000n,slippageBps:50,singleHop:false};
const options={router:R,adapters:{pancake:{adapter:P,router:A,weth:W,v3:false}}};
const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$bigint:String(x)}:x);
const response=(data,status=200)=>new Response(encode(data),{status});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function quote({at=10000,request=input,out=20000n}={}){
 const amount=BigInt(request.amountIn),fee=amount*30n/10000n,min=out*(10000n-BigInt(request.slippageBps))/10000n;
 const leg={adapter:P,kind:'v2',path:[request.tokenIn,request.tokenOut],tokenIn:request.tokenIn,tokenOut:request.tokenOut,amountIn:amount-fee,out,weightBps:10000,poolIds:[POOL]};
 const stage={tokenIn:request.tokenIn,tokenOut:request.tokenOut,out,legs:[leg]};
 return{schema:1,chainId:56,router:R,input:{chainId:56,...request,amountIn:String(amount)},blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:at,expiresAt:at+15000,
  config:{version:'2.1.0',platformFeeBps:30,feeReceiver:A,wbnb:W,defaultFeeToken:U,feeConfigVersion:5n,adaptersOff:[]},
  quote:{kind:'fstswap',tokenIn:request.tokenIn,tokenOut:request.tokenOut,amountIn:amount,out,minimum:min,lpFee:fee,feeToken:request.tokenIn,feeMode:'input',configVersion:5n,impact:0,poolCheckedAt:at,
   stages:[{tokenIn:request.tokenIn,tokenOut:request.tokenOut,minOut:min,branches:[{adapter:P,kind:0,weightBps:10000,path:[request.tokenIn,request.tokenOut],v3Path:'0x'}]}],
   segments:[{from:request.tokenIn,to:request.tokenOut,amountIn:amount-fee,out,minimum:min,impact:0,legs:[leg],routeStages:[stage]}]}};
}
function harness(fetchImpl,{start=10000,...config}={}){
 let now=start,attempts=0;
 const client=createServiceClient({base:'https://test.invalid',clock:()=>now,expectedVersion:'2.1.0',...config,fetchImpl:async(...args)=>{attempts++;return fetchImpl(...args);}});
 return{client,get attempts(){return attempts;},get now(){return now;},set now(value){now=value;}};
}

test('cache fixture is a fully validated 2.1 staged quote',()=>{
 assert.ok(validateServiceQuote(quote(),{chainId:56,...input,amountIn:String(input.amountIn)},{...options,clock:()=>10000,expectedVersion:'2.1.0'}));
});

test('identical completed quotes reuse one request for less than 2 seconds without renewing timestamps',async()=>{
 const h=harness(async()=>response(quote()));
 const first=await h.client.quote(input,options);h.now=11999;
 const hit=await h.client.quote(input,options);
 assert.equal(h.attempts,1);assert.equal(hit.expiresAt,first.expiresAt);assert.equal(hit.quotedAt,first.quotedAt);assert.equal(hit.quote.poolCheckedAt,first.quote.poolCheckedAt);
 h.now=12000;assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,2);
});

test('completed cache age begins at response completion and never slides on hits',async()=>{
 const gate=deferred(),h=harness(async()=>h.attempts===1?gate.promise:response(quote({at:h.now})));
 const pending=h.client.quote(input,options);h.now=13000;gate.resolve(response(quote({at:13000})));await pending;
 h.now=14999;assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,1);
 h.now=15000;assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,2);
});

test('original pool expiry beats the 2 second cache and triggers a new validated quote',async()=>{
 const h=harness(async()=>response(quote({at:h.attempts===1?5000:h.now})),{start:19500});
 const first=await h.client.quote(input,options);assert.equal(first.expiresAt,20000);
 h.now=19999;assert.equal((await h.client.quote(input,options)).expiresAt,20000);assert.equal(h.attempts,1);
 h.now=20000;const next=await h.client.quote(input,options);assert.equal(h.attempts,2);assert.equal(next.quote.poolCheckedAt,20000);assert.equal(next.expiresAt,35000);
});

test('cached DTO is independently cloned before first delivery and every later hit',async()=>{
 const h=harness(async()=>response(quote())),first=await h.client.quote(input,options);
 first.quote.out=1n;first.quote.stages[0].branches[0].path[0]=A;first.config.adaptersOff.push('pancake');first.quote.serviceMeta={nested:true};
 const second=await h.client.quote(input,options);assert.equal(second.quote.out,20000n);assert.equal(second.quote.stages[0].branches[0].path[0],U);assert.deepEqual(second.config.adaptersOff,[]);assert.equal(second.quote.serviceMeta,undefined);
 second.quote.segments[0].legs[0].poolIds[0]=A;const third=await h.client.quote(input,options);assert.equal(third.quote.segments[0].legs[0].poolIds[0],POOL);assert.equal(h.attempts,1);
});

test('every input and adapter deployment field and router isolates completed cache keys',async()=>{
 for(const change of [
  (i,o)=>i.tokenIn=W,(i,o)=>i.tokenOut=C,(i,o)=>i.amountIn++,(i,o)=>i.slippageBps=0,(i,o)=>i.singleHop=true,
  (i,o)=>o.router=A,(i,o)=>o.adapters.pancake.adapter=A,(i,o)=>o.adapters.pancake.router=R,(i,o)=>o.adapters.pancake.weth=U,(i,o)=>o.adapters.pancake.v3=true,
 ]){
  const h=harness(async(_,request)=>response(quote({request:JSON.parse(request.body)})));
  assert.ok(await h.client.quote(input,options));const nextInput=structuredClone(input),nextOptions=structuredClone(options);change(nextInput,nextOptions);
  await h.client.quote(nextInput,nextOptions);assert.equal(h.attempts,2,change.toString());
 }
});

test('equivalent input casing and reordered adapter properties share a key',async()=>{
 const h=harness(async()=>response(quote()));await h.client.quote(input,options);
 const same={router:R,adapters:{pancake:{v3:false,weth:W,router:A,adapter:P}}};
 assert.ok(await h.client.quote({...input,tokenIn:U.toUpperCase().replace('0X','0x')},same));assert.equal(h.attempts,1);
});

test('fixed expectedVersion remains enforced and cannot be overridden per call',async()=>{
 const h=harness(async()=>response(quote()),{expectedVersion:'2.0.0'});
 assert.equal(await h.client.quote(input,{...options,expectedVersion:'2.1.0'}),null);assert.equal(h.client.available(),false);
});

test('caller mutation after dispatch cannot alter validation inputs or adapter snapshots',async()=>{
 const gate=deferred(),h=harness(async()=>gate.promise),localInput=structuredClone(input),localOptions=structuredClone(options);
 const pending=h.client.quote(localInput,localOptions);localInput.amountIn=1n;localOptions.adapters.pancake.adapter=A;
 gate.resolve(response(quote()));assert.ok(await pending);assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,1);
 assert.equal(await h.client.quote(input,localOptions),null);assert.equal(h.attempts,2);
});

test('simultaneous identical calls share one network operation but receive independent DTOs',async()=>{
 const gate=deferred(),h=harness(async()=>gate.promise);
 const a=h.client.quote(input,options),b=h.client.quote(input,options);assert.equal(h.attempts,1);gate.resolve(response(quote()));
 const [first,second]=await Promise.all([a,b]);assert.notEqual(first,second);first.quote.stages[0].branches[0].path[0]=A;assert.equal(second.quote.stages[0].branches[0].path[0],U);
});

test('one subscriber cancellation never aborts or rejects the other subscriber',async()=>{
 const gate=deferred(),firstController=new AbortController();let networkSignal;
 const h=harness(async(_,request)=>{networkSignal=request.signal;return gate.promise;});
 const first=h.client.quote(input,{...options,signal:firstController.signal}),second=h.client.quote(input,options);
 const canceled=assert.rejects(first,{name:'AbortError'});firstController.abort();await canceled;
 assert.equal(h.attempts,1);assert.equal(networkSignal.aborted,false);gate.resolve(response(quote()));assert.ok(await second);assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,1);
});

test('the final subscriber cancellation aborts underlying work and late data cannot overwrite a retry',async()=>{
 const gate=deferred(),a=new AbortController(),b=new AbortController();let networkSignal;
 const h=harness(async(_,request)=>{if(h.attempts>1)return response(quote({out:30000n}));networkSignal=request.signal;return gate.promise;});
 const first=h.client.quote(input,{...options,signal:a.signal}),second=h.client.quote(input,{...options,signal:b.signal});
 const canceled=Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
 a.abort();assert.equal(networkSignal.aborted,false);b.abort();await canceled;assert.equal(networkSignal.aborted,true);assert.equal(h.client.available(),true);
 assert.equal((await h.client.quote(input,options)).quote.out,30000n);gate.resolve(response(quote()));await tick();
 assert.equal((await h.client.quote(input,options)).quote.out,30000n);assert.equal(h.attempts,2);
});

test('fresh calls always request the backend and may publish a newly completed display quote',async()=>{
 const h=harness(async()=>response(quote({out:BigInt(20000+h.attempts)})));
 const initial=await h.client.quote(input,options),fresh=await h.client.quote(input,{...options,fresh:true});
 assert.equal(h.attempts,2);assert.notEqual(fresh.quote.out,initial.quote.out);
 assert.equal((await h.client.quote(input,options)).quote.out,fresh.quote.out);assert.equal(h.attempts,2);
 await h.client.quote(input,{...options,fresh:true});assert.equal(h.attempts,3);
});

test('fresh bypasses completed data but shares the current pending read with independent DTO delivery',async()=>{
 const old=deferred(),h=harness(async()=>old.promise);
 const pending=h.client.quote(input,options),fresh=h.client.quote(input,{...options,fresh:true});
 assert.equal(h.attempts,1,'a fresh display bypass must not duplicate the identical in-flight chain read');
 old.resolve(response(quote({out:30000n})));const[first,second]=await Promise.all([pending,fresh]);
 assert.equal(first.quote.out,30000n);assert.equal(second.quote.out,30000n);assert.notEqual(first,second);
 first.quote.out=1n;assert.equal(second.quote.out,30000n);
 assert.equal((await h.client.quote(input,options)).quote.out,30000n);assert.equal(h.attempts,1);
});

test('fresh subscribers share pending work and abandoning all blocks old cache publication',async()=>{
 const old=deferred(),a=new AbortController(),b=new AbortController();
 const h=harness(async()=>h.attempts===1?old.promise:response(quote({out:40000n})));
 const first=h.client.quote(input,{...options,fresh:true,signal:a.signal}),second=h.client.quote(input,{...options,fresh:true,signal:b.signal});
 assert.equal(h.attempts,1);const canceled=Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
 a.abort();b.abort();await canceled;
 assert.equal((await h.client.quote(input,{...options,fresh:true})).quote.out,40000n);assert.equal(h.attempts,2);
 old.resolve(response(quote({out:30000n})));await tick();
 assert.equal((await h.client.quote(input,options)).quote.out,40000n);assert.equal(h.attempts,2);
});

test('business errors are never cached, and a fresh business error invalidates the old display entry',async()=>{
 for(const error of ['NO_ROUTE','NO_FEE_ROUTE','UNSAFE_QUOTE','PRICE_IMPACT_TOO_HIGH','POOL_LIQUIDITY']){
  const h=harness(async()=>h.attempts===1?response(quote()):h.attempts===2?response({error,reason:'data'},422):response(quote({out:30000n})));
  await h.client.quote(input,options);await assert.rejects(h.client.quote(input,{...options,fresh:true}),{code:error});
  assert.equal((await h.client.quote(input,options)).quote.out,30000n);assert.equal(h.attempts,3);
 }
});

test('failed validation and network timeouts do not return an old cached display quote',async()=>{
 for(const failure of ['validation','network']){
  const h=harness(async()=>{if(h.attempts===1)return response(quote());if(failure==='network')throw Error('offline');const invalid=quote();invalid.quote.stages[0].minOut=1n;return response(invalid);});
  await h.client.quote(input,options);assert.equal(await h.client.quote(input,{...options,fresh:true}),null);
  assert.equal(await h.client.quote(input,options),null);assert.equal(h.attempts,2);assert.equal(h.client.available(),false);
 }
});

test('cache capacity is bounded and the least recently used completed entry is evicted',async()=>{
 const h=harness(async(_,request)=>response(quote({request:JSON.parse(request.body)})));
 for(let n=0;n<32;n++)assert.ok(await h.client.quote({...input,amountIn:10000n+BigInt(n)},options));
 assert.equal(h.attempts,32);assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,32);
 await h.client.quote({...input,amountIn:20000n},options);assert.equal(h.attempts,33);
 await h.client.quote({...input,amountIn:10001n},options);assert.equal(h.attempts,34);
});

test('clock rollback evicts completed data and a pre-aborted cache hit always rejects',async()=>{
 const h=harness(async()=>response(quote()));await h.client.quote(input,options);
 const controller=new AbortController();controller.abort();await assert.rejects(h.client.quote(input,{...options,signal:controller.signal}),{name:'AbortError'});assert.equal(h.attempts,1);
 h.now=9999;assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,2);
});

test('cancellation during cached revalidation rejects without renewing or returning the entry',async()=>{
 let now=10000,checking=false,attempts=0;const controller=new AbortController();
 const client=createServiceClient({base:'https://test.invalid',clock:()=>{if(checking)controller.abort();return now;},expectedVersion:'2.1.0',fetchImpl:async()=>{attempts++;return response(quote());}});
 await client.quote(input,options);checking=true;await assert.rejects(client.quote(input,{...options,signal:controller.signal}),{name:'AbortError'});checking=false;
 assert.ok(await client.quote(input,options));assert.equal(attempts,1);
});

test('canceling immediately after a cached call rejects before its microtask delivery',async()=>{
 const h=harness(async()=>response(quote()));await h.client.quote(input,options);
 const controller=new AbortController(),pending=h.client.quote(input,{...options,signal:controller.signal});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.ok(await h.client.quote(input,options));assert.equal(h.attempts,1);
});

test('expiry that passes before cached microtask delivery triggers a new request',async()=>{
 const h=harness(async()=>response(quote({at:h.attempts===1?5000:h.now})),{start:19999});await h.client.quote(input,options);
 const pending=h.client.quote(input,options);h.now=20000;
 assert.equal((await pending).expiresAt,35000);assert.equal(h.attempts,2);
});

for(const failure of ['validation','http'])test('an abandoned older '+failure+' failure cannot disable a successful newer refresh',async()=>{
 const old=deferred(),controller=new AbortController(),h=harness(async()=>h.attempts===1?old.promise:response(quote({out:30000n})));
 const pending=h.client.quote(input,{...options,signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
 controller.abort();await rejected;
 const fresh=await h.client.quote(input,{...options,fresh:true});assert.equal(fresh.quote.out,30000n);
 const invalid=quote();invalid.quote.stages[0].minOut=1n;
 old.resolve(failure==='http'?response({error:'SERVICE_UNAVAILABLE'},503):response(invalid));await tick();
 assert.equal(h.client.available(),true);assert.equal((await h.client.quote(input,options)).quote.out,30000n);assert.equal(h.attempts,2);
});

test('adapter lookup order stays isolated when duplicate deployment addresses have different categories',async()=>{
 const pancake={adapter:P,router:A,weth:W,v3:false},v3={...pancake,v3:true};
 const good={router:R,adapters:{pancake,v3}},bad={router:R,adapters:{v3,pancake}};
 assert.ok(validateServiceQuote(quote(),{chainId:56,...input,amountIn:String(input.amountIn)},{...good,clock:()=>10000,expectedVersion:'2.1.0'}));
 assert.throws(()=>validateServiceQuote(quote(),{chainId:56,...input,amountIn:String(input.amountIn)},{...bad,clock:()=>10000,expectedVersion:'2.1.0'}));
 const gate=deferred(),h=harness(async()=>{await gate.promise;return response(quote());});
 const first=h.client.quote(input,good),second=h.client.quote(input,bad);gate.resolve();
 assert.ok(await first);assert.equal(await second,null);assert.equal(h.attempts,2);
});
