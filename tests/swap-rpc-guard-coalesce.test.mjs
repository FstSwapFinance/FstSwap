import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadPool,createProbeScheduler} from '../server/fstswap-service.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function fixture(handler){
 let now=200000;const calls=[];
 const fetchImpl=async(url,options)=>{
  const payload=JSON.parse(options.body),call={url,payload,signal:options.signal};calls.push(call);
  const result=await handler(call,calls);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:payload.id,result}));
 };
 const pool=createReadPool(['https://private.example/never-log-this-key'],{fetchImpl,clock:()=>now});
 return{pool,calls,setNow:value=>{now=value;}};
}
const forced={operation:'quote',nodeId:'upstream-1'};
const block={number:'0x20',hash:'0x'+'ab'.repeat(32),timestamp:'0xc8'};

test('three concurrent same-node operations issue one physical chain guard',async()=>{
 const gate=deferred(),f=fixture(async()=>gate.promise),controllers=Array.from({length:3},()=>new AbortController());let executions=0;
 const running=controllers.map(c=>f.pool.run(()=>++executions,c.signal,forced));
 try{await flush();assert.equal(f.calls.length,1);assert.equal(executions,0);}
 finally{gate.resolve('0x38');await Promise.all(running);}
 assert.equal(executions,3);assert.equal(f.pool.health().providers[0].requests.eth_chainId.samples,1);
});

test('chain guard cache lasts ten seconds from its actual successful completion',async()=>{
 const gate=deferred();let guarded=0;
 const f=fixture(async()=>++guarded===1?gate.promise:'0x38');f.setNow(0);
 const running=f.pool.run(()=>true,new AbortController().signal,forced);await flush();f.setNow(9000);gate.resolve('0x38');await running;await flush();
 f.setNow(18999);await f.pool.run(()=>true,new AbortController().signal,forced);assert.equal(guarded,1);
 f.setNow(19000);await f.pool.run(()=>true,new AbortController().signal,forced);assert.equal(guarded,2);
});

test('canceling one consumer cannot abort a shared guard needed by another consumer',async()=>{
 const gate=deferred(),f=fixture(async()=>gate.promise),a=new AbortController(),b=new AbortController();
 const first=f.pool.run(()=>11,a.signal,forced).catch(e=>e),second=f.pool.run(()=>22,b.signal,forced);
 try{
  await flush();assert.equal(f.calls.length,1);a.abort();await flush();
  assert.equal((await first).code,'REQUEST_ABORTED');assert.equal(f.calls[0].signal.aborted,false);
 }finally{gate.resolve('0x38');await second;}
 assert.equal(await second,22);assert.equal(f.pool.health().providers[0].failures,0);
});

test('last-consumer cancellation aborts transport and a late success cannot populate the cache',async()=>{
 const gate=deferred();let guards=0,executions=0;
 const f=fixture(async()=>++guards===1?gate.promise:'0x38'),a=new AbortController(),b=new AbortController();
 const running=[a,b].map(c=>f.pool.run(()=>++executions,c.signal,forced).catch(e=>e));
 await flush();a.abort();b.abort();await Promise.all(running);await flush();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,true);assert.equal(executions,0);
 gate.resolve('0x38');await flush();
 assert.equal(f.pool.nodes[0].chainAt,0);assert.equal(await f.pool.run(()=>42,new AbortController().signal,forced),42);
 assert.equal(guards,2);assert.equal(f.pool.health().providers[0].failures,0);
});

test('a shared wrong-chain result blocks every operation and records one physical failure',async()=>{
 const gate=deferred(),f=fixture(async()=>gate.promise);let executions=0;
 const running=Array.from({length:3},()=>f.pool.run(()=>++executions,new AbortController().signal,forced).catch(e=>e));
 await flush();gate.resolve('0x61');const errors=await Promise.all(running);await flush();
 assert.equal(f.calls.length,1);assert.equal(executions,0);assert.ok(errors.every(e=>e.code==='WRONG_CHAIN'));
 const p=f.pool.health().providers[0];assert.equal(p.failures,1);assert.equal(p.totalFailures,1);assert.equal(p.ready,false);assert.equal(p.cooldownMs,10000);
 assert.doesNotMatch(JSON.stringify(errors.map(error=>({message:error.message,...error}))),/never-log-this-key|https:\/\//);
});

test('a shared transport failure is not multiplied by its number of consumers',async()=>{
 const gate=deferred(),f=fixture(async()=>{await gate.promise;throw Error('private transport URL must not leak');});
 const running=Array.from({length:3},()=>f.pool.run(()=>true,new AbortController().signal,forced).catch(e=>e));
 await flush();gate.resolve();const errors=await Promise.all(running);await flush();
 assert.equal(f.calls.length,1);assert.ok(errors.every(e=>e.code==='UPSTREAM_UNAVAILABLE'));
 const p=f.pool.health().providers[0];assert.equal(p.totalFailures,1);assert.equal(p.failures,1);assert.equal(p.requests.eth_chainId.failures,1);
});

test('a probe performs a fresh physical chain check even when the normal guard cache is valid',async()=>{
 let chain='0x38';const f=fixture(async call=>call.payload.method==='eth_chainId'?chain:call.payload.method==='eth_getBlockByNumber'?block:'0x'+18n.toString(16).padStart(64,'0'));
 await f.pool.run(()=>true,new AbortController().signal,forced);await flush();chain='0x61';
 await assert.rejects(f.pool.probe(),{code:'WRONG_CHAIN'});await flush();
 assert.deepEqual(f.calls.map(c=>c.payload.method),['eth_chainId','eth_chainId']);
 assert.equal(f.pool.health().providers[0].probeRequests.eth_chainId.samples,1);
});

test('foreground preemption during a probe guard cannot abort or overwrite its fresh foreground guard',async()=>{
 const gate=deferred();let guards=0;
 const f=fixture(async call=>call.payload.method==='eth_chainId'?(++guards===1?gate.promise:'0x38'):call.payload.method==='eth_getBlockByNumber'?block:'0x'+18n.toString(16).padStart(64,'0'));
 const probing=f.pool.probe().catch(e=>e);await flush();assert.equal(f.calls.length,1);
 const foreground=f.pool.run(()=>42,new AbortController().signal,forced);assert.equal(await foreground,42);await flush();
 assert.equal((await probing).code,'REQUEST_ABORTED');assert.equal(f.calls[0].signal.aborted,true);assert.equal(guards,2);
 gate.resolve('0x61');await flush();assert.equal(await f.pool.run(()=>43,new AbortController().signal,forced),43);
 assert.equal(guards,2);assert.equal(f.pool.health().providers[0].totalFailures,0);
});

test('dual role scheduling gives each role a probe slot every thirty-one seconds with one timer',async()=>{
 let now=0;const calls=[],intervals=[];
 const pool={probe:async()=>calls.push({role:'quote',at:now})},balancePool={probe:async()=>calls.push({role:'balances',at:now})};
 const scheduler=createProbeScheduler({pool,balancePool,timers:{setInterval(fn,ms){intervals.push({fn,ms});return{unref(){}};},clearInterval(){}}});
 scheduler.start();scheduler.start();assert.equal(intervals.length,1);assert.equal(intervals[0].ms,15500);
 for(let i=0;i<10;i++){now+=intervals[0].ms;await scheduler.tick();}
 for(const role of ['quote','balances']){const rows=calls.filter(c=>c.role===role);assert.equal(rows.length,5);for(let i=1;i<rows.length;i++)assert.equal(rows[i].at-rows[i-1].at,31000);}
 assert.equal(now,155000);scheduler.stop();
});

test('a shared role pool retains its original thirty-one-second timer and no duplicate initial probe',async()=>{
 const intervals=[];let count=0;
 const pool={probe:async()=>count++},scheduler=createProbeScheduler({pool,timers:{setInterval(fn,ms){intervals.push({fn,ms});return{unref(){}};},clearInterval(){}}});
 scheduler.start();assert.equal(intervals[0].ms,31000);await scheduler.initial();assert.equal(count,1);scheduler.stop();
});
