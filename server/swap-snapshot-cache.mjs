import {ethers} from 'ethers';
import {SWAP_ABI,SWAP_ADAPTERS,swapActiveRouter} from '../src/swap-aggregator.mjs?v=mainnet-20261113-47';

const MULTICALL='0xca11bde05977b3631167028862be2a173976ca11';
const abi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const protocol=new ethers.Interface([...SWAP_ABI,
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)',
 'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)',
 'function balanceOf(address) view returns(uint256)',
]);
// ethers resolves a hex selector by hashing each ABI function on every scan.
// Compile the fixed ABI once; passing its fragments retains the same decoder.
const fragmentsBySelector=new Map();
protocol.forEachFunction(fragment=>{
 const selector=fragment.selector,previous=fragmentsBySelector.get(selector);
 if(previous&&previous.format('sighash')!==fragment.format('sighash'))throw new Error('Ambiguous raw snapshot ABI selector');
 fragmentsBySelector.set(selector,fragment);
});
const QUOTER='0xb048bbc1ee6b733fffcfb9e9cef7375518e25997';
const ORACLES=new Set([
 '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee','0xb97ad0e74fa7d920791e90258a6e2085088b4320',
 '0x51597f405303c4377e36123cbc172b13269ea163','0x264990fbd0a4796a3e3d8e37c4d5f87a3aca5ebf',
 '0x9ef1b8c0e4f7dc8bf5719ea496883dc6401d5b2e',
]);
const ADAPTERS=new Set(Object.values(SWAP_ADAPTERS).map(adapter=>adapter.adapter.toLowerCase()));
const selectors=names=>new Set(names.map(name=>protocol.getFunction(name).selector));
const ROUTER_READS=selectors(['platformFeeBps','feeReceiver','WBNB','adapters','VERSION','defaultFeeToken','feeConfigVersion','getPairInfo','getAmountsOutVia']);
const ORACLE_READS=selectors(['latestRoundData','decimals']),POOL_READS=selectors(['slot0','liquidity','token0','token1']);
const FACTORY=protocol.getFunction('factory').selector,GET_POOL=protocol.getFunction('getPool').selector,AGGREGATOR=protocol.getFunction('aggregator').selector,DEPTH=protocol.getFunction('quoteExactInputSingle').selector;
const AMOUNTS=protocol.getFunction('getAmountsOutVia').selector;
const BALANCE=protocol.getFunction('balanceOf').selector;
const snapshots=new WeakMap();
const abortError=signal=>Object.assign(new Error(signal?.reason?.name==='TimeoutError'?'REQUEST_TIMEOUT':'REQUEST_ABORTED'),{code:signal?.reason?.name==='TimeoutError'?'REQUEST_TIMEOUT':'REQUEST_ABORTED'});
const assertActive=signal=>{if(signal?.aborted)throw abortError(signal);};
const invalid=()=>Object.assign(new Error('Invalid raw snapshot cache'),{code:'INVALID_INPUT'});

// Only primitive completed results are retained: trusted individual reads or
// exact full state traces. Both share one entry/byte budget. Readers, promises,
// signals, decoded configuration and mutable policy objects never enter here.
export function createRawSnapshot({nodeId,block,capturedAt,maxEntries=2048,maxBytes=2*1024*1024}={}){
 if(typeof nodeId!=='string'||!nodeId||!/^0x[0-9a-f]+$/i.test(block?.number||'')||!/^0x[0-9a-f]{64}$/i.test(block?.hash||'')||!/^0x[0-9a-f]+$/i.test(block?.timestamp||'')||!Number.isFinite(capturedAt)||!Number.isInteger(maxEntries)||maxEntries<1||!Number.isInteger(maxBytes)||maxBytes<1)throw invalid();
 const snapshot=Object.freeze({nodeId,block:Object.freeze({...block}),capturedAt});
 snapshots.set(snapshot,{calls:new Map(),factories:new Set(),pools:new Set(),bytes:0,maxEntries,maxBytes});return snapshot;
}

// Every binding belongs to the current provider attempt. Cache misses use its
// current request/signal; an old canceled attempt can never supply a closure.
export function snapshotReader(snapshot,request,{nodeId,signal}={}){
 const store=snapshots.get(snapshot);if(!store||snapshot.nodeId!==nodeId||typeof request!=='function')throw invalid();
 const router=swapActiveRouter().toLowerCase();
 function trusted(call){
  const target=call.target.toLowerCase(),selector=call.callData.slice(0,10).toLowerCase();
  return target===router&&ROUTER_READS.has(selector)||ADAPTERS.has(target)&&selector===AGGREGATOR||ORACLES.has(target)&&ORACLE_READS.has(selector)||target===QUOTER&&[FACTORY,DEPTH].includes(selector)||store.factories.has(target)&&selector===GET_POOL||store.pools.has(target)&&POOL_READS.has(selector);
 }
 function stateTrace(calls){
  return calls.length>0&&calls.every(call=>{
   const target=call.target.toLowerCase(),selector=call.callData.slice(0,10).toLowerCase();
   if(store.pools.has(target)&&POOL_READS.has(selector))return true;
   if(selector!==BALANCE)return false;
   try{return store.pools.has(protocol.decodeFunctionData('balanceOf',call.callData)[0].toLowerCase());}catch{return false;}
  });
 }
 function learn(call,data){
  const target=call.target.toLowerCase(),selector=call.callData.slice(0,10).toLowerCase();
  let set,method;
  if(target===QUOTER&&selector===FACTORY){set=store.factories;method='factory';}
  else if(store.factories.has(target)&&selector===GET_POOL){set=store.pools;method='getPool';}
  if(set)try{const address=protocol.decodeFunctionResult(method,data)[0].toLowerCase();if(address!==ethers.ZeroAddress){if(set.size>=store.maxEntries)set.delete(set.values().next().value);set.add(address);}}catch{/* An invalid proof never grants a target cache access. */}
 }
 function complete(call,data){
  try{
   const selector=call.callData.slice(0,10).toLowerCase(),fragment=fragmentsBySelector.get(selector);
   if(!fragment)return false;
   const values=protocol.decodeFunctionResult(fragment,data);
   if(selector===AMOUNTS){const args=protocol.decodeFunctionData(fragment,call.callData);return values[0].length===args[2].length&&values[0][0]===args[1]&&values[0].every(value=>value>0n);}
   if(selector===DEPTH&&values[0]<=0n)return false;
   // A missing optional factory must remain a fresh miss for the policy's
   // normal discovery fallback rather than poisoning it with an empty proof.
   return !(call.target.toLowerCase()===QUOTER&&selector===FACTORY&&values[0].toLowerCase()===ethers.ZeroAddress);
  }catch{return false;}
 }
 function remember(key,data){
  if(store.calls.has(key))return;
  const bytes=Buffer.byteLength(key)+Buffer.byteLength(data);
  if(bytes>store.maxBytes)return;
  while(store.calls.size>=store.maxEntries||store.bytes+bytes>store.maxBytes){
   const first=store.calls.keys().next().value,old=store.calls.get(first);store.calls.delete(first);store.bytes-=Buffer.byteLength(first)+Buffer.byteLength(old);
  }
  store.calls.set(key,data);store.bytes+=bytes;
 }
 return async payload=>{
  assertActive(signal);
  const tx=payload?.params?.[0],tag=payload?.params?.[1];
  if(payload?.method!=='eth_call'||payload.params?.length!==2||!tx||typeof tx!=='object'||Object.keys(tx).some(key=>!['to','data'].includes(key))||String(tx.to).toLowerCase()!==MULTICALL||typeof tx.data!=='string'||typeof tag!=='string'||tag.toLowerCase()!==snapshot.block.number.toLowerCase())return request(payload);
  const traceKey='trace:'+MULTICALL+':'+tx.data.toLowerCase(),fullKey='full:'+MULTICALL+':'+tx.data.toLowerCase();
  // These private entries exist only after this snapshot fully validates the
  // same original calldata. The outer context gates above still run first;
  // no external DTO can authorize skipping ABI work or a transaction check.
  if(store.calls.has(traceKey))return store.calls.get(traceKey);
  if(store.calls.has(fullKey))return store.calls.get(fullKey);
  let decoded;try{decoded=abi.decodeFunctionData('tryAggregate',tx.data);}catch{return request(payload);}
  if(decoded[0]!==false)return request(payload);
  const calls=Array.from(decoded[1],call=>({target:call.target,callData:call.callData,key:[call.target,call.callData].join(':').toLowerCase()}));
  // A token's balanceOf need not be view. Preserve the entire original CALL
  // trace, including duplicates and transient writes, rather than splitting
  // or learning any of its rows. Only balances of factory-proven pools and
  // those pools' known state selectors qualify; other unknown calls bypass.
  if(calls.some(call=>!trusted(call))){
   if(!stateTrace(calls))return request(payload);
   const raw=await request(payload);assertActive(signal);
   let result;try{result=abi.decodeFunctionResult('tryAggregate',raw)[0];}catch{return raw;}
   if(result.length===calls.length&&result.every((entry,n)=>entry.success&&complete(calls[n],entry.returnData)))remember(traceKey,raw);
   return raw;
  }
  // Keep this read's completed hits stable if another bound reader causes
  // eviction while its own missing calls are still in flight.
  const hits=new Map(calls.filter(call=>store.calls.has(call.key)).map(call=>[call.key,store.calls.get(call.key)]));
  const missing=[...new Map(calls.filter(call=>!hits.has(call.key)).map(call=>[call.key,call])).values()],entries=new Map();
  if(missing.length){
   const raw=await request({...payload,params:[{...tx,data:abi.encodeFunctionData('tryAggregate',[false,missing.map(call=>[call.target,call.callData])])},tag]});
   assertActive(signal);
   const result=abi.decodeFunctionResult('tryAggregate',raw)[0];
   if(result.length!==missing.length)throw Object.assign(new Error('Incomplete raw snapshot response'),{code:'UPSTREAM_UNAVAILABLE'});
   missing.forEach((call,index)=>entries.set(call.key,{success:result[index].success,returnData:result[index].returnData}));
  }
  const ordered=calls.map(call=>entries.has(call.key)?[entries.get(call.key).success,entries.get(call.key).returnData]:[true,hits.get(call.key)]);
  const raw=abi.encodeFunctionResult('tryAggregate',[ordered]);assertActive(signal);
  for(const call of calls)if(hits.has(call.key))learn(call,hits.get(call.key));
  let allComplete=true;
  for(const call of missing){
   const entry=entries.get(call.key),valid=entry.success&&complete(call,entry.returnData);
   if(valid){learn(call,entry.returnData);remember(call.key,entry.returnData);}else allComplete=false;
  }
  // Existing row hits were already validated. Reuse each missing row's check
  // above instead of decoding again just to admit the final complete response.
  if(allComplete)remember(fullKey,raw);
  return raw;
 };
}
