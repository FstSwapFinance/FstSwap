import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletTiming,timeWalletPhase,walletTimingFailure} from '../src/swap-wallet-timing.mjs';

test('failure diagnostics expose only a fixed code and never arbitrary wallet text',()=>{
 const timing=createWalletTiming({search:'?debug=wallet-timing',clock:()=>1,output:()=>{}}),mark=timing.begin('swap');
 walletTimingFailure(mark,{code:'WRONG_CHAIN',message:'private detail'});walletTimingFailure(mark,{code:'secret-key',message:'private detail'});
 assert.deepEqual(timing.snapshot()[0].events.map(e=>e.phase),['click','failed_WRONG_CHAIN','failed_OTHER']);
});

test('timing is disabled without the exact explicit debug URL and touches no clock or output',()=>{
 for(const search of ['', '?debug=1','?debug=wallet','?wallet-timing=1']){
  let touched=0;const expose={},timing=createWalletTiming({search,clock:()=>{touched++;throw Error('disabled');},output:()=>{touched++;},expose});
  assert.equal(timing.enabled,false);assert.equal(timing.begin('swap'),undefined);assert.deepEqual(timing.snapshot(),[]);assert.equal(touched,0);assert.deepEqual(expose,{});
 }
});
test('enabled timing records only known phase names and relative milliseconds',()=>{
 let now=100;const messages=[],expose={},timing=createWalletTiming({search:'?v=36&debug=wallet-timing',clock:()=>now,output:(...values)=>messages.push(values),expose});
 const mark=timing.begin('swap');now=125.44;mark('guard_start');now=150;mark('send_invoked');mark('0x'+'aa'.repeat(20));mark({payload:'secret'});mark('finished');
 const rows=timing.snapshot();assert.deepEqual(rows,[{id:1,operation:'swap',events:[{phase:'click',ms:0},{phase:'guard_start',ms:25.4},{phase:'send_invoked',ms:50},{phase:'finished',ms:50}]}]);
 assert.deepEqual(expose,{});assert.equal(JSON.stringify(messages).includes('secret'),false);assert.equal(JSON.stringify(messages).includes('0x'),false);
});
test('timing output failure and an unavailable clock never break the transaction flow',async()=>{
 const timing=createWalletTiming({search:'?debug=wallet-timing',clock:()=>100,output:()=>{throw Error('console unavailable');},expose:{}});
 const mark=timing.begin('approve');assert.doesNotThrow(()=>mark('guard_start'));assert.equal(await timeWalletPhase(mark,'public_gas',async()=>42),42);
 const broken=createWalletTiming({search:'?debug=wallet-timing',clock:()=>{throw Error('clock');},expose:{}});assert.equal(broken.begin('swap'),undefined);
});
test('timing records remain bounded and exported snapshots cannot mutate private entries',()=>{
 let now=0;const timing=createWalletTiming({search:'?debug=wallet-timing',clock:()=>now++,output:()=>{},limit:2,expose:{}});
 const first=timing.begin('swap');timing.begin('approve');timing.begin('swap');first('send_invoked');
 const rows=timing.snapshot();assert.deepEqual(rows.map(row=>row.id),[2,3]);rows[0].events[0].phase='secret';assert.equal(timing.snapshot()[0].events[0].phase,'click');
 const mark=timing.begin('swap');for(let n=0;n<200;n++)mark('guard_start');assert.ok(timing.snapshot().at(-1).events.length<=128);
 timing.clear();assert.deepEqual(timing.snapshot(),[]);
});
test('phase wrapper preserves original promises while disabled and never adds work',async()=>{
 let calls=0;const promise=Promise.resolve(5);assert.equal(timeWalletPhase(undefined,'public_gas',()=>{calls++;return promise;}),promise);assert.equal(calls,1);assert.equal(await promise,5);
 const error=Error('original');assert.throws(()=>timeWalletPhase(undefined,'public_config',()=>{throw error;}),error);
});
test('enabled phase wrapper records completion for success and failure without changing errors',async()=>{
 const phases=[],record=phase=>phases.push(phase),failure=Error('original');
 assert.equal(await timeWalletPhase(record,'public_config',async()=>7),7);
 await assert.rejects(timeWalletPhase(record,'wallet_simulation',async()=>{throw failure;}),failure);
 assert.deepEqual(phases,['public_config_start','public_config_end','wallet_simulation_start','wallet_simulation_end']);
});
