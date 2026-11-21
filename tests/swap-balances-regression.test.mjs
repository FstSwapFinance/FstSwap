import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {readTokenBalances,readWalletBalances,invalidateWalletBalances} from '../src/swap-balances.mjs';
globalThis.ethers=ethers;
const codec=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function getEthBalance(address) view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const account='0x'+'11'.repeat(20);
const tokens=[{key:'bnb',address:null},...Array.from({length:23},(_,i)=>({key:'t'+i,address:ethers.getAddress('0x'+(i+1).toString(16).padStart(40,'0'))}))];
function fixture({failedToken=false,malformed=false}={}){
 let requests=0;const read=async p=>{requests++;assert.equal(p.method,'eth_call');assert.equal(p.params[1],'latest');
  const calls=codec.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return codec.encodeFunctionResult('tryAggregate',[calls.map((c,i)=>{const parsed=codec.parseTransaction({data:c.callData});assert.equal(parsed.args[0].toLowerCase(),account);
   if(failedToken&&i===1)return[false,'0x'];if(malformed&&i===1)return[true,'0x12'];
   return[true,codec.encodeFunctionResult(parsed.name,[123456789123456789123n+BigInt(i)])];})]);
 };return{read,count:()=>requests};
}
test('native and 23 token balances use one call and retain full integer precision',async()=>{
 const f=fixture(),r=await readTokenBalances(f.read,account,tokens);assert.equal(f.count(),1);assert.equal(Object.keys(r.balances).length,24);assert.equal(r.balances.bnb,123456789123456789123n);assert.equal(r.balances.t22,123456789123456789146n);assert.deepEqual(r.failed,[]);
});
test('a failing or malformed token does not hide valid balances or invent zero balances',async()=>{
 for(const opt of['failedToken','malformed']){const f=fixture({[opt]:true}),r=await readTokenBalances(f.read,account,tokens);assert.equal(r.balances.t0,undefined);assert.ok(r.balances.t1>0n);assert.deepEqual(r.failed,['t0']);}
});
test('a new read never uses pre-transaction cached balances and invalid accounts make no RPC request',async()=>{
 const f=fixture();await readTokenBalances(f.read,account,tokens);await readTokenBalances(f.read,account,tokens);assert.equal(f.count(),2);
 await assert.rejects(readTokenBalances(f.read,'wrong',tokens));assert.equal(f.count(),2);
 assert.deepEqual(await readTokenBalances(f.read,account,[]),{balances:{},failed:[]});assert.equal(f.count(),2);
});

import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const view=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
test('late balance reads cannot overwrite a newer refresh or a different wallet',async()=>{
 const jobs=[],state={balanceEpoch:0,balances:{},balanceErrors:{}},wallet={account};
 const context={state,wallet,submissionWarmup:{pending:()=>false},activeBalanceReads:0,queueSubmissionWarm(){},page:{inKey:'usdt',outKey:'fist'},request:()=>{},balanceRequest:()=>{},TOKENS:{usdt:{key:'usdt',address:tokens[1].address}},readWalletBalances:()=>new Promise(resolve=>jobs.push(resolve))};
 vm.createContext(context);vm.runInContext(view.slice(view.indexOf('  let balanceRequestId ='),view.indexOf('  async function loadAllBalances()')),context);
 const old=context.loadBalances(['usdt']),fresh=context.loadBalances(['usdt']);jobs[1]({balances:{usdt:25n},failed:[]});await fresh;
 jobs[0]({balances:{usdt:100n},failed:[]});await old;assert.equal(state.balances.usdt,25n);
 const other=context.loadBalances(['usdt']);wallet.account='0x'+'22'.repeat(20);state.balanceEpoch++;state.balances={};
 jobs[2]({balances:{usdt:500n},failed:[]});await other;assert.equal(state.balances.usdt,undefined);
 const error=context.loadBalances(['usdt']);jobs[3]({balances:{},failed:['usdt']});await error;assert.equal(state.balances.usdt,undefined);assert.equal(state.balanceErrors.usdt,true);
});
test('a failed batch preserves other completed batches and does not prevent later batches',async()=>{
 const many=Array.from({length:65},(_,i)=>({key:'t'+i,address:'0x'+(i+1).toString(16).padStart(40,'0')}));
 for(const badBatch of[1,2]){
  const f=fixture();let batch=0;const read=async p=>{if(++batch===badBatch)throw Error('offline');return f.read(p);};
  const r=await readTokenBalances(read,account,many);assert.equal(batch,2);assert.equal(Object.keys(r.balances).length,badBatch===1?1:64);assert.equal(r.failed.length,badBatch===1?64:1);
 }
});

test('warm holdings serve pair subsets; forced refresh and account switches cannot reuse an old balance',async()=>{
 invalidateWalletBalances(); const f=fixture(); let now=1000;
 await readWalletBalances(f.read,account,tokens,{clock:()=>now});
 const pair=await readWalletBalances(f.read,account,tokens.slice(0,2),{clock:()=>now});
 assert.equal(f.count(),1); assert.equal(Object.keys(pair.balances).length,2);
 await readWalletBalances(f.read,account,tokens,{fresh:true,clock:()=>now});assert.equal(f.count(),2);
 now=6000;await readWalletBalances(f.read,account,tokens,{clock:()=>now});assert.equal(f.count(),3);
 invalidateWalletBalances();await readWalletBalances(f.read,account,tokens,{clock:()=>now});assert.equal(f.count(),4);
});

const balanceSource=readFileSync(new URL('../src/swap-balances.mjs',import.meta.url),'utf8');
const serviceImport=balanceSource.match(/from '(\.\/swap-service-client\.mjs[^']*)'/)[1];
const {swapService}=await import(new URL(serviceImport,new URL('../src/swap-balances.mjs',import.meta.url)).href);
const balanceTargets=p=>codec.decodeFunctionData('tryAggregate',p.params[0].data)[1].map(c=>c.target.toLowerCase());
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
test('pair-first balances merge into a later holdings read without rereading successful pair tokens',async()=>{
 invalidateWalletBalances();const f=fixture(),groups=[],read=p=>{groups.push(balanceTargets(p));return f.read(p);};
 const pair=tokens.slice(1,3),all=tokens.slice(0,5);
 await readWalletBalances(read,account,pair);
 const result=await readWalletBalances(read,account,all);
 assert.deepEqual(groups,[pair.map(t=>t.address.toLowerCase()),[tokens[0],...tokens.slice(3,5)].map(t=>(t.address||'0xcA11bde05977b3631167028862bE2a173976CA11').toLowerCase())]);
 assert.equal(Object.keys(result.balances).length,5);assert.deepEqual(result.failed,[]);
});
test('an overlapping holdings read shares the pending pair and only queries the missing tokens',async()=>{
 invalidateWalletBalances();const f=fixture(),gate=deferred(),groups=[],pair=tokens.slice(1,3),all=tokens.slice(1,5);
 const read=async p=>{groups.push(balanceTargets(p));const result=await f.read(p);if(groups.length===1)await gate.promise;return result;};
 const first=readWalletBalances(read,account,pair);await new Promise(r=>setImmediate(r));
 const second=readWalletBalances(read,account,all);await new Promise(r=>setImmediate(r));
 gate.resolve();const results=await Promise.all([first,second]);
 assert.deepEqual(groups,[pair.map(t=>t.address.toLowerCase()),tokens.slice(3,5).map(t=>t.address.toLowerCase())]);
 assert.equal(Object.keys(results[1].balances).length,4);
});
test('partial failures are retried while successful cached token balances remain reusable',async()=>{
 invalidateWalletBalances();const f=fixture({failedToken:true}),groups=[],read=p=>{groups.push(balanceTargets(p));return f.read(p);};
 const subset=tokens.slice(0,3),first=await readWalletBalances(read,account,subset);assert.deepEqual(first.failed,['t0']);
 const second=await readWalletBalances(read,account,subset);
 assert.equal(groups.length,2);assert.deepEqual(groups[1],[tokens[1].address.toLowerCase()]);assert.deepEqual(second.failed,[]);assert.ok(second.balances.t0>0n);
});
test('merged token snapshots keep each completion TTL and fresh refresh forces every token to reread',async()=>{
 invalidateWalletBalances();const f=fixture(),groups=[],read=p=>{groups.push(balanceTargets(p));return f.read(p);};let now=1000;
 const pair=tokens.slice(1,3),extra=tokens.slice(3,4),all=[...pair,...extra];
 await readWalletBalances(read,account,pair,{clock:()=>now});now=2500;await readWalletBalances(read,account,extra,{clock:()=>now});
 now=6001;await readWalletBalances(read,account,all,{clock:()=>now});assert.deepEqual(groups[2],pair.map(t=>t.address.toLowerCase()));
 await readWalletBalances(read,account,all,{fresh:true,clock:()=>now});assert.deepEqual(groups[3],all.map(t=>t.address.toLowerCase()));
});
test('wallet balance validation happens before the service and token cache identity includes address and decimals',async()=>{
 invalidateWalletBalances();const original=swapService.balances;let calls=0;swapService.balances=async()=>{calls++;return null;};
 try{
  const f=fixture();await assert.rejects(readWalletBalances(f.read,'wrong',tokens));assert.equal(calls,0);assert.equal(f.count(),0);
  const token={...tokens[1],decimals:18};await readWalletBalances(f.read,account,[token]);
  await readWalletBalances(f.read,account,[{...token,decimals:6}]);assert.equal(f.count(),2);
  await readWalletBalances(f.read,account,[{...token,address:tokens[2].address}]);assert.equal(f.count(),3);
 }finally{swapService.balances=original;invalidateWalletBalances();}
});
test('canceling a balance API read rejects promptly and cannot start a public fallback',async()=>{
 invalidateWalletBalances();const original=swapService.balances,gate=deferred();let publicCalls=0;swapService.balances=async()=>gate.promise;
 const controller=new AbortController(),job=readWalletBalances(async()=>{publicCalls++;throw Error('unexpected fallback');},account,tokens.slice(1,3),{signal:controller.signal});
 const outcome=Promise.race([job.then(()=> 'fulfilled',e=>e.name),new Promise(r=>setImmediate(()=>r('pending')))]);
 controller.abort();const observed=await outcome;gate.resolve(null);await job.catch(()=>{});await new Promise(r=>setImmediate(r));
 try{assert.equal(observed,'AbortError');assert.equal(publicCalls,0);}finally{swapService.balances=original;invalidateWalletBalances();}
});
test('a canceled subscriber cannot abort or poison a still-observed shared balance batch',async()=>{
 invalidateWalletBalances();const original=swapService.balances,gate=deferred();let calls=0,physicalSignal;
 swapService.balances=async(_account,_tokens,options={})=>{calls++;physicalSignal=options.signal;return gate.promise;};
 const token=tokens[1],regular=readWalletBalances(()=>{},account,[token]),controller=new AbortController();
 const separate=readWalletBalances(()=>{},account,[token],{signal:controller.signal});
 await new Promise(resolve=>setImmediate(resolve));
 const outcome=Promise.race([separate.then(()=> 'fulfilled',e=>e.name),new Promise(r=>setImmediate(()=>r('pending')))]);
 controller.abort();const observed=await outcome;assert.equal(physicalSignal.aborted,false);
 gate.resolve({balances:{[token.key]:7n},failed:[]});await regular;await separate.catch(()=>{});
 try{const current=await readWalletBalances(()=>{},account,[token]);assert.equal(observed,'AbortError');assert.equal(current.balances[token.key],7n);assert.equal(calls,1);}finally{swapService.balances=original;invalidateWalletBalances();}
});
test('successful cancellable background balances become reusable completed display values',async()=>{
 invalidateWalletBalances();const original=swapService.balances;let calls=0;
 swapService.balances=async(_account,wanted)=>{calls++;return{balances:Object.fromEntries(wanted.map(t=>[t.key,17n])),failed:[]};};
 try{
  const wanted=tokens.slice(1,3),first=await readWalletBalances(()=>{},account,wanted,{signal:new AbortController().signal});
  const second=await readWalletBalances(()=>{},account,wanted);
  assert.deepEqual(second,first);assert.equal(calls,1);
 }finally{swapService.balances=original;invalidateWalletBalances();}
});
test('an invalidated cancellable result cannot populate the new transaction balance cache',async()=>{
 invalidateWalletBalances();const original=swapService.balances,gate=deferred();let calls=0;
 swapService.balances=async(_account,wanted,options={})=>{calls++;return calls===1?gate.promise:{balances:Object.fromEntries(wanted.map(t=>[t.key,29n])),failed:[]};};
 try{
  const token=tokens[1],old=readWalletBalances(()=>{},account,[token],{signal:new AbortController().signal}),rejected=assert.rejects(old,{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));invalidateWalletBalances();gate.resolve({balances:{[token.key]:7n},failed:[]});await rejected;
  const current=await readWalletBalances(()=>{},account,[token]);assert.equal(current.balances[token.key],29n);assert.equal(calls,2);
 }finally{swapService.balances=original;invalidateWalletBalances();}
});
test('background and normal readers wait for one pending balance snapshot',async()=>{
 invalidateWalletBalances();const original=swapService.balances,gate=deferred();let calls=0;
 swapService.balances=async()=>{calls++;return gate.promise;};
 try{
  const token=tokens[1],regular=readWalletBalances(()=>{},account,[token]);
  let finished=false;const background=readWalletBalances(()=>{},account,[token],{signal:new AbortController().signal}).then(r=>{finished=true;return r;});
  const shared=readWalletBalances(()=>{},account,[token]);await new Promise(r=>setImmediate(r));const completedEarly=finished;
  gate.resolve({balances:{[token.key]:7n},failed:[]});const [a,b,c]=await Promise.all([regular,shared,background]);
  assert.equal(completedEarly,false);assert.equal(a.balances[token.key],7n);assert.equal(b.balances[token.key],7n);assert.equal(c.balances[token.key],7n);assert.equal(calls,1);
 }finally{swapService.balances=original;invalidateWalletBalances();}
});
test('cancellation during a public fallback stops immediately and its eventual response is not cached',async()=>{
 invalidateWalletBalances();const original=swapService.balances;swapService.balances=async()=>null;
 const f=fixture(),gate=deferred(),controller=new AbortController();let calls=0;
 const read=async p=>{calls++;const result=await f.read(p);await gate.promise;return result;};
 try{
  const job=readWalletBalances(read,account,tokens.slice(1,3),{signal:controller.signal});await new Promise(r=>setImmediate(r));
  const outcome=Promise.race([job.then(()=> 'fulfilled',e=>e.name),new Promise(r=>setImmediate(()=>r('pending')))]);
  controller.abort();const observed=await outcome;gate.resolve();await job.catch(()=>{});
  const current=await readWalletBalances(read,account,tokens.slice(1,3));assert.equal(observed,'AbortError');assert.equal(calls,2);assert.equal(Object.keys(current.balances).length,2);
 }finally{gate.resolve();swapService.balances=original;invalidateWalletBalances();}
});
test('successful token cache entries are isolated by account even with identical token identities',async()=>{
 invalidateWalletBalances();const original=swapService.balances,other='0x'+'22'.repeat(20);let calls=0;
 swapService.balances=async(owner,wanted)=>{calls++;return{balances:Object.fromEntries(wanted.map(t=>[t.key,owner===account?7n:19n])),failed:[]};};
 try{
  const token=tokens[1];assert.equal((await readWalletBalances(()=>{},account,[token])).balances[token.key],7n);
  assert.equal((await readWalletBalances(()=>{},other,[token])).balances[token.key],19n);
  assert.equal((await readWalletBalances(()=>{},account,[token])).balances[token.key],7n);assert.equal(calls,2);
 }finally{swapService.balances=original;invalidateWalletBalances();}
});
test('a provider that cancels synchronously cannot leave an unhandled balance rejection or start fallback',async()=>{
 invalidateWalletBalances();const original=swapService.balances,controller=new AbortController();let publicCalls=0;
 swapService.balances=()=>{controller.abort();return Promise.reject(Error('provider aborted'));};
 try{
  await assert.rejects(readWalletBalances(async()=>{publicCalls++;},account,tokens.slice(1,3),{signal:controller.signal}),{name:'AbortError'});
  await new Promise(r=>setImmediate(r));assert.equal(publicCalls,0);
 }finally{swapService.balances=original;invalidateWalletBalances();}
});
