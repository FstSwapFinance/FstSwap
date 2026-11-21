import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadPool} from '../server/swap-read-pool.mjs';
import {createTimingScope} from '../server/swap-timing.mjs';
const block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x100'};
test('upstream timing counts physical HTTP and batch items without changing chain/header results',async()=>{
 const bodies=[],pool=createReadPool(['https://private.invalid/DO_NOT_EXPOSE'],{fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body);bodies.push(options.body);
  const reply=item=>({jsonrpc:'2.0',id:item.id,result:item.method==='eth_chainId'?'0x38':item.method==='eth_call'?'0x1234':block});
  return new Response(JSON.stringify(Array.isArray(body)?body.map(reply):reply(body)));
 }}),scope=createTimingScope();
 const result=await scope.run(()=>pool.run(async read=>{
  const header=await read({method:'eth_getBlockByNumber',params:['latest',false]});
  return{header,rows:await read.batch([{method:'eth_call',params:[{to:'0x'+'11'.repeat(20),data:'0x1234'},header.number]},{method:'eth_getBlockByNumber',params:[header.number,false]}])};
 },AbortSignal.timeout(3000)));
 assert.deepEqual(result,{header:block,rows:['0x1234',block]});
 const metrics=scope.snapshot();assert.equal(metrics.counts.rpc_http,3);assert.equal(metrics.counts.rpc_calls,4);assert.equal(metrics.counts.rpc_batches,1);
 assert.equal(metrics.counts.rpc_bytes,bodies.reduce((n,body)=>n+Buffer.byteLength(body),0));assert.ok(metrics.durations.rpc>=0);
 assert.doesNotMatch(scope.header(10),/private|DO_NOT_EXPOSE|https|0x/);
});
