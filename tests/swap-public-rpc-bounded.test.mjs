import test from 'node:test';
import assert from 'node:assert/strict';

let identity=0;
async function fixture({override=true,hostname='audit.invalid',attempts=2}={}){
 const savedOverride=globalThis.FST_RPC_OVERRIDE,savedLocation=globalThis.location;
 if(override)globalThis.FST_RPC_OVERRIDE=['https://audit-a.invalid','https://audit-b.invalid','https://audit-c.invalid'];
 else delete globalThis.FST_RPC_OVERRIDE;
 globalThis.location={hostname};
 const module=await import('../src/swap-aggregator.mjs?rpc-budget-audit='+ ++identity),calls=[];
 let respond=()=>{throw Error('offline');};
 const fetchImpl=async(endpoint,options)=>{
  const body=JSON.parse(options.body);calls.push({endpoint,body,signal:options.signal});
  const result=await respond(endpoint,body,options.signal);
  return{ok:true,json:async()=>({id:body.id,result})};
 };
 return{calls,module,read:module.swapPublicRpc(fetchImpl,undefined,{attempts,timeoutMs:1000}),fetchImpl,
  respond(value){respond=value;},
  cleanup(){if(savedOverride===undefined)delete globalThis.FST_RPC_OVERRIDE;else globalThis.FST_RPC_OVERRIDE=savedOverride;if(savedLocation===undefined)delete globalThis.location;else globalThis.location=savedLocation;}};
}

test('a failed public read attempts each endpoint once within the physical budget',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.read({method:'eth_blockNumber'}));
  assert.equal(f.calls.length,2);assert.equal(new Set(f.calls.map(c=>c.endpoint)).size,2);
 }finally{f.cleanup();}
});
test('lastGood affinity consumes a physical attempt instead of adding one above the budget',async()=>{
 const f=await fixture();try{
  f.respond(()=> '0x38');await f.read({method:'eth_chainId'});
  f.calls.length=0;f.respond(()=>{throw Error('offline');});
  await assert.rejects(f.read({method:'eth_blockNumber'}));
  assert.equal(f.calls.length,2);assert.equal(new Set(f.calls.map(c=>c.endpoint)).size,2);
  assert.equal(f.calls[0].endpoint,'https://audit-a.invalid');
 }finally{f.cleanup();}
});
test('all cooling endpoints can be probed on a later call without duplicate attempts or deadlock',async()=>{
 const f=await fixture({attempts:3});try{
  await assert.rejects(f.read({method:'eth_blockNumber'}));f.calls.length=0;
  await assert.rejects(f.read({method:'eth_blockNumber'}));
  assert.ok(f.calls.length>0);assert.ok(f.calls.length<=3);assert.equal(new Set(f.calls.map(c=>c.endpoint)).size,f.calls.length);
 }finally{f.cleanup();}
});
test('cooling candidates do not consume healthy-attempt capacity or get retried after a live failure',async()=>{
 const f=await fixture({attempts:2});try{
  await assert.rejects(f.read({method:'eth_blockNumber'}));f.calls.length=0;
  f.respond(endpoint=>endpoint==='https://audit-c.invalid'?'0x3':Promise.reject(Error('cooling endpoint must stay skipped')));
  assert.equal(await f.read({method:'eth_blockNumber'}),'0x3');assert.equal(f.calls.length,1);assert.equal(f.calls[0].endpoint,'https://audit-c.invalid');
 }finally{f.cleanup();}
});
test('a missing transaction checks bounded alternate endpoints and never resends',async()=>{
 const f=await fixture();try{
  f.respond(endpoint=>endpoint==='https://audit-a.invalid'?null:{hash:'0x'+'11'.repeat(32)});
  const tx=await f.read({method:'eth_getTransactionByHash',params:['0x'+'11'.repeat(32)]});
  assert.equal(tx.hash,'0x'+'11'.repeat(32));assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(c=>c.body.method==='eth_getTransactionByHash'));
 }finally{f.cleanup();}
});
test('all-null receipts return null after the physical budget without proxy or retries',async()=>{
 const f=await fixture({override:false,hostname:'127.0.0.1'});try{
  f.respond(()=>null);assert.equal(await f.read({method:'eth_getTransactionReceipt',params:['0x'+'11'.repeat(32)]}),null);
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.endpoint!=='http://127.0.0.1:8126/rpc'));
 }finally{f.cleanup();}
});
test('local credential proxy remains one final fallback without repeating failed public endpoints',async()=>{
 const f=await fixture({override:false,hostname:'127.0.0.1'});try{
  await assert.rejects(f.read({method:'eth_blockNumber'}));
  const publicCalls=f.calls.filter(c=>c.endpoint!=='http://127.0.0.1:8126/rpc'),proxy=f.calls.filter(c=>c.endpoint==='http://127.0.0.1:8126/rpc');
  assert.equal(publicCalls.length,2);assert.equal(new Set(publicCalls.map(c=>c.endpoint)).size,2);assert.equal(proxy.length,1);
  f.calls.length=0;f.respond(endpoint=>{if(endpoint==='http://127.0.0.1:8126/rpc')return'0x4';throw Error('offline');});
  assert.equal(await f.read({method:'eth_blockNumber'}),'0x4');assert.equal(f.calls.at(-1).endpoint,'http://127.0.0.1:8126/rpc');
 }finally{f.cleanup();}
});
test('an aborted physical public call cannot launch another endpoint or a local proxy',async()=>{
 const f=await fixture({override:false,hostname:'127.0.0.1'}),controller=new AbortController();
 try{
  f.respond(()=>new Promise(()=>{}));const read=f.module.swapPublicRpc(f.fetchImpl,controller.signal,{attempts:2,timeoutMs:1000});
  const job=read({method:'eth_blockNumber'}),rejected=assert.rejects(job,{name:'AbortError'});controller.abort();await rejected;
  assert.equal(f.calls.length,1);
 }finally{f.cleanup();}
});
