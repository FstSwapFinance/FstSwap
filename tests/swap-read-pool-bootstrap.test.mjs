import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadPool} from '../server/swap-read-pool.mjs';

const block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x6b49d200'};
const latest={method:'eth_getBlockByNumber',params:['latest',false]};
const gate=()=>{let release;return{promise:new Promise(resolve=>release=resolve),release};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{chain='0x38',unsupported=false,held=false,headerDelayMs=0}={}){
 let now=1800000000000;const http=[],pending=gate(),started=gate();
 t.after(pending.release);
 const pool=createReadPool(['https://bootstrap.invalid'],{clock:()=>now,fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body);http.push({body,signal:options.signal});
  if(held&&http.length===1){started.release();await pending.promise;}
  if(unsupported&&Array.isArray(body))return new Response('{}',{status:400});
  if(body.method==='eth_getBlockByNumber')now+=headerDelayMs;
  const reply=item=>({jsonrpc:'2.0',id:item.id,result:item.method==='eth_chainId'?chain:{...block}});
  return new Response(JSON.stringify(Array.isArray(body)?body.map(reply).reverse():reply(body)));
 }});
 return{pool,http,pending,started,now:()=>now,advance:ms=>now+=ms};
}
const run=(f,options={},signal=new AbortController().signal)=>f.pool.run((_request,node,_active,bootstrap)=>({nodeId:node.id,bootstrap}),signal,options);

test('an opted-in cold attempt batches chain verification and its exact latest bootstrap on one HTTP request',async t=>{
 const f=fixture(t),startedAt=f.now(),result=await run(f,{bootstrapLatest:true});
 assert.equal(f.http.length,1);
 assert.equal(Array.isArray(f.http[0].body),true,'cold bootstrap must combine chain and header in one HTTP batch');
 assert.deepEqual(f.http[0].body.map(item=>item.method),['eth_chainId','eth_getBlockByNumber']);
 assert.deepEqual(result,{nodeId:'upstream-1',bootstrap:{block,observedAt:startedAt}});
 assert.equal(Object.isFrozen(result.bootstrap),true);assert.equal(Object.isFrozen(result.bootstrap.block),true);
});

test('bootstrap observation starts before the physical RPC and cannot be renewed on slow completion',async t=>{
 const f=fixture(t,{held:true}),initial=f.now(),work=run(f,{bootstrapLatest:true});await f.started.promise;
 f.advance(1000);f.pending.release();const result=await work;
 assert.ok(result.bootstrap,'the operation receives its completed bootstrap header');
 assert.equal(result.bootstrap.observedAt,initial);assert.equal(f.now()-result.bootstrap.observedAt,1000);
});

test('a warm chain proof obtains only a requested new latest header while false opt-in sends none',async t=>{
 const f=fixture(t);await run(f);assert.equal(f.http.length,1);
 const second=await run(f,{bootstrapLatest:({id})=>id==='upstream-1'});
 assert.equal(f.http.length,2);assert.deepEqual(f.http[1].body.method,'eth_getBlockByNumber');assert.deepEqual(second.bootstrap.block,block);
 const third=await run(f,{bootstrapLatest:()=>false});assert.equal(f.http.length,2);assert.equal(third.bootstrap,null);
});

test('an opted-in shared guard preserves another consumer when its first consumer cancels',async t=>{
 const f=fixture(t,{held:true}),a=new AbortController(),b=new AbortController();
 const one=run(f,{bootstrapLatest:true},a.signal);one.catch(()=>{});await f.started.promise;
 const two=run(f,{bootstrapLatest:true},b.signal);await turn();a.abort();await assert.rejects(one,{code:'REQUEST_ABORTED'});
 assert.equal(f.http[0].signal.aborted,false,'the second operation still owns the physical shared guard');
 f.pending.release();const result=await two;assert.equal(f.http.length,1);assert.deepEqual(result.bootstrap.block,block);
});

test('a normal guard joined by an opted-in caller shares the guard but not an unfinished latest read',async t=>{
 const f=fixture(t,{held:true}),ordinary=run(f);await f.started.promise;
 const opted=run(f,{bootstrapLatest:true});await turn();f.pending.release();
 const [first,second]=await Promise.all([ordinary,opted]);
 assert.equal(first.bootstrap,null);assert.deepEqual(second.bootstrap.block,block);assert.equal(f.http.length,2);
 assert.equal(Array.isArray(f.http[0].body),false);assert.equal(f.http[1].body.method,'eth_getBlockByNumber');
});

test('a wrong-chain bootstrap cannot execute the operation or grant successful health',async t=>{
 const f=fixture(t,{chain:'0x1'});let executed=false;
 await assert.rejects(f.pool.run(()=>{executed=true;},new AbortController().signal,{bootstrapLatest:true}),{code:'WRONG_CHAIN'});
 assert.equal(executed,false);assert.equal(f.http.length,1);assert.equal(Array.isArray(f.http[0].body),true);
 assert.equal(f.pool.health().providers[0].ready,false);assert.equal(f.pool.health().providers[0].successes,0);
});

test('a wrong-chain bootstrap header cannot contaminate healthy provider head lag or selection',async()=>{
 const pool=createReadPool(['https://wrong.invalid','https://right.invalid'],{clock:()=>1800000000000,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body),wrong=url==='https://wrong.invalid';
  return new Response(JSON.stringify(body.map(item=>({jsonrpc:'2.0',id:item.id,result:item.method==='eth_chainId'?(wrong?'0x1':'0x38'):{...block,number:wrong?'0x900':'0x100'}}))));
 }});
 const result=await pool.run((_r,node,_s,bootstrap)=>({id:node.id,bootstrap}),new AbortController().signal,{bootstrapLatest:true});
 assert.equal(result.id,'upstream-2');assert.equal(result.bootstrap.block.number,'0x100');
 const [wrong,right]=pool.health().providers;
 assert.equal(wrong.headObservedAt,null,'an unverified chain cannot publish a head observation');
 assert.equal(right.headLag,null,'without a valid peer there is no lag evidence against the verified provider');
});

test('batch rejection falls back to independent chain and header reads without provider failure',async t=>{
 const f=fixture(t,{unsupported:true}),result=await run(f,{bootstrapLatest:true});
 assert.ok(result.bootstrap,'batch rejection still returns a freshly read header');
 assert.deepEqual(result.bootstrap.block,block);assert.equal(f.http.length,3);
 assert.deepEqual(f.http.slice(1).map(call=>call.body.method),['eth_chainId','eth_getBlockByNumber']);
 assert.equal(f.pool.health().providers[0].failures,0);
 f.advance(10000);await run(f,{bootstrapLatest:true});assert.equal(f.http.length,5,'known unsupported batching never adds another failed HTTP request');
});

test('a slow unsupported-batch header cannot extend the original ten-second chain verification window',async t=>{
 const f=fixture(t,{unsupported:true,headerDelayMs:9000});await run(f,{bootstrapLatest:true});
 assert.equal(f.now(),1800000009000);f.advance(1000);await run(f);
 assert.equal(f.http.filter(call=>!Array.isArray(call.body)&&call.body.method==='eth_chainId').length,2,'the chain proof expires from its completed verification before the slow header');
});

test('canceling the last opted-in guard consumer prevents late bootstrap and chain-proof publication',async t=>{
 const f=fixture(t,{held:true}),controller=new AbortController(),work=run(f,{bootstrapLatest:true},controller.signal);work.catch(()=>{});await f.started.promise;
 controller.abort();await assert.rejects(work,{code:'REQUEST_ABORTED'});assert.equal(f.http[0].signal.aborted,true);
 f.pending.release();await turn();const next=await run(f,{bootstrapLatest:true});
 assert.equal(f.http.length,2);assert.equal(Array.isArray(f.http[1].body),true);assert.deepEqual(next.bootstrap.block,block);
});
