import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadPool } from '../server/swap-read-pool.mjs';

const payload={method:'eth_call',params:[{data:'0x6000',gas:'0xb71b00'},'0x100']};

test('a rejected simulation falls back on the same verified node without penalizing ordinary quotes',async()=>{
 const sent=[];
 const pool=createReadPool(['https://simulation.invalid'],{fetchImpl:async(url,{body})=>{
  const item=JSON.parse(body);sent.push([url,item]);
  if(item.params[0]?.data)return Response.json({id:item.id,error:{code:-32602,message:'creation suppressed'}});
  return Response.json({id:item.id,result:item.method==='eth_chainId'?'0x38':'0x2a'});
 }});
 const quote=request=>request.quoteSimulation(payload).then(result=>result??request({method:'eth_call',params:[]}));
 assert.equal(await pool.run(quote),'0x2a');
 assert.equal(await pool.run(quote),'0x2a');
 assert.equal(sent.length,4,'a recent simulation rejection is not retried on the next quote');
 assert.ok(sent.every(([url])=>url==='https://simulation.invalid'));
 assert.equal(pool.health().providers[0].failures,0);
 assert.equal(pool.health().providers[0].requests.eth_call.successes,2);
});

test('an unusable successful response also suppresses the optional simulation briefly',async()=>{
 let simulations=0,now=1800000000000;
 const pool=createReadPool(['https://simulation.invalid'],{clock:()=>now,fetchImpl:async(_url,{body})=>{
  const item=JSON.parse(body);
  if(item.method==='eth_call')simulations++;
  return Response.json({id:item.id,result:item.method==='eth_chainId'?'0x38':'0x'});
 }});
 const quote=request=>request.quoteSimulation(payload,()=>null);
 assert.equal(await pool.run(quote),null);
 now+=1000;
 assert.equal(await pool.run(quote),null);assert.equal(simulations,1);
 now+=10000;
 assert.equal(await pool.run(quote),null);assert.equal(simulations,2);
});

test('node-wide rate limits are propagated instead of starting ordinary fallback on the same node',async()=>{
 let fallback=false;
 const pool=createReadPool(['https://simulation.invalid'],{fetchImpl:async(_url,{body})=>{
  const item=JSON.parse(body);
  if(item.method==='eth_chainId')return Response.json({id:item.id,result:'0x38'});
  return Response.json({}, {status:429,headers:{'retry-after':'5'}});
 }});
 await assert.rejects(pool.run(async request=>{
  const output=await request.quoteSimulation(payload);
  if(output===null)fallback=true;
 }),{code:'UPSTREAM_RATE_LIMIT'});
 assert.equal(fallback,false);
 assert.ok(pool.health().providers[0].cooldownMs>0);
});

test('canceling an in-flight simulation cancels its transport without starting fallback reads',async()=>{
 let notify;
 const started=new Promise(resolve=>{notify=resolve;});
 const controller=new AbortController();let fallback=false;
 const pool=createReadPool(['https://simulation.invalid'],{fetchImpl:async(_url,{body,signal})=>{
  const item=JSON.parse(body);
  if(item.method==='eth_chainId')return Response.json({id:item.id,result:'0x38'});
  notify(signal);
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }});
 const pending=pool.run(async request=>{
  const result=await request.quoteSimulation(payload);
  if(result===null)fallback=true;
 },controller.signal);
 pending.catch(()=>notify(null));
 const signal=await started;
 assert.ok(signal,'the read-only simulation transport must be attached');
 controller.abort();
 await assert.rejects(pending,{code:'REQUEST_ABORTED'});
 assert.equal(signal.aborted,true);assert.equal(fallback,false);
});
