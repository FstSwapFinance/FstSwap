import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createEngine} from '../server/fstswap-service.mjs';
import {SWAP_ABI,SWAP_ADAPTERS,SWAP_TOKENS,readSwapConfig,swapActiveRouter} from '../src/swap-aggregator.mjs?v=mainnet-20261113-50';
import {readFstPoolPolicy} from '../src/swap-fstswap.mjs?v=mainnet-20261113-50';

const Z=ethers.ZeroAddress,U=SWAP_TOKENS.usdt.address.toLowerCase(),F=SWAP_TOKENS.fist.address.toLowerCase(),W=SWAP_ADAPTERS.pancake.weth.toLowerCase();
const C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',BTC='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',ETH='0x2170ed0880ac9a755fd29b2688956bd959f933f8',S=10n**18n;
const hotPairs=[{tokenIn:U,tokenOut:F},{tokenIn:Z,tokenOut:U},{tokenIn:U,tokenOut:Z}];
const input=pair=>({chainId:56,...pair,amountIn:S.toString(),slippageBps:50,singleHop:false});
const gate=()=>{let release;return{promise:new Promise(resolve=>release=resolve),release};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const E=new ethers.Interface([...SWAP_ABI,
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)',
 'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)',
 'function token0() view returns(address)','function token1() view returns(address)','function balanceOf(address) view returns(uint256)',
 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)',
 'function quoteExactIn(bytes,uint256) returns(uint256)',
]);
const fingerprint=policy=>({
 pools:[...policy.pools.values()].map(pool=>({...pool})),prices:[...policy.prices],main:[...policy.main].map(([token,pool])=>[token,pool.id]),
 admission:[...policy.pools.values()].map(pool=>[pool.id,policy.allows(pool.kind==='v3'?{adapter:pool.adapter,kind:'v3',path:pool.a+pool.fee.toString(16).padStart(6,'0')+pool.b.slice(2)}:{adapter:pool.adapter,path:[pool.a,pool.b]})]),
});
// Exercise real config decoding, factory proofs, raw-row/trace caching, per-pair
// pool discovery, admission and quote construction. Only the RPC transport is synthetic.
function fixture(t,{warmup={},policyHook,rotateWarmNodes=false}={}){
 let now=1800000000000,sequence=255,warmAssignments=0,frontNode='one';
 const headers=new Map(),pools=new Map(),calls=[],policies=[],configs=[],runs=[],reorgs=new Set();
 const requestFor=nodeId=>async payload=>{
  calls.push({nodeId,...payload});
  if(payload.method==='eth_chainId')return'0x38';
  if(payload.method==='eth_getBlockByNumber'){
   if(payload.params[0]==='latest'){
    const number='0x'+(++sequence).toString(16),block={number,hash:'0x'+sequence.toString(16).padStart(64,'0'),timestamp:ethers.toQuantity(Math.floor(now/1000))};
    headers.set(number,block);return{...block};
   }
   return{...headers.get(payload.params[0]),...(reorgs.has(payload.params[0])?{hash:'0x'+'ff'.repeat(32)}:{})};
  }
  assert.equal(payload.method,'eth_call');
  assert.ok(headers.has(payload.params[1]),'every read uses a captured explicit block');
  const rows=E.decodeFunctionData('tryAggregate',payload.params[0].data)[1];
  return E.encodeFunctionResult('tryAggregate',[rows.map(call=>{
   const parsed=E.parseTransaction({data:call.callData}),args=parsed.args;let values;
   if(parsed.name==='platformFeeBps')values=[30];
   else if(parsed.name==='feeReceiver')values=['0x'+'12'.repeat(20)];
   else if(parsed.name==='WBNB')values=[W];
   else if(parsed.name==='adapters')values=[true];
   else if(parsed.name==='aggregator')values=[swapActiveRouter()];
   else if(parsed.name==='VERSION')values=['2.1.0'];
   else if(parsed.name==='defaultFeeToken')values=[U];
   else if(parsed.name==='feeConfigVersion')values=[1n];
   else if(parsed.name==='latestRoundData')values=[1n,100000000n,0n,BigInt(Number(BigInt(headers.get(payload.params[1]).timestamp))),1n];
   else if(parsed.name==='decimals')values=[8];
   else if(parsed.name==='factory')values=['0x'+'99'.repeat(20)];
   else if(parsed.name==='getPairInfo'){
    const tokens=[args[1].toLowerCase(),args[2].toLowerCase()].sort();
    const exists=tokens.includes(U)&&(tokens.includes(F)||tokens.includes(W));
    const address=exists?'0x'+ethers.keccak256(ethers.toUtf8Bytes(args[0].toLowerCase()+tokens.join(':'))).slice(-40):Z;
    values=[address,...tokens,exists?1000000n*S:0n,exists?1000000n*S:0n,1n,0n];
   }else if(parsed.name==='getPool'){
    const tokens=[args[0].toLowerCase(),args[1].toLowerCase()].sort(),fee=Number(args[2]);
    const exists=fee===500&&(tokens.every(token=>[U,C,W,BTC,ETH].includes(token))||tokens.includes(F)&&tokens.includes(U));
    const address=exists?'0x'+ethers.keccak256(ethers.toUtf8Bytes(tokens.join(':')+':'+fee)).slice(-40):Z;
    if(exists)pools.set(address.toLowerCase(),tokens);values=[address];
   }else if(parsed.name==='slot0')values=[2n**96n,0,0,0,0,0,true];
   else if(parsed.name==='liquidity'||parsed.name==='balanceOf')values=[400000n*S];
   else if(parsed.name==='token0'||parsed.name==='token1')values=[pools.get(call.target.toLowerCase())[parsed.name==='token0'?0:1]];
   else if(parsed.name==='quoteExactInputSingle')values=[args[0][2]*BigInt(1000000-Number(args[0][3]))/1000000n,2n**96n,0,0];
   else if(parsed.name==='getAmountsOutVia')values=[[args[1],args[1]*9975n/10000n]];
   else if(parsed.name==='quoteExactIn')values=[args[1]*(1000000n-BigInt('0x'+args[0].slice(42,48)))/1000000n];
   else throw Error('Unexpected fixture method '+parsed.name);
   return[true,E.encodeFunctionResult(parsed.name,values)];
  })]);
 };
 const pool={run:(fn,signal,options={})=>{
  const nodeId=options.nodeId||(options.operation==='warm'?(rotateWarmNodes?['one','two','three'][warmAssignments++%3]:'one'):frontNode);
  runs.push({nodeId,signal,options});return Promise.resolve().then(()=>fn(requestFor(nodeId),{id:nodeId},signal));
 }};
 const engine=createEngine(pool,{clock:()=>now,warmup,
  readConfig:async(read,options)=>{const config=await readSwapConfig(read,options);configs.push(config);return config;},
  readPolicy:async(read,options)=>{
   const item={...options,index:policies.length};policies.push(item);await policyHook?.(item);
   const policy=await readFstPoolPolicy(read,options);item.policy=policy;return policy;
  },
 });
 t.after(()=>engine.stopWarmup());
 const children=()=>calls.filter(call=>call.method==='eth_call').flatMap(call=>Array.from(E.decodeFunctionData('tryAggregate',call.params[0].data)[1]));
 return{engine,calls,policies,configs,runs,advance:ms=>now+=ms,now:()=>now,setNode:node=>frontNode=node,reorg:number=>reorgs.add(number),clearReorgs:()=>reorgs.clear(),
  latest:()=>calls.filter(call=>call.method==='eth_getBlockByNumber'&&call.params[0]==='latest'),
  rows:()=>children().length,methodRows:name=>children().filter(call=>E.parseTransaction({data:call.callData}).name===name).length,
 };
}

test('default hot pairs share one fresh node/header while preserving independent same-block policies and exact quotes',async t=>{
 const shared=fixture(t,{rotateWarmNodes:true});assert.equal(await shared.engine.warmupOnce(),true);
 assert.deepEqual(shared.policies.map(({tokenIn,tokenOut})=>({tokenIn,tokenOut})),hotPairs,'all three default directions are prepared before foreground use');
 assert.equal(shared.latest().length,1,'one cycle must capture only one latest header');
 assert.deepEqual([...new Set(shared.policies.map(item=>item.nodeId))],['one']);
 assert.deepEqual([...new Set(shared.policies.map(item=>item.block.hash))],['0x'+'100'.padStart(64,'0')]);
 const sharedRows=shared.rows(),sharedCalls=shared.calls.length;let separateRows=0,separateCalls=0;
 for(let n=0;n<hotPairs.length;n++){
  const independent=fixture(t,{warmup:{pairs:[hotPairs[n]]}});assert.equal(await independent.engine.warmupOnce(),true);
  separateRows+=independent.rows();separateCalls+=independent.calls.length;
  assert.deepEqual(fingerprint(shared.policies[n].policy),fingerprint(independent.policies[0].policy),'raw sharing must preserve pool order, main pools and every admission decision');
  const expected=await independent.engine.quote(input(hotPairs[n])),actual=await shared.engine.quote(input(hotPairs[n]));
  assert.deepEqual(actual,expected,'the real prepared quote is identical to separate construction at the same block');
  if(n>0)assert.equal([...shared.policies[n].policy.pools.values()].some(pool=>pool.a===F||pool.b===F),false,'BNB/USDT cannot inherit FIST pools from the first warm pair');
 }
 assert.ok(sharedRows<separateRows,`${sharedRows} shared raw rows must be below ${separateRows} separate raw rows`);
 assert.ok(sharedCalls<separateCalls,`${sharedCalls} shared RPC calls must be below ${separateCalls} separate RPC calls`);
 t.diagnostic(`Synthetic fixed-block transport: shared ${sharedCalls} RPC calls / ${sharedRows} child rows; separate ${separateCalls} RPC calls / ${separateRows} child rows.`);
 assert.equal(shared.methodRows('platformFeeBps'),1,'completed trusted config rows are reused without reusing config objects');
 assert.equal(new Set(shared.configs).size,3);assert.equal(new Set(shared.policies.map(item=>item.policy)).size,3);
});

test('default pair expansion still obeys the configured maxPairs bound',async t=>{
 const f=fixture(t,{warmup:{maxPairs:2}});assert.equal(await f.engine.warmupOnce(),true);
 assert.deepEqual(f.policies.map(({tokenIn,tokenOut})=>({tokenIn,tokenOut})),hotPairs.slice(0,2));assert.equal(f.latest().length,1);
});

test('a later pair failure publishes none of the new cycle and keeps every previous completed policy',async t=>{
 let failSecond=false;
 const f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(failSecond&&item.index===4)throw Error('second pair unavailable');}});
 assert.equal(await f.engine.warmupOnce(),true);
 const previous=await Promise.all(hotPairs.map(pair=>f.engine.quote(input(pair))));
 f.advance(3000);failSecond=true;assert.equal(await f.engine.warmupOnce(),false);
 for(let n=0;n<hotPairs.length;n++){
  const current=await f.engine.quote({...input(hotPairs[n]),amountIn:(S+1n).toString()});
  assert.equal(current.blockHash,previous[n].blockHash,'an earlier completed pair from the failed cycle cannot replace its prior context');
  assert.equal(current.expiresAt,previous[n].expiresAt);
 }
 assert.equal(f.policies.length,5,'failed cycle must not evict old policies or build a hidden replacement');
});

test('a matching foreground that pauses a multi-pair refresh cannot publish only its first completed replacement',async t=>{
 const pairs=hotPairs.slice(0,2),warmStarted=gate(),warmHeld=gate(),calculationStarted=gate(),calculationHeld=gate(),headers=new Map();
 let now=1800000000000,height=255,policies=0,hold=false;
 const request=async payload=>{
  if(payload.params[0]==='latest'){
   const number='0x'+(++height).toString(16),block={number,hash:'0x'+height.toString(16).padStart(64,'0'),timestamp:ethers.toQuantity(Math.floor(now/1000))};
   headers.set(number,block);return block;
  }
  return headers.get(payload.params[0]);
 };
 const engine=createEngine({run:(fn,signal)=>Promise.resolve().then(()=>fn(request,{id:'one'},signal))},{clock:()=>now,warmup:{pairs},
  readConfig:async()=>({version:'1.11'}),
  readPolicy:async()=>{policies++;if(hold&&policies===3){warmStarted.release();await warmHeld.promise;}return{checkedAt:now,assertFresh(){}};},
  calculate:async(_read,trade)=>{if(hold&&trade.amountIn==='100'){calculationStarted.release();await calculationHeld.promise;}return{out:200n};},
 });
 t.after(()=>{warmHeld.release();calculationHeld.release();engine.stopWarmup();});
 assert.equal(await engine.warmupOnce(),true);
 now+=3000;hold=true;const warming=engine.warmupOnce();await warmStarted.promise;
 const foreground=engine.quote({...input(pairs[0]),amountIn:'100'});await calculationStarted.promise;
 warmHeld.release();assert.equal(await warming,false,'a cycle interrupted before all selected pairs finish must decline publication');
 calculationHeld.release();const retained=await foreground;
 const first=await engine.quote({...input(pairs[0]),amountIn:'2'}),sibling=await engine.quote({...input(pairs[1]),amountIn:'2'});
 assert.equal(policies,3,'foreground should keep using the completed old buffer rather than rescan either policy');
 assert.equal(first.blockNumber,'0x100');assert.equal(sibling.blockHash,first.blockHash);assert.equal(retained.blockHash,first.blockHash);
 assert.equal(first.expiresAt,1800000015000);assert.equal(sibling.expiresAt,first.expiresAt);
});

test('a failed first cycle cannot make its partially completed raw snapshot available to another pair',async t=>{
 let fail=true;
 const f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(fail&&item.index===1)throw Error('second pair unavailable');}});
 assert.equal(await f.engine.warmupOnce(),false);fail=false;
 const quote=await f.engine.quote(input(hotPairs[2]));
 assert.equal(quote.blockNumber,'0x101','no raw header/rows from the incomplete cycle are published');assert.equal(f.latest().length,2);
});

test('canceling a later pair keeps the entire old buffer and an abort-ignoring late result has no publication rights',async t=>{
 const held=gate(),started=gate();let hold=false;t.after(held.release);
 const f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(hold&&item.index===4){started.release();await held.promise;}}});
 await f.engine.warmupOnce();const previous=await f.engine.quote(input(hotPairs[0]));f.advance(3000);hold=true;
 const warm=f.engine.warmupOnce();await started.promise;f.engine.stopWarmup();assert.equal(await warm,false);
 const current=await f.engine.quote({...input(hotPairs[0]),amountIn:(S+1n).toString()});assert.equal(current.blockHash,previous.blockHash);
 held.release();await turn();const next=await f.engine.quote({...input(hotPairs[0]),amountIn:(S+2n).toString()});assert.equal(next.blockHash,previous.blockHash);
});

test('reorg detected after an earlier warm pair rejects the cycle and every sibling recovers from a new header',async t=>{
 let change=false;
 const f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(change&&item.index===1)f.reorg(item.block.number);}});
 change=true;assert.equal(await f.engine.warmupOnce(),false);f.clearReorgs();change=false;
 const first=await f.engine.quote(input(hotPairs[0])),sibling=await f.engine.quote(input(hotPairs[2]));
 assert.equal(first.blockNumber,'0x101');assert.equal(sibling.blockHash,first.blockHash);assert.equal(f.latest().length,2);
});

test('pair-specific discovery latency never renews the original shared snapshot quote deadline',async t=>{
 let f;f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async()=>f.advance(1000)});
 const capturedAt=f.now();assert.equal(await f.engine.warmupOnce(),true);
 for(const pair of hotPairs){const quote=await f.engine.quote(input(pair));assert.equal(quote.expiresAt,capturedAt+15000);assert.equal(quote.quote.poolCheckedAt,capturedAt);}
 assert.equal(f.latest().length,1);f.advance(17001);
 for(const item of f.policies)assert.throws(()=>item.policy.assertFresh(),{code:'POOL_LIQUIDITY',reason:'stale'});
});

test('a recent foreground context and cold sibling pairs build one new shared cycle without changing the original quote expiry',async t=>{
 const f=fixture(t),original=await f.engine.quote(input(hotPairs[0]));f.advance(1000);
 assert.equal(await f.engine.warmupOnce(),true);
 const cycle=f.policies.slice(1);assert.equal(cycle.length,3);
 assert.deepEqual([...new Set(cycle.map(item=>item.block.number))],['0x101']);
 for(const pair of hotPairs){const quote=await f.engine.quote({...input(pair),amountIn:(S+1n).toString()});assert.equal(quote.blockNumber,'0x101');assert.equal(quote.expiresAt,original.expiresAt+1000);}
 assert.equal(original.expiresAt,1800000015000,'a replacement context cannot mutate the original quote deadline');assert.equal(f.latest().length,2);
});

test('reaching the original shared deadline during later discovery declines the entire cycle',async t=>{
 let delay=true,f;f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(delay&&item.index===2)f.advance(15000);}});
 assert.equal(await f.engine.warmupOnce(),false);delay=false;
 const quote=await f.engine.quote(input(hotPairs[0]));assert.equal(quote.blockNumber,'0x101','expired cycle cannot retain its earlier pair or raw snapshot');
 assert.equal(quote.expiresAt,1800000030000);assert.equal(f.latest().length,2);
});

test('an unrelated foreground pair cancels shared warming and cannot inherit its header or canceled request',async t=>{
 const held=gate(),started=gate();t.after(held.release);
 const f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(item.index===0){started.release();await held.promise;}}});
 const warm=f.engine.warmupOnce();await started.promise;
 const quote=await f.engine.quote(input({tokenIn:ETH,tokenOut:U}));assert.equal(await warm,false);assert.equal(quote.blockNumber,'0x101');
 held.release();await turn();const sibling=await f.engine.quote({...input(hotPairs[2]),amountIn:(S+1n).toString()});assert.equal(sibling.blockHash,quote.blockHash);
 assert.equal(f.latest().length,2);assert.equal(f.runs[0].signal.aborted,true);
});

test('a same-pair foreground on a different node cancels the whole shared cycle and builds its own node-bound policy',async t=>{
 const held=gate(),started=gate();t.after(held.release);
 const f=fixture(t,{warmup:{pairs:hotPairs},policyHook:async item=>{if(item.index===0){started.release();await held.promise;}}});
 const warm=f.engine.warmupOnce();await started.promise;f.setNode('two');
 const quote=await f.engine.quote(input(hotPairs[0]));assert.equal(await warm,false);assert.equal(quote.blockNumber,'0x101');
 assert.equal(f.policies[1].nodeId,'two');assert.equal(f.runs[0].signal.aborted,true);held.release();await turn();
 const sibling=await f.engine.quote(input(hotPairs[2]));assert.equal(sibling.blockHash,quote.blockHash);assert.equal(f.policies.at(-1).nodeId,'two');
});
