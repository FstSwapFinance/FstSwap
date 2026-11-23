import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const view=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const handler=view.slice(view.indexOf('  const stopTokens=onTokensChanged'),view.indexOf('  const stopApprovals ='));
function fixture(){
 let identity='pair:USDT/FIST:18/6:active',listener,scheduled=0,painted=0,stopped=0;
 const previews=[],balances=[];
 const quote={out:10n},context={main:{isConnected:true},state:{quote,allowance:100n,balances:{usdt:1n,fist:2n},balanceErrors:{},balancePending:{}},page:{inKey:'usdt',outKey:'fist'},balanceRequests:new Map(),selectedTokenSignature:identity,
  selectedTokenIdentity:()=>identity,onTokensChanged:fn=>{listener=fn;return()=>{};},
  render(){painted++;},renderPanels(){painted++;context.selectedTokenSignature=identity;},renderTrade(){painted++;},renderBottom(){painted++;},scheduleQuote(){scheduled++;},
  stopPairPrice(){stopped++;},refreshPairPrice(options){previews.push(options);},refreshBalances(fresh){balances.push(fresh);}};
 vm.runInNewContext(handler,context);
 return{context,quote,notify:()=>listener(),change:value=>identity=value,scheduled:()=>scheduled,painted:()=>painted,stopped:()=>stopped,previews,balances};
}
test('an unchanged pair survives list or icon updates without canceling its quote and allowance',()=>{
 const f=fixture();f.notify();assert.equal(f.context.state.quote,f.quote);assert.equal(f.context.state.allowance,100n);assert.equal(f.scheduled(),0);assert.ok(f.painted()>0);assert.equal(f.stopped(),0);assert.equal(f.previews.length,0);assert.equal(f.balances.length,0);
});
test('changed selected token decimals invalidate the old input and schedule a new quote',()=>{
 const f=fixture();f.change('pair:USDT/FIST:18/18:active');f.notify();assert.equal(f.context.state.quote,null);assert.equal(f.context.state.allowance,null);assert.equal(f.scheduled(),1);assert.equal(f.stopped(),1);assert.equal(f.previews.length,1);assert.equal(f.previews[0].fresh,true);assert.deepEqual(f.balances,[true]);assert.deepEqual(Object.keys(f.context.state.balances),[]);
});
test('a selected token becoming inactive invalidates the old quote',()=>{
 const f=fixture();f.change('pair:USDT/FIST:18/6:inactive');f.notify();assert.equal(f.context.state.quote,null);assert.equal(f.scheduled(),1);assert.equal(f.stopped(),1);assert.equal(f.previews.length,1);assert.equal(f.previews[0].fresh,true);
});
test('unmounted list subscribers cannot clear a quote or schedule a replacement',()=>{
 const f=fixture();f.context.main.isConnected=false;f.notify();assert.equal(f.context.state.quote,f.quote);assert.equal(f.scheduled(),0);assert.equal(f.painted(),0);assert.equal(f.stopped(),0);assert.equal(f.previews.length,0);
});
