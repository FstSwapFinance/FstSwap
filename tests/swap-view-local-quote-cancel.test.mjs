import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {acceptQuoteResult} from '../src/swap-display.mjs';
const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const start=source.indexOf('  async function refreshQuote('),end=source.indexOf('  // Public-only submission preparation.',start);
const controllerSource=source.slice(start,end),tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function fixture(){
 const gate=deferred(),configGate=deferred(),controller=new AbortController(),events=[],cache=[],timers=[];
 const tokenIn={address:'0x'+'11'.repeat(20),decimals:18,key:'usdt'},tokenOut={address:'0x'+'22'.repeat(20),decimals:18,key:'fist'};
 const config={version:'2.1.0',platformFeeBps:30,defaultFeeToken:tokenIn.address};
 const q={amountIn:1n,out:1n,minimum:1n,poolCheckedAt:Date.now(),assertFresh(){}};
 let blockConfig=false;
 const context={Date,JSON,Number,Math,console,Promise,acceptQuoteResult,AbortController,AbortSignal,DOMException,globalThis:{fetch:()=>{}},
  clearTimeout(){},setTimeout(fn){timers.push(fn);return timers.length;},
  state:{seq:0,amount:'1',quote:null},settings:{slippageBps:50,singleHop:false},main:{isConnected:true},
  cancelSubmissionWarm(){},inT:()=>tokenIn,outT:()=>tokenOut,swapUnits:()=>1n,refreshAllowance:async()=>{},renderBottom(){},render(){},
  swapService:{quote:async()=>null},swapActiveRouter:()=>tokenIn.address,SWAP_ADAPTERS:{},
  quoteContext:{config:async()=>{events.push('config');if(blockConfig)await configGate.promise;cache.push('shared-config');return config;}},
  swapFeePolicy:()=>({mode:'input',token:tokenIn.address}),TOKENS:{usdt:tokenIn},BPS:10000n,ZERO:'0x'+'00'.repeat(20),feeBpsNow:()=>30,
  request:async p=>{events.push('unscoped:'+p.method);return'0x';},
  swapPublicRpc(_fetch,signal){return async p=>{if(signal?.aborted)throw new DOMException('canceled','AbortError');events.push('scoped:'+p.method);await gate.promise;if(signal?.aborted)throw new DOMException('canceled','AbortError');return'0x';};},
  quoteFstSwap:async read=>{await read({method:'policy'});await gate.promise;await read({method:'route'});cache.push('local-quote');return q;},
  resolveFeeAsset:()=>tokenIn,assertQuoteSafety(){},minOut:value=>value.minimum,otherBalances:{schedule(){}},queueSubmissionWarm(){},quoteExpiryTimer:null,scheduleQuote(){},
  swapV10Ready:()=>true,SWAP_V10_MISSING:{code:'MISSING'},isAggPair:()=>false};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function quoteNow('),source.indexOf('export function openTokenPicker(')),context);
 vm.runInContext(controllerSource,context);
 return{context,controller,events,cache,gate,configGate,q,config,tokenIn,tokenOut,blockConfig(){blockConfig=true;},run:()=>context.refreshQuote({signal:controller.signal})};
}
test('canceling a local fallback aborts its in-flight read and never starts another route, caches a quote or publishes',async()=>{
 const f=fixture(),job=f.run();await tick();f.controller.abort();f.context.state.seq++;f.gate.resolve();await job;
 assert.deepEqual(f.events,['config','scoped:policy']);assert.deepEqual(f.cache,['shared-config']);assert.equal(f.context.state.quote,null);
});
test('canceling this config consumer detaches promptly while independent shared config can complete',async()=>{
 const f=fixture();f.blockConfig();let finished=false;const job=f.run().then(()=>{finished=true;});await tick();f.controller.abort();await tick();
 assert.equal(finished,true,'this canceled quote must not wait for a shared config transport');assert.deepEqual(f.events,['config']);
 f.configGate.resolve();await job;await tick();assert.deepEqual(f.cache,['shared-config']);assert.equal(f.context.state.quote,null);
});
test('a superseded local quote with no external abort still cannot start the next route or publish',async()=>{
 const f=fixture(),job=f.run();await tick();f.context.state.seq++;f.gate.resolve();await job;
 assert.deepEqual(f.events,['config','scoped:policy']);assert.deepEqual(f.cache,['shared-config']);assert.equal(f.context.state.quote,null);
});
test('an active local quote still completes validation and publishes without modifying its expiry',async()=>{
 const f=fixture(),job=f.run();await tick();f.gate.resolve();await job;
 assert.deepEqual(f.events,['config','scoped:policy','scoped:route']);assert.deepEqual(f.cache,['shared-config','local-quote']);
 assert.equal(f.context.state.quote,f.q);assert.equal(f.q.serviceExpiresAt,f.q.poolCheckedAt+15000);
});
test('a canceled legacy fallback cannot continue its policy scan through the shared context',async()=>{
 const f=fixture();f.config.version='1.11';
 f.context.readPoolPolicy=async read=>{await read({method:'legacy-policy'});f.cache.push('legacy-policy');return{};};
 const job=f.run();await tick();f.controller.abort();f.gate.resolve();await job;
 assert.deepEqual(f.events,['config','scoped:legacy-policy']);assert.deepEqual(f.cache,['shared-config']);assert.equal(f.context.state.quote,null);
});
test('canceling fee-route search cannot scan the next candidate or recalculate impact',async()=>{
 const f=fixture();f.config.version='1.11';
 f.context.readPoolPolicy=async()=>({});f.context.swapFeePolicy=()=>({mode:'convert',token:f.tokenIn.address});
 const candidate={out:1n,first:{path:[f.tokenIn.address,f.tokenOut.address]}};
 f.context.v10BestAmountsOut=async()=>({...candidate,candidates:[candidate,candidate]});
 f.context.v10PlanFeeConversion=async read=>{await read({method:'fee-route'});f.cache.push('fee-route');return{fee:1n,conversion:{}};};
 f.context.v10RouteImpact=async()=>{f.events.push('impact');return 0;};
 const job=f.run();await tick();f.controller.abort();f.gate.resolve();await job;
 assert.deepEqual(f.events,['config','scoped:fee-route']);assert.deepEqual(f.cache,['shared-config']);assert.equal(f.context.state.quote,null);
});
test('a pre-aborted quote cannot start service, config, policy or route work',async()=>{
 const f=fixture();f.context.swapService.quote=async()=>{f.events.push('service');return null;};f.controller.abort();await f.run();
 assert.deepEqual(f.events,[]);assert.deepEqual(f.cache,[]);assert.equal(f.context.state.quote,null);
});
