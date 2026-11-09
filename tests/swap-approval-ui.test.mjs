import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the real view controller functions with in-memory UI and wallet boundaries.
// This does not launch a browser or interact with a real wallet.
const source=readFileSync(new URL('../swap-view.mjs',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('  async function showApprovalIfNeeded(q)'),source.indexOf('  // 每次进入兑换页'));
function fixture({allowance,amountIn=100n,maxIn,native=false}={}) {
 const q={kind:'agg',amountIn,maxIn,out:100n,route:{side:'sell'}};
 const calls={reads:0,closed:0,buttons:0,errors:[],sends:0};
 const state={quote:q,allowance:null};
 const wallet={account:'0x'+'11'.repeat(20),provider:{request:async()=>{throw Error('unexpected wallet request');}}};
 const context={state,wallet,settings:{deadlineMinutes:30},swapSummary:()=>['1','USDT','3','FIST'],pendingModal:()=>{},tr:x=>x,T:x=>x,minOut:()=>1n,
  inT:()=>({key:native?'bnb':'usdt',address:native?null:'0x'+'22'.repeat(20)}),outT:()=>({address:'0x'+'33'.repeat(20)}),
  refreshAllowance:async()=>{calls.reads++;state.allowance=allowance;},needsApproval:()=>state.allowance!=null&&state.allowance<(q.maxIn??q.amountIn),
  closeModal:()=>calls.closed++,renderBottom:()=>calls.buttons++,errorModal:m=>calls.errors.push(m),
  sendTx:()=>{calls.sends++;throw Error('unexpected send');},preflightSwap:()=>{throw Error('unexpected preflight');},side:()=> 'sell',swapV10Ready:()=>true,
 };
 vm.createContext(context);vm.runInContext(controller,context);
 return {q,state,calls,execute:()=>context.executeSwap(q),check:()=>context.showApprovalIfNeeded(q)};
}
test('insufficient approval returns to the approval button without an error or wallet request',async()=>{
 for(const opts of [{allowance:99n},{allowance:100n,maxIn:101n}]){
  const f=fixture(opts);await f.execute();assert.equal(f.calls.closed,1);assert.equal(f.calls.buttons,1);assert.deepEqual(f.calls.errors,[]);assert.equal(f.calls.sends,0);
 }
});
test('sufficient approval and native BNB do not trigger the approval return path',async()=>{
 const enough=fixture({allowance:100n});assert.equal(await enough.check(),false);assert.equal(enough.calls.buttons,0);
 const native=fixture({native:true});assert.equal(await native.check(),false);assert.equal(native.calls.reads,0);
});
