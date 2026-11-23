import test from 'node:test';
import assert from 'node:assert/strict';
import {createBalanceHeaderCache} from '../server/swap-balance-header.mjs';

const block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x6553f100'};
const nextBlock={number:'0x101',hash:'0x'+'cd'.repeat(32),timestamp:'0x6553f101'};
function fixture(options={}){
 let wall=1000,mono=100;
 const cache=createBalanceHeaderCache({clock:()=>wall,monotonic:()=>mono,...options});
 return{cache,observe:()=>({observedAt:wall,monotonicAt:mono}),advance(ms){wall+=ms;mono+=ms;},set(w,m){wall=w;mono=m;}};
}

test('completed headers are reusable only on their own node',()=>{
 const f=fixture();
 assert.equal(f.cache.get('one'),null);
 assert.equal(f.cache.remember('one',block,f.observe()),true);
 assert.deepEqual(f.cache.get('one'),block);
 assert.equal(f.cache.get('two'),null);
 assert.equal(f.cache.remember('two',nextBlock,f.observe()),true);
 assert.deepEqual(f.cache.get('one'),block);
 assert.deepEqual(f.cache.get('two'),nextBlock);
});

test('hits never renew the original 500 ms expiry',()=>{
 const f=fixture();f.cache.remember('one',block,f.observe());
 f.advance(250);assert.deepEqual(f.cache.get('one'),block);
 f.advance(249);assert.deepEqual(f.cache.get('one'),block);
 f.advance(1);assert.equal(f.cache.get('one'),null);
 f.set(1000,100);assert.equal(f.cache.get('one'),null,'an expired entry cannot revive');
});

test('fresh reads consume their original observation budget before completion',()=>{
 const f=fixture(),observation=f.observe();
 f.advance(450);assert.equal(f.cache.remember('one',block,observation),true);
 f.advance(49);assert.deepEqual(f.cache.get('one'),block);
 f.advance(1);assert.equal(f.cache.get('one'),null);
 const late=fixture(),start=late.observe();late.advance(500);
 assert.equal(late.cache.remember('one',block,start),false);
 assert.equal(late.cache.get('one'),null);
});

for(const [name,wall,mono]of[['wall',1500,101],['monotonic',1001,600]]){
 test(`${name} time alone can expire a header`,()=>{
  const f=fixture();f.cache.remember('one',block,f.observe());f.set(wall,mono);
  assert.equal(f.cache.get('one'),null);
 });
}

for(const [name,wall,mono]of[['wall',1099,250],['monotonic',1150,199]]){
 test(`${name} rollback clears all cached nodes even above the original observation`,()=>{
  const f=fixture();f.cache.remember('one',block,f.observe());f.cache.remember('two',nextBlock,f.observe());
  f.advance(100);assert.deepEqual(f.cache.get('one'),block);f.set(wall,mono);
  assert.equal(f.cache.get('one'),null);assert.equal(f.cache.get('two'),null);
  const observation=f.observe();assert.equal(f.cache.remember('one',nextBlock,observation),true);
  assert.deepEqual(f.cache.get('one'),nextBlock,'a new fresh read can recover in the new clock epoch');
 });
}

test('a rollback during a fresh read cannot seed the cache',()=>{
 const f=fixture();f.cache.remember('one',block,f.observe());f.advance(100);f.cache.get('one');
 const observation=f.observe();f.set(1050,250);
 assert.equal(f.cache.remember('two',nextBlock,observation),false);
 assert.equal(f.cache.get('one'),null);assert.equal(f.cache.get('two'),null);
});

test('nonfinite clocks invalidate entries and never admit a completed header',()=>{
 for(const bad of[NaN,Infinity,-Infinity]){
  const f=fixture();f.cache.remember('one',block,f.observe());f.set(bad,200);
  assert.equal(f.cache.get('one'),null);assert.equal(f.cache.remember('two',nextBlock,{observedAt:1000,monotonicAt:100}),false);
  f.set(1100,200);assert.equal(f.cache.get('one'),null);
 }
});

test('reorg invalidation removes only the matching node and hash',()=>{
 const f=fixture();f.cache.remember('one',block,f.observe());f.cache.remember('two',block,f.observe());
 assert.equal(f.cache.invalidate('one',nextBlock.hash),false);assert.deepEqual(f.cache.get('one'),block);
 assert.equal(f.cache.invalidate('one',block.hash.toUpperCase()),true);assert.equal(f.cache.get('one'),null);
 assert.deepEqual(f.cache.get('two'),block);
 f.advance(10);f.cache.remember('one',nextBlock,f.observe());
 assert.equal(f.cache.invalidate('one',block.hash),false,'an older request cannot evict a replacement header');
 assert.deepEqual(f.cache.get('one'),nextBlock);
 assert.equal(f.cache.invalidate('two'),true);assert.equal(f.cache.get('two'),null);
});

test('invalid headers and unfinished promises never enter the cache',()=>{
 const f=fixture();
 const malformed=[null,undefined,{},Promise.resolve(block),{...block,number:1},{...block,number:'0x'},
  {...block,number:'0x'+'1'.repeat(65)},{...block,hash:'0x1234'},{...block,hash:null},
  {...block,timestamp:'latest'},{...block,timestamp:'0x'+'1'.repeat(65)}];
 for(const candidate of malformed){assert.equal(f.cache.remember('one',candidate,f.observe()),false);assert.equal(f.cache.get('one'),null);}
});

test('missing, future and nonfinite observations cannot start a new age budget',()=>{
 const f=fixture();
 for(const observation of[null,undefined,{},Promise.resolve(f.observe()),{observedAt:1000},{monotonicAt:100},
  {observedAt:1001,monotonicAt:100},{observedAt:1000,monotonicAt:101},
  {observedAt:NaN,monotonicAt:100},{observedAt:1000,monotonicAt:Infinity}]){
  assert.equal(f.cache.remember('one',block,observation),false);assert.equal(f.cache.get('one'),null);
 }
});

test('only primitive header fields are retained and every hit is an independent copy',()=>{
 const f=fixture(),source={...block,request:()=>{},signal:new AbortController().signal,url:'https://user:secret@rpc.invalid',policy:{mutable:true}};
 const observation={...f.observe(),request:()=>{},policy:{mutable:true}};
 assert.equal(f.cache.remember('one',source,observation),true);
 source.number='0xffff';source.hash=nextBlock.hash;observation.observedAt=999999;
 const first=f.cache.get('one');assert.deepEqual(first,block);assert.deepEqual(Object.keys(first),['number','hash','timestamp']);
 first.hash=nextBlock.hash;first.number='0xffff';
 const second=f.cache.get('one');assert.notEqual(first,second);assert.deepEqual(second,block);
});

test('validated header and observation values cannot be replaced by later accessor reads',()=>{
 const f=fixture();let numberReads=0,observationReads=0;
 const source={...block,get number(){return++numberReads<=2?block.number:{request:()=>{}};}};
 const observation={monotonicAt:100,get observedAt(){return++observationReads===1?1000:{request:()=>{}};}};
 assert.equal(f.cache.remember('one',source,observation),true);
 assert.deepEqual(f.cache.get('one'),block);
});

test('out-of-order completion cannot replace a newer fresh header',()=>{
 const f=fixture(),old=f.observe();f.advance(100);const current=f.observe();
 assert.equal(f.cache.remember('one',nextBlock,current),true);f.advance(100);
 assert.equal(f.cache.remember('one',block,old),false);assert.deepEqual(f.cache.get('one'),nextBlock);
 f.advance(400);assert.equal(f.cache.get('one'),null,'rejected completion never extends the newer observation');
});

test('entry count is bounded and hits do not shield the oldest insertion from eviction',()=>{
 const f=fixture({maxNodes:2});f.cache.remember('one',block,f.observe());f.cache.remember('two',nextBlock,f.observe());
 assert.deepEqual(f.cache.get('one'),block);f.cache.remember('three',block,f.observe());
 assert.equal(f.cache.get('one'),null);assert.deepEqual(f.cache.get('two'),nextBlock);assert.deepEqual(f.cache.get('three'),block);
 f.advance(1);f.cache.remember('two',block,f.observe());f.cache.remember('four',nextBlock,f.observe());
 assert.equal(f.cache.get('three'),null);assert.deepEqual(f.cache.get('two'),block);assert.deepEqual(f.cache.get('four'),nextBlock);
});

test('default node capacity remains bounded at sixteen',()=>{
 const f=fixture();for(let i=0;i<17;i++)f.cache.remember(`node-${i}`,block,f.observe());
 assert.equal(f.cache.get('node-0'),null);assert.deepEqual(f.cache.get('node-1'),block);assert.deepEqual(f.cache.get('node-16'),block);
});

test('custom age is respected and invalid cache configuration is rejected',()=>{
 const f=fixture({maxAgeMs:20});f.cache.remember('one',block,f.observe());f.advance(20);assert.equal(f.cache.get('one'),null);
 for(const options of[{clock:null},{monotonic:null},{maxAgeMs:0},{maxAgeMs:-1},{maxAgeMs:Infinity},{maxNodes:0},{maxNodes:1.5}]){
  assert.throws(()=>createBalanceHeaderCache(options),{code:'INVALID_INPUT'});
 }
});

test('empty and nonopaque node ids cannot retain headers or affect a valid node',()=>{
 const f=fixture();f.cache.remember('one',block,f.observe());
 for(const node of[null,undefined,{},'', 'https://user:secret@rpc.invalid','x'.repeat(129)]){
  assert.equal(f.cache.remember(node,nextBlock,f.observe()),false);assert.equal(f.cache.get(node),null);assert.equal(f.cache.invalidate(node),false);
 }
 assert.deepEqual(f.cache.get('one'),block);
});
