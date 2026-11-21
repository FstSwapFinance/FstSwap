import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createRawSnapshot,snapshotReader} from '../server/swap-snapshot-cache.mjs';
import {readSwapConfig,readSwapConfigFactory,SWAP_ABI,SWAP_ADAPTERS,SWAP_TOKENS,swapActiveRouter} from '../src/swap-aggregator.mjs?v=mainnet-20261113-47';
globalThis.ethers=ethers;

const MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11',TARGET=swapActiveRouter(),TOKEN='0x'+'11'.repeat(20);
const abi=new ethers.Interface([
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function getAmountsOutVia(address,uint256,address[]) view returns(uint256[])',
]);
const block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x123456'};
const snapshot=options=>createRawSnapshot({nodeId:'one',block,capturedAt:1000,...options});
const child=n=>[TARGET,abi.encodeFunctionData('getAmountsOutVia',[TOKEN,n,[TOKEN,TARGET]])];
const payload=(values,patch={})=>({method:'eth_call',params:[{to:MULTICALL,data:abi.encodeFunctionData('tryAggregate',[false,values.map(child)])},block.number],...patch});
const values=raw=>Array.from(abi.decodeFunctionResult('tryAggregate',raw)[0],row=>row.success?abi.decodeFunctionResult('getAmountsOutVia',row.returnData)[0][1]:null);
const response=(numbers,failed=[])=>abi.encodeFunctionResult('tryAggregate',[numbers.map(n=>failed.includes(Number(n))?[false,'0x']:[true,abi.encodeFunctionResult('getAmountsOutVia',[[n,n]])])]);
const decode=p=>Array.from(abi.decodeFunctionData('tryAggregate',p.params[0].data)[1],row=>abi.decodeFunctionData('getAmountsOutVia',row.callData)[1]);
function upstream(){const calls=[];return{calls,request:async p=>{const numbers=decode(p);calls.push(numbers);return response(numbers);}};}

test('completed subcalls reassemble hits, misses and duplicate positions in the requested order',async()=>{
 const source=upstream(),s=snapshot(),read=snapshotReader(s,source.request,{nodeId:'one'});
 assert.deepEqual(values(await read(payload([1,2]))),[1n,2n]);
 assert.deepEqual(values(await read(payload([2,3,1,3]))),[2n,3n,1n,3n]);
 assert.deepEqual(source.calls,[[1n,2n],[3n]]);
 assert.deepEqual(values(await read(payload([3,1]))),[3n,1n]);assert.equal(source.calls.length,2);
});

test('a snapshot never shares raw state across providers or block hashes',async()=>{
 const source=upstream(),s=snapshot();await snapshotReader(s,source.request,{nodeId:'one'})(payload([1]));
 assert.throws(()=>snapshotReader(s,source.request,{nodeId:'two'}),{code:'INVALID_INPUT'});
 const second=snapshot({nodeId:'two'}),fork=snapshot({block:{...block,hash:'0x'+'cd'.repeat(32)}});
 await snapshotReader(second,source.request,{nodeId:'two'})(payload([1]));
 await snapshotReader(fork,source.request,{nodeId:'one'})(payload([1]));
 assert.equal(source.calls.length,3);
});

test('wrong blocks, strict aggregates, transaction context and unrelated RPCs bypass the cache',async()=>{
 let calls=0;const s=snapshot(),read=snapshotReader(s,async()=>{calls++;return'untouched';},{nodeId:'one'});
 const base=payload([1]);
 for(const p of [
  {...base,params:[base.params[0],'0x101']},
  {...base,params:[{...base.params[0],from:TARGET},block.number]},
  {...base,params:[{...base.params[0],value:'0x0'},block.number]},
  {...base,params:[base.params[0],block.number,{}]},
  {...base,params:[{...base.params[0],data:abi.encodeFunctionData('tryAggregate',[true,[child(1)]])},block.number]},
  {method:'eth_getBlockByNumber',params:[block.number,false]},
 ])assert.equal(await read(p),'untouched');
 assert.equal(calls,6);
});

test('failed rows and malformed or incomplete batches never become completed cache entries',async()=>{
 const s=snapshot();let calls=0;
 const read=snapshotReader(s,async p=>{calls++;return response(decode(p),calls===1?[2]:[]);},{nodeId:'one'});
 assert.deepEqual(values(await read(payload([1,2]))),[1n,null]);
 assert.deepEqual(values(await read(payload([1,2]))),[1n,2n]);assert.equal(calls,2);
 for(const raw of['0x',response([])]){
  const fresh=snapshot();let bad=0;
  const reader=snapshotReader(fresh,async p=>++bad===1?raw:response(decode(p)),{nodeId:'one'});
  await assert.rejects(reader(payload([7])));assert.deepEqual(values(await reader(payload([7]))),[7n]);assert.equal(bad,2);
 }
});

test('a canceled attempt cannot publish late results or lend its reader to the next operation',async()=>{
 const s=snapshot(),controller=new AbortController();let release;
 const gate=new Promise(resolve=>release=resolve);
 const canceled=snapshotReader(s,async p=>{await gate;return response(decode(p));},{nodeId:'one',signal:controller.signal});
 const pending=canceled(payload([1]));controller.abort();release();await assert.rejects(pending,{code:'REQUEST_ABORTED'});
 const next=upstream(),read=snapshotReader(s,next.request,{nodeId:'one'});
 assert.deepEqual(values(await read(payload([1]))),[1n]);assert.deepEqual(next.calls,[[1n]]);
 controller.abort();await assert.rejects(canceled(payload([1])),{code:'REQUEST_ABORTED'});
});

test('concurrent operations never share an unfinished request or cancel each other',async()=>{
 const s=snapshot(),controller=new AbortController(),calls=[];let release;
 const gate=new Promise(resolve=>release=resolve);
 const first=snapshotReader(s,async p=>{calls.push('one');await gate;return response(decode(p));},{nodeId:'one',signal:controller.signal});
 const second=snapshotReader(s,async p=>{calls.push('two');return response(decode(p));},{nodeId:'one'});
 const pending=first(payload([1]));assert.deepEqual(values(await second(payload([1]))),[1n]);
 controller.abort();release();await assert.rejects(pending,{code:'REQUEST_ABORTED'});assert.deepEqual(calls,['one','two']);
});

test('entry and byte capacity are bounded while in-flight hit rows survive concurrent eviction',async()=>{
 const s=snapshot({maxEntries:1}),source=upstream(),read=snapshotReader(s,source.request,{nodeId:'one'});
 await read(payload([1]));let release,started;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
 const slow=snapshotReader(s,async p=>{started();await gate;return response(decode(p));},{nodeId:'one'});
 const pending=slow(payload([1,2]));await ready;await read(payload([3]));release();
 assert.deepEqual(values(await pending),[1n,2n]);
 await read(payload([1]));assert.deepEqual(source.calls,[[1n],[3n],[1n]]);
 const tiny=snapshot({maxBytes:1}),uncached=upstream(),tinyRead=snapshotReader(tiny,uncached.request,{nodeId:'one'});
 await tinyRead(payload([9]));await tinyRead(payload([9]));assert.equal(uncached.calls.length,2);
});

test('unknown targets and token balanceOf preserve the full original batch including duplicate calls',async()=>{
 const other=new ethers.Interface(['function balanceOf(address) view returns(uint256)']);
 const s=snapshot(),source=upstream(),read=snapshotReader(s,source.request,{nodeId:'one'});await read(payload([1]));
 const mixed={method:'eth_call',params:[{to:MULTICALL,data:abi.encodeFunctionData('tryAggregate',[false,[child(1),[TOKEN,other.encodeFunctionData('balanceOf',[TARGET])],child(1)]])},block.number]};
 const calls=[],uncached=snapshotReader(s,async p=>{calls.push(p);return'0x';},{nodeId:'one'});
 assert.equal(await uncached(mixed),'0x');assert.equal(await uncached(mixed),'0x');
 assert.equal(calls.length,2);assert.equal(calls[0].params[0].data,mixed.params[0].data);assert.equal(calls[1].params[0].data,mixed.params[0].data);
 const lookalike=payload([1]);lookalike.params[0].data=abi.encodeFunctionData('tryAggregate',[false,[[TOKEN,child(1)[1]]]]);
 assert.equal(await uncached(lookalike),'0x');assert.equal(await uncached(lookalike),'0x');assert.equal(calls.length,4);
});

test('trusted factory and pool discovery learns only from the fixed Quoter proof',async()=>{
 const quoter='0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',factory='0x'+'99'.repeat(20),pool='0x'+'88'.repeat(20),untrusted='0x'+'77'.repeat(20);
 const discovery=new ethers.Interface(['function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)']);
 const s=snapshot(),calls=[];
 const read=snapshotReader(s,async p=>{
  const children=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];calls.push(children.length);
  return abi.encodeFunctionResult('tryAggregate',[children.map(c=>{const parsed=discovery.parseTransaction({data:c.callData});return[true,discovery.encodeFunctionResult(parsed.name,parsed.name==='factory'?[factory]:parsed.name==='getPool'?[pool]:[1n,0,0,0,0,0,true])];})]);
 },{nodeId:'one'});
 const send=(target,name,args=[])=>read({method:'eth_call',params:[{to:MULTICALL,data:abi.encodeFunctionData('tryAggregate',[false,[[target,discovery.encodeFunctionData(name,args)]]])},block.number]});
 await send(quoter,'factory');await send(quoter,'factory');
 await send(factory,'getPool',[TOKEN,TARGET,500]);await send(factory,'getPool',[TOKEN,TARGET,500]);
 await send(pool,'slot0');await send(pool,'slot0');assert.equal(calls.length,3);
 await send(untrusted,'getPool',[TOKEN,TARGET,500]);await send(untrusted,'getPool',[TOKEN,TARGET,500]);assert.equal(calls.length,5);
});

test('cached raw config rebuilds a private factory proof for the current reader only',async()=>{
 const protocol=new ethers.Interface([...SWAP_ABI,'function factory() view returns(address)']);
 const s=snapshot(),factory='0x'+'99'.repeat(20);let calls=0;
 const request=async p=>{
  if(p.method==='eth_chainId')return'0x38';calls++;
  const children=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return abi.encodeFunctionResult('tryAggregate',[children.map(c=>{
   const parsed=protocol.parseTransaction({data:c.callData});
   const results={platformFeeBps:[30],feeReceiver:[TOKEN],WBNB:[SWAP_ADAPTERS.fst.weth],adapters:[true],aggregator:[swapActiveRouter()],VERSION:['2.1.0'],defaultFeeToken:[SWAP_TOKENS.usdt.address],feeConfigVersion:[4n],factory:[factory]};
   return[true,protocol.encodeFunctionResult(parsed.name,results[parsed.name])];
  })]);
 };
 const firstReader=snapshotReader(s,request,{nodeId:'one'}),first=await readSwapConfig(firstReader,{block});
 const currentReader=snapshotReader(s,request,{nodeId:'one'}),current=await readSwapConfig(currentReader,{block});
 assert.equal(calls,1);assert.notEqual(first,current);
 assert.equal(readSwapConfigFactory(current,currentReader,block),factory);
 assert.equal(readSwapConfigFactory(current,firstReader,block),null);
 assert.equal(readSwapConfigFactory({...current},currentReader,block),null);
});

test('a failed, zero or malformed optional factory never poisons normal fresh discovery',async()=>{
 const discovery=new ethers.Interface(['function factory() view returns(address)']),quoter='0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',factory='0x'+'99'.repeat(20);
 const p={method:'eth_call',params:[{to:MULTICALL,data:abi.encodeFunctionData('tryAggregate',[false,[[quoter,discovery.encodeFunctionData('factory',[])]]])},block.number]};
 for(const bad of[[false,'0x'],[true,'0x1234'],[true,discovery.encodeFunctionResult('factory',[ethers.ZeroAddress])]]){
  const s=snapshot();let calls=0;
  const read=snapshotReader(s,async()=>abi.encodeFunctionResult('tryAggregate',[[++calls===1?bad:[true,discovery.encodeFunctionResult('factory',[factory])]]]),{nodeId:'one'});
  await read(p);const raw=await read(p);assert.equal(calls,2);assert.equal(discovery.decodeFunctionResult('factory',abi.decodeFunctionResult('tryAggregate',raw)[0][0].returnData)[0].toLowerCase(),factory);
 }
});

test('successful quote rows with malformed data or mismatched input never poison the cache',async()=>{
 for(const data of['0x1234',abi.encodeFunctionResult('getAmountsOutVia',[[8n,9n]]),abi.encodeFunctionResult('getAmountsOutVia',[[7n,0n]])]){
  const s=snapshot();let calls=0;
  const read=snapshotReader(s,async p=>++calls===1?abi.encodeFunctionResult('tryAggregate',[[[true,data]]]):response(decode(p)),{nodeId:'one'});
  await read(payload([7]));assert.deepEqual(values(await read(payload([7]))),[7n]);assert.equal(calls,2);
 }
});

const stateAbi=new ethers.Interface(['function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)',
 'function token0() view returns(address)','function token1() view returns(address)','function balanceOf(address) view returns(uint256)']);
const QUOTER='0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',FACTORY='0x'+'99'.repeat(20),POOL='0x'+'88'.repeat(20);
const stateCall=(target,name,args=[])=>[target,stateAbi.encodeFunctionData(name,args)];
const statePayload=calls=>({method:'eth_call',params:[{to:MULTICALL,data:abi.encodeFunctionData('tryAggregate',[false,calls])},block.number]});
function stateSource(){
 const calls=[];
 const request=async p=>{
  calls.push(p);let transient=0;
  return abi.encodeFunctionResult('tryAggregate',[Array.from(abi.decodeFunctionData('tryAggregate',p.params[0].data)[1],c=>{
   const parsed=stateAbi.parseTransaction({data:c.callData});
   const result=parsed.name==='factory'?[FACTORY]:parsed.name==='getPool'?[POOL]:parsed.name==='slot0'?[2n**96n,0,0,0,0,0,true]:parsed.name==='balanceOf'?[BigInt(++transient)]:parsed.name==='liquidity'?[100n+BigInt(transient)]:[parsed.name==='token0'?TOKEN:TARGET];
   return[true,stateAbi.encodeFunctionResult(parsed.name,result)];
  })]);
 };
 return{calls,request};
}
async function provePool(read){await read(statePayload([stateCall(QUOTER,'factory')]));await read(statePayload([stateCall(FACTORY,'getPool',[TOKEN,TARGET,500])]));}
const mixedState=()=>statePayload([stateCall(POOL,'slot0'),stateCall(TOKEN,'balanceOf',[POOL]),stateCall(POOL,'liquidity'),stateCall(TOKEN,'balanceOf',[POOL]),stateCall(POOL,'token0')]);

test('an exact completed state trace preserves duplicate CALL effects without splitting or learning its rows',async()=>{
 const s=snapshot(),source=stateSource(),read=snapshotReader(s,source.request,{nodeId:'one'});await provePool(read);
 const p=mixedState(),first=await read(p),second=await read(p);
 assert.equal(first,second);assert.equal(source.calls.length,3,'the identical state trace reuses one completed original execution');
 assert.equal(source.calls[2].params[0].data,p.params[0].data,'a miss forwards the complete original trace byte for byte');
 const rows=abi.decodeFunctionResult('tryAggregate',first)[0];
 assert.equal(stateAbi.decodeFunctionResult('balanceOf',rows[1].returnData)[0],1n);
 assert.equal(stateAbi.decodeFunctionResult('liquidity',rows[2].returnData)[0],101n);
 assert.equal(stateAbi.decodeFunctionResult('balanceOf',rows[3].returnData)[0],2n);
 const isolated=await read(statePayload([stateCall(POOL,'liquidity')]));
 assert.equal(stateAbi.decodeFunctionResult('liquidity',abi.decodeFunctionResult('tryAggregate',isolated)[0][0].returnData)[0],100n,'a transient mixed result never leaks into trusted row cache');
 assert.equal(source.calls.length,4);
});

test('state trace identity includes complete ordering, duplicate positions, provider and block hash',async()=>{
 const s=snapshot(),source=stateSource(),read=snapshotReader(s,source.request,{nodeId:'one'});await provePool(read);
 const original=mixedState();await read(original);
 const reversed=statePayload(Array.from(abi.decodeFunctionData('tryAggregate',original.params[0].data)[1],c=>[c.target,c.callData]).reverse());
 await read(reversed);await read(reversed);assert.equal(source.calls.length,4);
 const fork=snapshot({block:{...block,hash:'0x'+'cd'.repeat(32)}}),other=snapshot({nodeId:'two'});
 for(const [next,id]of[[fork,'one'],[other,'two']]){const r=snapshotReader(next,source.request,{nodeId:id});await provePool(r);await r(original);}
 assert.equal(source.calls.length,10);
});

test('only pool-proven state traces qualify, never arbitrary balance owners, targets, selectors or transaction context',async()=>{
 const source=stateSource(),s=snapshot(),read=snapshotReader(s,source.request,{nodeId:'one'});
 const p=mixedState();await read(p);await read(p);assert.equal(source.calls.length,2,'unproved pool stays uncached');await provePool(read);
 const cases=[statePayload([stateCall(TOKEN,'balanceOf',[TARGET])]),statePayload([stateCall(TOKEN,'liquidity')]),statePayload([stateCall(QUOTER,'factory'),stateCall(TOKEN,'balanceOf',[POOL])])];
 for(const patch of[{from:TARGET},{value:'0x0'},{gas:'0x100000'},{accessList:[]}])cases.push({...p,params:[{...p.params[0],...patch},block.number]});
 const before=source.calls.length;for(const item of cases){await read(item);await read(item);}assert.equal(source.calls.length,before+cases.length*2);
});

test('failed, malformed and incomplete state traces are never cached',async()=>{
 for(const corrupt of[rows=>rows.slice(1),rows=>rows.map((r,n)=>n===1?[false,'0x']:r),rows=>rows.map((r,n)=>n===2?[true,'0x1234']:r)]){
  const source=stateSource(),s=snapshot();let corruptNext=false,count=0;
  const read=snapshotReader(s,async p=>{const raw=await source.request(p);if(!corruptNext)return raw;count++;const rows=Array.from(abi.decodeFunctionResult('tryAggregate',raw)[0],r=>[r.success,r.returnData]);return count===1?abi.encodeFunctionResult('tryAggregate',[corrupt(rows)]):raw;},{nodeId:'one'});
  await provePool(read);corruptNext=true;await read(mixedState());await read(mixedState());await read(mixedState());assert.equal(count,2,'only the complete successful retry is retained');
 }
});

test('state traces share the row cache capacity and a canceled trace never publishes late',async()=>{
 const source=stateSource(),s=snapshot({maxEntries:1}),read=snapshotReader(s,source.request,{nodeId:'one'});await provePool(read);await read(mixedState());
 await read(statePayload([stateCall(POOL,'liquidity')]));const before=source.calls.length;await read(mixedState());assert.equal(source.calls.length,before+1,'a row insertion evicts the trace under the same entry limit');
 const controller=new AbortController();let release;const gate=new Promise(resolve=>release=resolve);
 const slow=snapshotReader(s,async p=>{await gate;return source.request(p);},{nodeId:'one',signal:controller.signal});
 const changed=statePayload([stateCall(TOKEN,'balanceOf',[POOL]),stateCall(POOL,'liquidity')]),pending=slow(changed);controller.abort();release();await assert.rejects(pending,{code:'REQUEST_ABORTED'});
 const after=source.calls.length;await read(changed);assert.equal(source.calls.length,after+1);
 const tiny=snapshot({maxBytes:1}),tinyRead=snapshotReader(tiny,source.request,{nodeId:'one'});await provePool(tinyRead);const initial=source.calls.length;await tinyRead(mixedState());await tinyRead(mixedState());assert.equal(source.calls.length,initial+2);
});

function watchAbi(){
 const names=['decodeFunctionData','decodeFunctionResult','encodeFunctionData','encodeFunctionResult'],original=new Map(),calls=[];
 for(const name of names){original.set(name,ethers.Interface.prototype[name]);ethers.Interface.prototype[name]=function(...args){calls.push(name);return original.get(name).apply(this,args);};}
 return{calls,restore(){for(const[name,fn]of original)ethers.Interface.prototype[name]=fn;}};
}
test('a previously validated exact state trace hits before every ABI encoder and decoder',async()=>{
 const source=stateSource(),s=snapshot(),read=snapshotReader(s,source.request,{nodeId:'one'});await provePool(read);
 const p=mixedState(),first=await read(p),count=source.calls.length,watch=watchAbi();let second;
 try{second=await read(p);}finally{watch.restore();}
 assert.equal(second,first);assert.equal(source.calls.length,count);assert.deepEqual(watch.calls,[]);
});
test('a fully trusted completed batch hits its original duplicate order before ABI work',async()=>{
 const source=upstream(),read=snapshotReader(snapshot(),source.request,{nodeId:'one'}),p=payload([2,1,2]);
 const first=await read(p);assert.deepEqual(values(first),[2n,1n,2n]);const count=source.calls.length,watch=watchAbi();let second;
 try{second=await read(p);}finally{watch.restore();}
 assert.equal(second,first);assert.equal(source.calls.length,count);assert.deepEqual(watch.calls,[]);
});
test('completed aggregate fast hits never bypass the original transaction, block or strictness gates',async()=>{
 const source=upstream(),read=snapshotReader(snapshot(),source.request,{nodeId:'one'}),base=payload([1]);await read(base);
 const patches=[
  {...base,params:[{...base.params[0],from:TARGET},block.number]},
  {...base,params:[{...base.params[0],value:'0x0'},block.number]},
  {...base,params:[{...base.params[0],gas:'0x100000'},block.number]},
  {...base,params:[base.params[0],block.number,{}]},
  {...base,params:[base.params[0],'0x101']},
  {...base,params:[{...base.params[0],data:abi.encodeFunctionData('tryAggregate',[true,[child(1)]])},block.number]},
 ];
 for(const p of patches)await read(p);assert.equal(source.calls.length,1+patches.length);
});
test('cold validation uses precompiled function fragments without selector-hex scans',async()=>{
 const source=upstream(),read=snapshotReader(snapshot(),source.request,{nodeId:'one'}),p=payload([1,2]);
 const original=ethers.Interface.prototype.getFunction;let hexLookups=0;
 ethers.Interface.prototype.getFunction=function(key,...args){if(typeof key==='string'&&/^0x[0-9a-f]+$/i.test(key))hexLookups++;return original.call(this,key,...args);};
 let first;try{first=await read(p);}finally{ethers.Interface.prototype.getFunction=original;}
 assert.deepEqual(values(first),[1n,2n]);assert.equal(hexLookups,0);
});
test('zero-depth output cannot enter the complete fast cache and a positive retry can',async()=>{
 const depth=new ethers.Interface(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
 const p=statePayload([[QUOTER,depth.encodeFunctionData('quoteExactInputSingle',[[TOKEN,TARGET,7n,500,0]])]]);
 let calls=0;const read=snapshotReader(snapshot(),async()=>abi.encodeFunctionResult('tryAggregate',[[[true,depth.encodeFunctionResult('quoteExactInputSingle',[++calls===1?0n:9n,2n**96n,0,0])]]]),{nodeId:'one'});
 const first=await read(p),second=await read(p);assert.notEqual(first,second);assert.equal(calls,2);
 const watch=watchAbi();let third;try{third=await read(p);}finally{watch.restore();}
 assert.equal(third,second);assert.equal(calls,2);assert.deepEqual(watch.calls,[]);
});
test('complete response admission reuses each missing quote row validation exactly once',async()=>{
 const source=upstream(),read=snapshotReader(snapshot(),source.request,{nodeId:'one'}),p=payload([1,2,1]);
 const original=ethers.Interface.prototype.decodeFunctionResult;let validated=0;
 ethers.Interface.prototype.decodeFunctionResult=function(fragment,...args){if(fragment?.name==='getAmountsOutVia'||fragment===abi.getFunction('getAmountsOutVia').selector)validated++;return original.call(this,fragment,...args);};
 try{await read(p);}finally{ethers.Interface.prototype.decodeFunctionResult=original;}
 assert.equal(validated,2,'one validation for each unique missing row, none for final full-response admission');
});
