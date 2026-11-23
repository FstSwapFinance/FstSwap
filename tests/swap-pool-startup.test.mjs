import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ethers} from 'ethers';
const source=readFileSync(new URL('../src/swap-pool.mjs',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace(/^export /gm,'');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(account='0x'+'11'.repeat(20)){
 const calls=[],listeners=new Set(),events=new EventTarget(),msg={textContent:''};
 const holder={querySelector:()=>msg,cloneNode:()=>({}),replaceWith(){}};
 const main={isConnected:true,classList:{add(){}},querySelector:()=>holder,querySelectorAll:()=>[]};
 const wallet={account,subscribe(fn){listeners.add(fn);if(this.account)fn();return()=>listeners.delete(fn);},notify(){for(const fn of listeners)fn();}};
 const codec=new ethers.Interface(['function getReserves() view returns(uint112,uint112,uint32)','function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)']);
 const request=async payload=>{const parsed=codec.parseTransaction({data:payload.params[0].data});calls.push({method:parsed.name,to:payload.params[0].to});return codec.encodeFunctionResult(parsed.name,parsed.name==='getReserves'?[100n,200n,1]:[parsed.name==='totalSupply'?100n:0n]);};
 const context={console,Promise,BigInt,Set,Map,Date,ethers,AbortController,AbortSignal,setTimeout,clearTimeout,SWAP_TOKENS:{fist:{address:'0x'+'22'.repeat(20)},usdt:{address:'0x'+'33'.repeat(20)}},
  useWallet:()=>wallet,tpl:()=>main,mountFrame(){},swapPublicRpc:()=>request,localStorage:{getItem:()=>null},tr:(zh)=>zh,T:x=>x,
  addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 vm.createContext(context);vm.runInContext(source,context);return{context,request,main,wallet,calls,listeners,msg,dispose(){main.isConnected=false;events.dispatchEvent(new Event('hashchange'));}};
}
test('pool listing performs one six-call read for an already connected wallet',async()=>{
 const f=fixture();await f.context.mountPoolList({},f.request);await turn();await turn();assert.equal(f.calls.length,6);assert.equal(f.calls.filter(c=>c.method==='balanceOf').length,2);assert.equal(f.listeners.size,1);
});
test('leaving the pool page removes its wallet listener and later notifications do not query it',async()=>{
 const f=fixture();await f.context.mountPoolList({},f.request);await turn();f.dispose();const prior=f.calls.length;assert.equal(f.listeners.size,0);f.wallet.notify();await turn();assert.equal(f.calls.length,prior);
});
test('a disconnected pool page renders immediately and a later connection reads once',async()=>{
 const f=fixture(null);await f.context.mountPoolList({},f.request);await turn();assert.match(f.msg.textContent,/连接钱包/);assert.equal(f.calls.length,0);f.wallet.account='0x'+'11'.repeat(20);f.wallet.notify();await turn();await turn();assert.equal(f.calls.length,6);
});
const fullSource=readFileSync(new URL('../src/swap-pool.mjs',import.meta.url),'utf8');
const between=(start,end)=>fullSource.slice(fullSource.indexOf(start),fullSource.indexOf(end));
const addAccount=between('  let accountSeq = 0, loadedAccount;','  async function approveToken(k)');
const addStart=between('  void settings;','// —— 去除流动资金').replace(/\n}\s*$/,'');
const removeLoad=between('  let loadSeq = 0, loadedAccount;','  async function approveLp()');
const removeStart=fullSource.slice(fullSource.lastIndexOf('  render();\n')).replace(/\n}\s*$/,'');
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
test('add liquidity starts balances and allowance before the pool read finishes, without duplicate startup reads',async()=>{
 const f=fixture(),poolGate=deferred(),counts={balance:0,allowance:0};
 Object.assign(f.context,{main:f.main,wallet:f.wallet,settings:{},cancelNativeMax(){},st:{a:'usdt',b:'fist',balances:{},allowance:{},approving:{}},TOKENS:{usdt:{address:'0x'+'33'.repeat(20)},fist:{address:'0x'+'22'.repeat(20)}},
  reads:{balance:async()=>{counts.balance++;return 9n;},allowance:async()=>{counts.allowance++;return 8n;}},render(){},loadPool:()=>poolGate.promise});
 vm.runInContext('async function startAdd(){'+addAccount+addStart+'}',f.context);
 const job=f.context.startAdd();await turn();assert.deepEqual(counts,{balance:2,allowance:2});assert.equal(f.listeners.size,1);
 poolGate.resolve();await job;await turn();assert.deepEqual(counts,{balance:2,allowance:2});f.dispose();assert.equal(f.listeners.size,0);
});
test('remove liquidity starts one reserves and account batch for an existing wallet',async()=>{
 const f=fixture(),poolGate=deferred(),counts={pool:0,balanceOf:0,allowance:0};
 Object.assign(f.context,{main:f.main,wallet:f.wallet,st:{},pool:{pair:'0x'+'44'.repeat(20)},reads:{pool:async()=>{counts.pool++;await poolGate.promise;return{};},call:async(_to,_abi,method)=>{counts[method]++;return[7n];}},render(){}});
 vm.runInContext('async function startRemove(){'+removeLoad+removeStart+'}',f.context);
 await f.context.startRemove();await turn();poolGate.resolve();await turn();await turn();
 assert.deepEqual(counts,{pool:1,balanceOf:1,allowance:1});assert.equal(f.listeners.size,1);f.dispose();assert.equal(f.listeners.size,0);
});
