import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ethers} from 'ethers';
import {readWalletBalances as readBalances,invalidateWalletBalances} from '../src/swap-balances.mjs';
// Bind the exact singleton imported by the real balance reader, including its
// current cache query, rather than constructing a stale release-specific graph.
const balanceModule=new URL('../src/swap-balances.mjs',import.meta.url);
const serviceImport=readFileSync(balanceModule,'utf8').match(/from\s+['"]([^'"]*swap-service-client\.mjs[^'"]*)['"]/);
assert.ok(serviceImport,'the balance reader must declare its service import');
const {swapService}=await import(new URL(serviceImport[1],balanceModule));

const account='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20);
const a={key:'usdt',address:'0x'+'aa'.repeat(20),decimals:18},b={key:'fist',address:'0x'+'bb'.repeat(20),decimals:6},bnb={key:'bnb',address:null,decimals:18};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const flush=async()=>{for(let n=0;n<50;n++)await Promise.resolve();};
const fallback=async()=>{throw Error('Unexpected public fallback');};
globalThis.ethers=ethers;
// Failed RED assertions still leave rejection handlers on every deliberately
// pending consumer; teardown must not produce unrelated unhandled rejections.
function readWalletBalances(...args){const work=readBalances(...args);work.catch(()=>{});return work;}
function fixture(t){
 invalidateWalletBalances();const original=swapService.balances,calls=[];
 swapService.balances=(owner,tokens,{signal}={})=>{const gate=deferred();calls.push({owner,tokens,signal,gate});return gate.promise;};
 t.after(()=>{for(const call of calls)call.gate.resolve({balances:{},failed:call.tokens.map(t=>t.key)});swapService.balances=original;invalidateWalletBalances();});
 return{calls,complete:(n,value)=>calls[n].gate.resolve({balances:Object.fromEntries(calls[n].tokens.map(t=>[t.key,value])),failed:[]})};
}

test('page and cancellable header/list readers join the same pending token batch',async t=>{
 const f=fixture(t),one=readWalletBalances(fallback,account,[a,b,bnb]);await flush();
 const two=readWalletBalances(fallback,account,[bnb],{signal:new AbortController().signal});await flush();
 assert.equal(f.calls.length,1,'same pending BNB must not start a second physical balance request');
 f.complete(0,7n);assert.deepEqual((await one).balances,{usdt:7n,fist:7n,bnb:7n});assert.equal((await two).balances.bnb,7n);
});
test('canceling one subscriber leaves shared upstream and other subscribers alive',async t=>{
 const f=fixture(t),controller=new AbortController(),one=readWalletBalances(fallback,account,[a],{signal:controller.signal});
 const rejected=assert.rejects(one,{name:'AbortError'});await flush();
 const two=readWalletBalances(fallback,account,[a],{signal:new AbortController().signal});await flush();
 controller.abort();await rejected;assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,false);
 f.complete(0,9n);assert.equal((await two).balances.usdt,9n);assert.equal((await readWalletBalances(fallback,account,[a])).balances.usdt,9n);assert.equal(f.calls.length,1);
});
test('the last canceled subscriber aborts physical work and late data cannot enter the display cache',async t=>{
 const f=fixture(t),controllers=[new AbortController(),new AbortController()];
 const jobs=controllers.map(c=>readWalletBalances(fallback,account,[a],{signal:c.signal})),rejected=jobs.map(job=>assert.rejects(job,{name:'AbortError'}));await flush();
 controllers.forEach(c=>c.abort());await Promise.all(rejected);assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,true);
 const next=readWalletBalances(fallback,account,[a]);await flush();assert.equal(f.calls.length,2);f.complete(1,20n);assert.equal((await next).balances.usdt,20n);
 f.complete(0,1n);await flush();assert.equal((await readWalletBalances(fallback,account,[a])).balances.usdt,20n);assert.equal(f.calls.length,2);
});
test('fresh receipt reads bypass shared pending work and reject every pre-receipt subscriber',async t=>{
 const f=fixture(t),one=readWalletBalances(fallback,account,[a,bnb]),rejected=assert.rejects(one,{name:'AbortError'});await flush();
 const two=readWalletBalances(fallback,account,[bnb],{signal:new AbortController().signal}),alsoRejected=assert.rejects(two,{name:'AbortError'});await flush();
 const fresh=readWalletBalances(fallback,account,[a,bnb],{fresh:true});await flush();
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].signal.aborted,true);await Promise.all([rejected,alsoRejected]);
 f.complete(1,30n);assert.equal((await fresh).balances.bnb,30n);f.complete(0,100n);await flush();
 assert.equal((await readWalletBalances(fallback,account,[bnb])).balances.bnb,30n);assert.equal(f.calls.length,2);
});
test('overlapping cancellable batches read only missing tokens and isolate owners',async t=>{
 const f=fixture(t),one=readWalletBalances(fallback,account,[a,b],{signal:new AbortController().signal});await flush();
 const two=readWalletBalances(fallback,account,[a,b,bnb],{signal:new AbortController().signal});await flush();
 const isolated=readWalletBalances(fallback,other,[a],{signal:new AbortController().signal});await flush();
 assert.equal(f.calls.length,3);assert.deepEqual(f.calls[1].tokens.map(t=>t.key),['bnb']);assert.equal(f.calls[2].owner,other);
 f.complete(0,4n);f.complete(1,5n);f.complete(2,6n);await one;assert.deepEqual((await two).balances,{usdt:4n,fist:4n,bnb:5n});assert.equal((await isolated).balances.usdt,6n);
});
test('header consumes an already pending three-token page read and reuses its completion window',async t=>{
 const f=fixture(t),page=readWalletBalances(fallback,account,[a,b,bnb]);await flush();
 const source=readFileSync(new URL('../src/swap-shell.mjs',import.meta.url),'utf8'),polling=source.slice(source.indexOf('// —— Polling'),source.indexOf('// —— Popups'));
 const walletState={wallet:{provider:{}},bnb:null,account,provider:{}},raw=[];
 const context={AbortController,AbortSignal,Promise,BigInt,Date,readWalletBalances,invalidateWalletBalances,walletState,renderHeader(){},globalThis:{fetch(){}},swapPublicRpc:()=>async payload=>{raw.push(payload);return'0x63';}};
 vm.createContext(context);vm.runInContext(polling.replace(/^export /gm,''),context);
 const header=context.refreshNativeBalance();await flush();assert.equal(raw.length,0,'header must join the page read rather than call eth_getBalance again');assert.equal(f.calls.length,1);
 f.complete(0,12n);await Promise.all([page,header]);assert.equal(walletState.bnb,12n);
 await context.refreshNativeBalance();assert.equal(f.calls.length,1,'header shares the original five-second completion cache');
});
test('local Multicall fallback uses a shared transport signal rather than the first subscriber signal',async t=>{
 fixture(t);swapService.balances=async()=>null;
 const codec=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function balanceOf(address) view returns(uint256)']);
 const gate=deferred(),calls=[],controller=new AbortController();
 const request=(payload,{signal}={})=>{calls.push({payload,signal});return gate.promise;};
 const one=readWalletBalances(request,account,[a],{signal:controller.signal}),rejected=assert.rejects(one,{name:'AbortError'});await flush();
 const two=readWalletBalances(request,account,[a],{signal:new AbortController().signal});await flush();
 assert.equal(calls.length,1);assert.ok(calls[0].signal);assert.notEqual(calls[0].signal,controller.signal);
 controller.abort();await rejected;assert.equal(calls[0].signal.aborted,false);
 gate.resolve(codec.encodeFunctionResult('tryAggregate',[[[true,codec.encodeFunctionResult('balanceOf',[41n])]]]));
 assert.equal((await two).balances.usdt,41n);
});
test('non-BSC chains are rejected before any balance service or RPC and cannot share BSC display entries',async t=>{
 const f=fixture(t),valid=readWalletBalances(fallback,account,[a],{chainId:56});await flush();f.complete(0,3n);await valid;
 await assert.rejects(readWalletBalances(fallback,account,[a],{chainId:1}),/Invalid balance chain/);
 assert.equal(f.calls.length,1);assert.equal((await readWalletBalances(fallback,account,[a],{chainId:56})).balances.usdt,3n);
});
test('a frozen device wall clock cannot extend completed balance cache beyond five monotonic seconds',async t=>{
 const f=fixture(t);let mono=1000;const options={clock:()=>10000,monotonic:()=>mono};
 const first=readWalletBalances(fallback,account,[a],options);await flush();f.complete(0,7n);await first;
 mono=5999;assert.equal((await readWalletBalances(fallback,account,[a],options)).balances.usdt,7n);assert.equal(f.calls.length,1);
 mono=6000;const next=readWalletBalances(fallback,account,[a],options);await flush();
 assert.equal(f.calls.length,2,'elapsed monotonic time must expire a display snapshot even if wall time freezes');f.complete(1,29n);assert.equal((await next).balances.usdt,29n);
});
