import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readWalletBalances,invalidateWalletBalances} from '../src/swap-balances.mjs';
const balanceModule=new URL('../src/swap-balances.mjs',import.meta.url);
const serviceImport=readFileSync(balanceModule,'utf8').match(/from\s+['"]([^'"]*swap-service-client\.mjs[^'"]*)['"]/);
assert.ok(serviceImport,'the real balance reader must declare the singleton under test');
const {swapService}=await import(new URL(serviceImport[1],balanceModule));
const originalBalanceService=swapService.balances;
test.beforeEach(()=>invalidateWalletBalances());
test.afterEach(()=>{swapService.balances=originalBalanceService;invalidateWalletBalances();});

const source=readFileSync(new URL('../src/swap-shell.mjs',import.meta.url),'utf8');
const polling=source.slice(source.indexOf('// —— Polling'),source.indexOf('// —— Popups'));
const wallets=source.slice(source.indexOf('const WALLET_CHOICE'),source.indexOf('export function openWalletModal'));
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20);
function provider(){const listeners=new Map();return{listeners,on:(event,fn)=>listeners.set(event,fn),removeListener:(event,fn)=>{if(listeners.get(event)===fn)listeners.delete(event);}};}
function fixture(){
 const storage=new Map(),reads=[],restores=[],activations=[];let selected=provider();
 const walletState={wallet:null,bnb:null,wcProvider:null,get account(){return this.wallet?.account;},get provider(){return this.wallet?.provider;},notify(){activations.push(this.account);}};
 swapService.balances=(account,tokens,{signal})=>{const gate=deferred();reads.push({payload:{method:'balances',account,tokens},signal,gate});return gate.promise.then(value=>({balances:{bnb:BigInt(value)},failed:[]}));};
 const context={AbortController,AbortSignal,Promise,BigInt,Date,setInterval,clearInterval,globalThis:{fetch:()=>{}},walletState,readWalletBalances,invalidateWalletBalances,
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},renderHeader(){},
  loadSwapLibrary:()=>new Promise(()=>{}),injectedProvider:()=>selected,
  restoreInjected:async()=>{const gate=deferred(),p=selected;restores.push({gate,provider:p});return gate.promise;},
  connectInjected:async()=>({provider:selected,account:B,kind:'injected'}),disconnectWalletConnect:async()=>{},
  swapPublicRpc:(_fetch,signal)=>async payload=>{const gate=deferred();reads.push({payload,signal,gate});return gate.promise;},
 };
 vm.createContext(context);vm.runInContext((polling+wallets).replace(/^export /gm,''),context);
 return{context,walletState,storage,reads,restores,activations,get selected(){return selected;},select:p=>{selected=p;}};
}
test('simultaneous silent restoration shares only the same epoch, choice and injected provider',async()=>{
 const f=fixture(),a=f.context.restoreWallet(),b=f.context.restoreWallet();await flush();
 assert.equal(f.restores.length,1,'startup and ethereum initialized must issue one silent account/network read');
 f.restores[0].gate.resolve({provider:f.selected,account:A,kind:'injected'});await Promise.all([a,b]);
 assert.equal(f.walletState.account,A);assert.equal(f.activations.length,1);
});
test('a late injected provider does not join an older silent restore and its late result cannot replace the new wallet',async()=>{
 const f=fixture(),old=f.context.restoreWallet();await flush();const next=provider();f.select(next);
 const latest=f.context.restoreWallet();await flush();assert.equal(f.restores.length,2);
 f.restores[1].gate.resolve({provider:next,account:B,kind:'injected'});await latest;
 f.restores[0].gate.resolve({provider:f.restores[0].provider,account:A,kind:'injected'});await old;
 assert.equal(f.walletState.account,B);assert.equal(f.walletState.provider,next);
});
test('explicit connect and disconnect epochs invalidate pending silent restore without swallowing a later restore',async()=>{
 for(const action of ['connect','disconnect']){
  const f=fixture(),old=f.context.restoreWallet();await flush();
  if(action==='connect')await f.context.connectWallet();else await f.context.disconnectWallet();
  f.restores[0].gate.resolve({provider:f.selected,account:A,kind:'injected'});await old;
  assert.equal(f.walletState.account,action==='connect'?B:undefined);
  if(action==='disconnect'){
   f.storage.delete('fstswap_wallet_choice');const next=f.context.restoreWallet();await flush();assert.equal(f.restores.length,2);
   f.restores[1].gate.resolve({provider:f.selected,account:B,kind:'injected'});await next;assert.equal(f.walletState.account,B);
  }
 }
});
test('a failed silent restore is evicted so a later initialized event can retry',async()=>{
 const f=fixture(),first=f.context.restoreWallet();await flush();f.restores[0].gate.resolve(null);await first;
 const next=f.context.restoreWallet();await flush();assert.equal(f.restores.length,2);
 f.restores[1].gate.resolve({provider:f.selected,account:A,kind:'injected'});await next;assert.equal(f.walletState.account,A);
});
test('overlapping header balance refreshes share one read for the same account and provider',async()=>{
 const f=fixture();f.context.activateWallet({provider:f.selected,account:A,kind:'injected'});
 const first=f.context.refreshNativeBalance(),second=f.context.refreshNativeBalance();await flush();
 assert.equal(f.reads.length,1);assert.equal(f.reads[0].payload.method,'balances');
 f.reads[0].gate.resolve('0x7');await Promise.all([first,second]);assert.equal(f.walletState.bnb,7n);
 await f.context.refreshNativeBalance();assert.equal(f.reads.length,1,'completed BNB shares the existing five-second display cache');
 const next=f.context.refreshNativeBalance({fresh:true});await flush();assert.equal(f.reads.length,2);f.reads[1].gate.resolve('0x8');await next;assert.equal(f.walletState.bnb,8n);
});
test('a chain change invalidates pending native balance even when account and provider are unchanged',async()=>{
 const f=fixture();f.context.activateWallet({provider:f.selected,account:A,kind:'injected'});
 const old=f.context.refreshNativeBalance();await flush();f.selected.listeners.get('chainChanged')();
 assert.equal(f.walletState.bnb,null);const next=f.context.refreshNativeBalance();await flush();assert.equal(f.reads.length,2);
 f.reads[1].gate.resolve('0x9');await next;f.reads[0].gate.resolve('0x1');await old;
 assert.equal(f.walletState.bnb,9n,'a late balance from the previous network cannot overwrite the new read');
});
test('disconnect and reconnect of the same account cannot publish a prior header balance',async()=>{
 const f=fixture();f.context.activateWallet({provider:f.selected,account:A,kind:'injected'});
 const old=f.context.refreshNativeBalance();await flush();await f.context.disconnectWallet();f.context.activateWallet({provider:f.selected,account:A,kind:'injected'});
 const next=f.context.refreshNativeBalance();await flush();f.reads[1].gate.resolve('0xa');await next;f.reads[0].gate.resolve('0x2');await old;
 assert.equal(f.walletState.bnb,10n);
});
test('account changes isolate header reads and a failed native balance is retryable',async()=>{
 const f=fixture();f.context.activateWallet({provider:f.selected,account:A,kind:'injected'});
 const old=f.context.refreshNativeBalance();await flush();f.context.activateWallet({provider:f.selected,account:B,kind:'injected'});
 const next=f.context.refreshNativeBalance();await flush();f.reads[0].gate.resolve('0x1');await old;assert.equal(f.walletState.bnb,null);
 f.reads[1].gate.reject(Error('unavailable'));await next;const retry=f.context.refreshNativeBalance();await flush();assert.equal(f.reads.length,3);
 f.reads[2].gate.resolve('0xb');await retry;assert.equal(f.walletState.bnb,11n);
});
test('post-receipt fresh header read supersedes a pre-transaction pending read without clearing the displayed balance',async()=>{
 const f=fixture();f.context.activateWallet({provider:f.selected,account:A,kind:'injected'});f.walletState.bnb=100n;
 const old=f.context.refreshNativeBalance();await flush();const fresh=f.context.refreshNativeBalance({fresh:true});await flush();
 assert.equal(f.reads.length,2,'a confirmed transaction must start a new native balance read');
 assert.equal(f.reads[0].signal.aborted,true);assert.equal(f.walletState.bnb,100n,'keep the displayed number until the fresh read completes');
 const joined=f.context.refreshNativeBalance();await flush();assert.equal(f.reads.length,2,'ordinary display refreshes may join the new pending read');
 f.reads[1].gate.resolve('0x5a');await Promise.all([fresh,joined]);assert.equal(f.walletState.bnb,90n);
 f.reads[0].gate.resolve('0x64');await old;assert.equal(f.walletState.bnb,90n,'late pre-transaction state cannot replace the confirmed refresh');
});
test('swap shares the verified fresh page batch with header while add and remove explicitly refresh their independent header balance',async t=>{
 const view=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8'),pool=readFileSync(new URL('../src/swap-pool.mjs',import.meta.url),'utf8');
 const swap=view.match(/waitReceipt\(hash, submittedAccount, undefined, receiptReads\.read\)\.then\(async \(\) => \{[\s\S]*?\n      \}\)/)?.[0];
 const positions=[...pool.matchAll(/tx\.waitReceipt\(hash\)\.then\(async \(\) => \{[\s\S]*?\}\)(?=\s*\.catch)/g)].map(m=>m[0]);
 assert.ok(swap);assert.equal(positions.length,2);
 for(const[name,controller]of[['swap',swap],['add',positions[0]],['remove',positions[1]]])await t.test(name,async()=>{
  const calls=[],provider={},context={Promise,hash:'0x'+'33'.repeat(32),submittedAccount:A,submittedProvider:provider,wallet:{account:A,provider},summary:'Fixture swap',popup(){},expectedRequest:{},submittedTokens:{},min:1n,q:{amountIn:1n,feeToken:A,lpFee:0n},receiptReads:{read(){}},pl:{},main:{isConnected:true},
   swapV10Ready:()=>true,readV10Receipt:async()=>calls.push('receipt-verified'),waitReceipt:()=>Promise.resolve(),tx:{waitReceipt:()=>Promise.resolve()},
   rememberPool:()=>{},loadPool:async()=>calls.push('pool-loaded'),loadAccount:async()=>calls.push('account-loaded'),load:async()=>calls.push('position-loaded'),refreshBalances:()=>calls.push('balances'),render(){},
   refreshNativeBalance:options=>calls.push({fresh:options?.fresh}),
  };
  vm.createContext(context);await vm.runInContext(controller,context);
  assert.equal(calls.at(-1).fresh,name==='swap'?undefined:true,name==='swap'?'the verified page refresh owns freshness; header must reuse it':'raw liquidity account reads do not refresh the shared header cache');
  if(name==='swap')assert.deepEqual(calls.slice(0,-1),['receipt-verified','balances']);
  assert.ok(calls.length>=2,'existing receipt/account checks still run before the header refresh');
 });
});
