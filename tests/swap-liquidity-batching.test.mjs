import test from'node:test';
import assert from'node:assert/strict';
import{execFileSync}from'node:child_process';
import{readFile}from'node:fs/promises';
import{ethers}from'ethers';
import{readPoolPolicy}from'../src/swap-liquidity.mjs';
import{createRawSnapshot,snapshotReader}from'../server/swap-snapshot-cache.mjs';
import{quoteFstRoutes,buildFstQuote,fstServiceQuote}from'../src/swap-fstswap.mjs?v=mainnet-20261113-47';
import{SWAP_ABI,SWAP_ADAPTERS,SWAP_TOKENS}from'../src/swap-aggregator.mjs?v=mainnet-20261113-47';
globalThis.ethers=ethers;
// Differential reference is the published production commit, never a second copy
// of the new ordering algorithm. Only import resolution changes for the test.
const original=execFileSync('git',['show','55171037d175247a2d3ce52f6982314b906be91d:src/swap-liquidity.mjs'],{encoding:'utf8'}).replace(/from '\.\/swap-aggregator\.mjs[^']*'/,`from '${new URL('../src/swap-aggregator.mjs?v=mainnet-20261113-47',import.meta.url).href}'`);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'));
const U=SWAP_TOKENS.usdt.address.toLowerCase(),F=SWAP_TOKENS.fist.address.toLowerCase(),C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',B='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',ETH='0x2170ed0880ac9a755fd29b2688956bd959f933f8',ALT='0x'+'33'.repeat(20),Z=ethers.ZeroAddress;
const W=SWAP_ADAPTERS.pancake.weth.toLowerCase(),base=new Set([U,C,...Object.values(SWAP_ADAPTERS).map(x=>x.weth.toLowerCase()),B,ETH]);
const E=new ethers.Interface([...SWAP_ABI,'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)','function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)','function token0() view returns(address)','function token1() view returns(address)','function balanceOf(address) view returns(uint256)','function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)','function quoteExactIn(bytes,uint256) returns(uint256)']);
const S=10n**18n;
function fixture({altPool=false,tieAltPools=false,coreDepthBoundary=false}={}){
 const now=1800000000000,block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:ethers.toQuantity(now/1000)},stateCalls=[],depthCalls=[],pools=new Map();
 const request=async p=>{
  if(p.method==='eth_getBlockByNumber')return block;
  const calls=E.decodeFunctionData('tryAggregate',p.params[0].data)[1],names=calls.map(c=>E.parseTransaction({data:c.callData}).name);
  if(names.includes('slot0'))stateCalls.push(p.params[0].data);
  return E.encodeFunctionResult('tryAggregate',[calls.map((c,n)=>{
   const parsed=E.parseTransaction({data:c.callData}),a=parsed.args;
   let value;
   if(parsed.name==='latestRoundData')value=[1n,100000000n,0n,BigInt(now/1000),1n];
   else if(parsed.name==='decimals')value=[8];
   else if(parsed.name==='factory')value=['0x'+'99'.repeat(20)];
   else if(parsed.name==='getPairInfo'){
    const tokens=[a[1].toLowerCase(),a[2].toLowerCase()].sort(),exists=tokens.includes(U)&&tokens.includes(F);
    value=[exists?'0x'+'77'.repeat(20):Z,...tokens,exists?1000000n*S:0n,exists?1000000n*S:0n,0,0];
   }else if(parsed.name==='getPool'){
    const tokens=[a[0].toLowerCase(),a[1].toLowerCase()].sort(),fee=Number(a[2]);
    // Real discovery topology observed at BSC 0x7ede9fa: 40 base pools,
    // 8 FIST pools. An optional alt pool tests insertion after that base.
    const exists=tokens.every(x=>[U,C,W,B,ETH].includes(x))||tokens.includes(F)&&(tokens.includes(U)||tokens.includes(W)&&fee!==100||tokens.includes(B)&&fee===10000)||altPool&&tokens.includes(ALT)&&tokens.includes(U)&&fee===500||tieAltPools&&tokens.includes(ALT)&&tokens.includes(C)&&fee===500;
    const address=exists?ethers.getAddress('0x'+ethers.keccak256(ethers.toUtf8Bytes(tokens.join(':')+':'+fee)).slice(-40)):Z;
    if(exists)pools.set(address.toLowerCase(),Object.assign(tokens,{fee}));value=[address];
   }else if(parsed.name==='slot0')value=[(2n**96n)*(coreDepthBoundary&&pools.get(c.target.toLowerCase()).fee===10000?2n:1n),0,0,0,0,0,true];
   else if(parsed.name==='liquidity'){
    const pool=pools.get(c.target.toLowerCase());
    value=[coreDepthBoundary&&pool.every(t=>base.has(t))&&pool.fee===100?50000n*S:1000000n*S];
   }
   else if(parsed.name==='balanceOf')value=[(c.target.toLowerCase()===U||tieAltPools&&c.target.toLowerCase()===C?400000n:700000n)*S];
   else if(parsed.name==='token0'||parsed.name==='token1')value=[pools.get(c.target.toLowerCase())[parsed.name==='token0'?0:1]];
   else if(parsed.name==='quoteExactInputSingle'){
    depthCalls.push([a[0][0].toLowerCase(),a[0][1].toLowerCase(),Number(a[0][3])]);
    value=[a[0][2]*BigInt(1000000-Number(a[0][3]))/1000000n,2n**96n,0,0];
   }
   else if(parsed.name==='getAmountsOutVia')value=[[a[1],a[1]*9975n/10000n]];
   else if(parsed.name==='quoteExactIn')value=[a[1]*(1000000n-BigInt('0x'+a[0].slice(42,48)))/1000000n];
   else throw Error(names[n]);
   return[true,E.encodeFunctionResult(parsed.name,value)];
  })]);
 };
 return{request,stateCalls,depthCalls,options:{clock:()=>now}};
}
test('mainstream depth probes omit only pools already rejected by the unchanged admission rules',async()=>{
 const before=fixture({coreDepthBoundary:true}),after=fixture({coreDepthBoundary:true});
 const input={tokenIn:Z,tokenOut:U};
 const old=await readPoolPolicy(before.request,{...input,...before.options});
 const current=await readPoolPolicy(after.request,{...input,...after.options,skipIneligibleDepth:true});
 assert.equal(before.depthCalls.length,80);
 assert.deepEqual(after.depthCalls,before.depthCalls.filter(([, ,fee])=>fee===500||fee===2500));
 assert.deepEqual(after.stateCalls,before.stateCalls);
 assert.deepEqual([...current.pools.keys()],[...old.pools.keys()]);
 for(const pool of old.pools.values()){
  const leg={kind:'v3',adapter:pool.adapter,path:pool.token0+pool.fee.toString(16).padStart(6,'0')+pool.token1.slice(2)};
  if(pool.fee===100)assert.equal(pool.usd,100000n*S,'exercise the exact minimum-liquidity boundary');
  assert.equal(current.allowsRoute([leg]),old.allowsRoute([leg]));
 }
 const alt=fixture({altPool:true,coreDepthBoundary:true});
 await readPoolPolicy(alt.request,{tokenIn:ALT,tokenOut:U,...alt.options,skipIneligibleDepth:true});
 assert.ok(alt.depthCalls.some(([a,b])=>a===ALT||b===ALT));
 assert.ok(alt.depthCalls.some(([, ,fee])=>fee===100),'mixed token graph keeps original depth trace');
});
test('default warm state batches are exactly reusable for a new mainstream pair and keep every base pool',async()=>{
 const warm=fixture();const initial=await readPoolPolicy(warm.request,{tokenIn:U,tokenOut:F,...warm.options});
 assert.equal(warm.stateCalls.length,4);assert.equal([...initial.pools.values()].filter(p=>p.kind==='v3').length,48);
 for(const[tokenIn,tokenOut]of[[Z,U],[ETH,C]]){
  const f=fixture(),policy=await readPoolPolicy(f.request,{tokenIn,tokenOut,...f.options});
  assert.equal(f.stateCalls.length,3);assert.equal(f.stateCalls.filter(x=>warm.stateCalls.includes(x)).length,3,'all 240 base state CALLs match completed default warm batches');
  assert.equal([...policy.pools.values()].filter(p=>p.kind==='v3').length,40);
 }
});
test('new alt-pool state CALLs follow the complete stable base without deleting any candidate',async()=>{
 const warm=fixture();await readPoolPolicy(warm.request,{tokenIn:U,tokenOut:F,...warm.options});
 const f=fixture({altPool:true}),policy=await readPoolPolicy(f.request,{tokenIn:F,tokenOut:ALT,...f.options});
 assert.equal(f.stateCalls.length,4);assert.ok(f.stateCalls.slice(0,3).every((data,n)=>data===warm.stateCalls[n]),'the full base calldata prefix remains identical');
 assert.equal([...policy.pools.values()].filter(p=>p.kind==='v3').length,49);
 const last=E.decodeFunctionData('tryAggregate',f.stateCalls[3])[1];assert.equal(last.length,54);assert.ok(last.some(c=>c.target.toLowerCase()===ALT));
});
test('equally deep alt pools retain the published first-main-pool choice despite state read sorting',async()=>{
 const before=fixture({altPool:true,tieAltPools:true}),after=fixture({altPool:true,tieAltPools:true}),options={tokenIn:ALT,tokenOut:C,...before.options};
 const previous=await baseline.readPoolPolicy(before.request,options),current=await readPoolPolicy(after.request,options);
 const candidate=(policy,anchor)=>[...policy.pools.values()].find(p=>p.kind==='v3'&&p.fee===500&&[p.token0,p.token1].includes(ALT)&&[p.token0,p.token1].includes(anchor));
 const oldU=candidate(previous,U),oldC=candidate(previous,C),newU=candidate(current,U),newC=candidate(current,C);
 assert.ok(oldU.usd>0n);assert.equal(oldU.usd,oldC.usd,'the independent USD liquidity must really tie');assert.equal(newU.usd,newC.usd);
 assert.equal(previous.main.get(ALT).id,oldC.id,'published endpoint order encounters the USDC pool first');
 const physicalCalls=after.stateCalls.flatMap(data=>Array.from(E.decodeFunctionData('tryAggregate',data)[1]));
 const physicalStateOrder=physicalCalls.filter(call=>E.parseTransaction({data:call.callData}).name==='slot0').map(call=>call.target.toLowerCase());
 assert.ok(physicalStateOrder.indexOf(newU.address)<physicalStateOrder.indexOf(newC.address),'core read sorting encounters USDT first, opposite to the policy insertion order');
 const physicalU=physicalCalls.findIndex(call=>call.target.toLowerCase()===newU.address&&E.parseTransaction({data:call.callData}).name==='slot0');
 assert.equal(newU.a,ALT);assert.equal(newU.b,U);assert.equal(physicalCalls[physicalU+4].target.toLowerCase(),U);assert.equal(physicalCalls[physicalU+5].target.toLowerCase(),ALT,'state reads reverse a/b, while restored policy retains the original direction');
 assert.equal(current.main.get(ALT).id,previous.main.get(ALT).id);
});
const comparable=policy=>({pools:[...policy.pools.values()].map(p=>({id:p.id,a:p.a,b:p.b,address:p.address,adapter:p.adapter,token0:p.token0,token1:p.token1,reserves:p.reserves,kind:p.kind,sqrt:p.sqrt,depthVerified:p.depthVerified,usd:p.usd,priceAligned:p.priceAligned})).sort((a,b)=>a.id.localeCompare(b.id)),prices:[...policy.prices].sort(),main:[...policy.main].map(([t,p])=>[t,p.id]).sort(),admission:[...policy.pools.values()].map(p=>[p.id,policy.allows(p.kind==='v3'?{adapter:p.adapter,kind:'v3',path:p.a+Number(p.fee).toString(16).padStart(6,'0')+p.b.slice(2)}:{adapter:p.adapter,path:[p.a,p.b]})]).sort()});
test('standard-view fixtures retain the published policy pools, main-pool decisions and route admission',async()=>{
 for(const[tokenIn,tokenOut]of[[U,F],[Z,U],[ETH,C],[F,ALT],[ALT,F]])for(const v3Mode of['all','legacy']){
  const before=fixture({altPool:true}),after=fixture({altPool:true}),options={tokenIn,tokenOut,v3Mode,...before.options};
  const previous=await baseline.readPoolPolicy(before.request,options),current=await readPoolPolicy(after.request,options);
  assert.deepEqual(comparable(current),comparable(previous),`${tokenIn}/${tokenOut}/${v3Mode}`);
  current.assertFresh();previous.assertFresh();
 }
});


test('repeat policy reads reuse only pure calldata while all response decoding and RPC reads remain fresh',async()=>{
 let constructs=0,encodes=0,decodes=0;
 class Counted extends ethers.Interface{
  constructor(abi){super(abi);constructs++;}
  encodeFunctionData(...args){encodes++;return super.encodeFunctionData(...args);}
  decodeFunctionResult(...args){decodes++;return super.decodeFunctionResult(...args);}
 }
 globalThis.ethers={...ethers,Interface:Counted};
 try{
  const first=fixture(),second=fixture(),beforeCalls=[],afterCalls=[];
  const record=(f,calls,changed=false)=>async p=>{calls.push(p);let raw=await f.request(p);if(changed&&p.method==='eth_call'){
   const batch=E.decodeFunctionData('tryAggregate',p.params[0].data)[1],rows=E.decodeFunctionResult('tryAggregate',raw)[0];
   raw=E.encodeFunctionResult('tryAggregate',[Array.from(rows,(row,n)=>E.parseTransaction({data:batch[n].callData}).name==='latestRoundData'?[true,E.encodeFunctionResult('latestRoundData',[1n,101000000n,0n,1800000000n,1n])]:row)]);
  }return raw;};
  const a=await readPoolPolicy(record(first,beforeCalls),{tokenIn:U,tokenOut:F,...first.options});
  const prior={constructs,encodes,decodes};assert.ok(prior.encodes>100,'fixture must exercise real bulk calldata encoding');
  const b=await readPoolPolicy(record(second,afterCalls),{tokenIn:U,tokenOut:F,...second.options});
  assert.deepEqual(afterCalls,beforeCalls,'all RPC methods, calldata bytes, order, block tags and canonical check remain identical');
  assert.equal(encodes-prior.encodes,0,'repeated pure encodings must hit without rerunning ethers encoder');
  assert.equal(constructs,2,'both fixed interfaces are reused only within the same constructor identity');
  assert.ok(decodes>prior.decodes,'fresh chain return data must still be decoded');
  assert.equal(b.prices.get(U),a.prices.get(U));
  const changed=fixture(),c=await readPoolPolicy(record(changed,[],true),{tokenIn:U,tokenOut:F,...changed.options});
  assert.equal(c.prices.get(U),a.prices.get(U)*101n/100n,'chain values are never encoded-cache entries');
  let alternateConstructs=0;
  class Alternate extends ethers.Interface{constructor(abi){super(abi);alternateConstructs++;}}
  globalThis.ethers={...ethers,Interface:Alternate};
  const other=fixture();await readPoolPolicy(other.request,{tokenIn:U,tokenOut:F,...other.options});
  assert.equal(alternateConstructs,2,'replacing the ethers implementation creates independent codecs');
 }finally{globalThis.ethers=ethers;}
});

// Immutable pre-normalization reference. The live production implementation is
// run through the real raw snapshot cache; only the network below it is faked.
const priorSource=execFileSync('git',['show','fa6c088297b62cfa289c108b110a07bcc969dbb1:src/swap-liquidity.mjs'],{encoding:'utf8'});
const resolveImports=source=>source.replace(/from ['"]\.\/([^'"]+)['"]/g,(_,path)=>`from '${new URL('../src/'+path,import.meta.url).href}'`);
const prior=await import('data:text/javascript;base64,'+Buffer.from(resolveImports(priorSource)).toString('base64'));
const children=p=>Array.from(E.decodeFunctionData('tryAggregate',p.params[0].data)[1]);
const methods=p=>children(p).map(c=>E.parseTransaction({data:c.callData}).name);
const wire=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):typeof v==='function'?undefined:v));
async function cachedPolicyFixture({mutate}={}){
 const f=fixture({altPool:true,tieAltPools:true}),block=await f.request({method:'eth_getBlockByNumber',params:['latest',false]}),calls=[];
 const snapshot=createRawSnapshot({nodeId:'one',block,capturedAt:f.options.clock()});
 const read=snapshotReader(snapshot,async p=>{calls.push(p);const raw=await f.request(p);return p.method==='eth_call'&&mutate?mutate(p,raw):raw;},{nodeId:'one'});
 return{...f,read,calls,block,snapshot};
}
async function quotePolicy(read,policy,tokenIn,tokenOut){
 const candidateSets=[];
 const config={version:'2.1.0',platformFeeBps:30,feeConfigVersion:5n,defaultFeeToken:U,adaptersOff:[]};
 const q=await buildFstQuote({tokenIn,tokenOut,amountIn:10n**18n,config,slippageBps:50,findRoute:async(from,to,amount,used,options)=>{
  const r=await quoteFstRoutes(read,{from,to,amount,used,policy,configVersion:config.version,...options});candidateSets.push(wire(r.candidates));return r;
 }});
 policy.assertValue(q.amountIn,q.minimum);policy.assertFresh();
 return{dto:fstServiceQuote(q,{slippageBps:50,poolCheckedAt:policy.checkedAt}),candidateSets};
}
test('default warm V2 metadata covers reverse and new mainstream pairs without another RPC or changed quote',async()=>{
 for(const[tokenIn,tokenOut]of[[F,U],[ETH,C]]){
  const before=await cachedPolicyFixture(),after=await cachedPolicyFixture(),warm={tokenIn:U,tokenOut:F};
  await prior.readPoolPolicy(before.read,{...warm,...before.options});await readPoolPolicy(after.read,{...warm,...after.options});
  before.calls.length=0;after.calls.length=0;
  const oldPolicy=await prior.readPoolPolicy(before.read,{tokenIn,tokenOut,...before.options}),policy=await readPoolPolicy(after.read,{tokenIn,tokenOut,...after.options});
  const oldMetadata=before.calls.filter(p=>p.method==='eth_call'&&methods(p).includes('getPairInfo'));
  const newMetadata=after.calls.filter(p=>p.method==='eth_call'&&methods(p).includes('getPairInfo'));
  assert.equal(oldMetadata.length,1,'the pre-change warm cache really misses one metadata RPC');
  assert.equal(newMetadata.length,0,'a new direction reuses the same completed metadata calldata');
  assert.equal(before.calls.length-after.calls.length,1,'exactly one metadata RPC is removed, not the canonical check');
  assert.deepEqual(comparable(policy),comparable(oldPolicy),'all pool records, prices, strongest-main decisions and admission remain identical');
  assert.equal(policy.checkedAt,oldPolicy.checkedAt);assert.equal(policy.blockNumber,oldPolicy.blockNumber);
  assert.deepEqual(after.calls.filter(p=>p.method==='eth_getBlockByNumber'),before.calls.filter(p=>p.method==='eth_getBlockByNumber'));
  assert.deepEqual(wire(await quotePolicy(after.read,policy,tokenIn,tokenOut)),wire(await quotePolicy(before.read,oldPolicy,tokenIn,tokenOut)),'full executable DTO and every candidate route retain their previous order and amounts');
 }
});
test('V2 query normalization retains original policy insertion and tied strongest-main-pool order',async()=>{
 const before=fixture({altPool:true,tieAltPools:true}),after=fixture({altPool:true,tieAltPools:true}),options={tokenIn:ALT,tokenOut:C};
 const a=await prior.readPoolPolicy(before.request,{...options,...before.options}),b=await readPoolPolicy(after.request,{...options,...after.options});
 assert.deepEqual(wire([...b.pools]),wire([...a.pools]));assert.deepEqual(comparable(b),comparable(a));
 assert.equal(b.main.get(ALT).id,a.main.get(ALT).id);assert.equal(b.main.get(ALT).b,C);
});
test('failed and malformed V2 metadata never satisfy a normalized reverse query from cache',async()=>{
 for(const bad of[[false,'0x'],[true,'0x1234']]){
  let poison=true;const f=await cachedPolicyFixture({mutate:(p,raw)=>{
   const calls=children(p),index=calls.findIndex(c=>E.parseTransaction({data:c.callData}).name==='getPairInfo');if(index<0||!poison)return raw;
   poison=false;const rows=Array.from(E.decodeFunctionResult('tryAggregate',raw)[0]);rows[index]=bad;return E.encodeFunctionResult('tryAggregate',[rows]);
  }});
  await assert.rejects(readPoolPolicy(f.read,{tokenIn:U,tokenOut:F,...f.options}),{code:'POOL_LIQUIDITY',reason:'data'});
  f.calls.length=0;const recovered=await readPoolPolicy(f.read,{tokenIn:F,tokenOut:U,...f.options});recovered.assertFresh();
  assert.equal(f.calls.filter(p=>p.method==='eth_call'&&methods(p).includes('getPairInfo')).length,1,'the rejected row is fetched again');
 }
});
test('unknown router or adapter does not acquire the trusted deployed V2 query-order assumption',async()=>{
 const {FSTSWAP_CONFIG}=await import('../src/fstswap-config.mjs?v=mainnet-20261113-47');
 const saved=globalThis.FST_V10_CONFIG;
 try{for(const[caseName,config]of[
  ['router',{...FSTSWAP_CONFIG,router:'0x'+'12'.repeat(20)}],
  ['adapter',{...FSTSWAP_CONFIG,adapters:{...FSTSWAP_CONFIG.adapters,fst:'0x'+'34'.repeat(20)}}],
 ]){
  globalThis.FST_V10_CONFIG=config;
  const aggURL=new URL('../src/swap-aggregator.mjs?pair-query-untrusted='+caseName,import.meta.url).href;
  await import(aggURL);
  const source=await readFile(new URL('../src/swap-liquidity.mjs',import.meta.url),'utf8');
  const load=async text=>import('data:text/javascript;base64,'+Buffer.from(resolveImports(text.replace(/from '\.\/swap-aggregator\.mjs[^']*'/,`from '${aggURL}'`))).toString('base64'));
  const oldModule=await load(priorSource),newModule=await load(source),before=fixture(),after=fixture(),oldCalls=[],newCalls=[];
  const collect=(f,calls)=>async p=>{if(p.method==='eth_call')for(const call of children(p)){const parsed=E.parseTransaction({data:call.callData});if(parsed.name==='getPairInfo'&&(caseName==='router'||parsed.args[0].toLowerCase()===config.adapters.fst.toLowerCase()))calls.push(wire([call.target,parsed.args]));}return f.request(p);};
  const options={tokenIn:F,tokenOut:U,v3Mode:'legacy'};
  await oldModule.readPoolPolicy(collect(before,oldCalls),{...options,...before.options});await newModule.readPoolPolicy(collect(after,newCalls),{...options,...after.options});
  assert.ok(oldCalls.length>0);assert.deepEqual(newCalls,oldCalls,'unknown contract gets the original exact token order');
 }}finally{if(saved===undefined)delete globalThis.FST_V10_CONFIG;else globalThis.FST_V10_CONFIG=saved;}
});
test('synthetic pinned-block responses replay to identical full policies after V2 wire normalization',async()=>{
 // The former optional 2026-11-12 live recording was never committed and is
 // unavailable. Record deterministic synthetic RPC responses instead of skipping
 // the replay or presenting invented data as a historical mainnet capture.
 const f=fixture(),records=[];
 const capture=async p=>{const result=await f.request(p);records.push({request:structuredClone(p),response:{result}});return result;};
 for(const[tokenIn,tokenOut]of[[U,F],[F,U]])await prior.readPoolPolicy(capture,{tokenIn,tokenOut,...f.options});
 const block=records.find(r=>r.request.method==='eth_getBlockByNumber').response.result,rows=new Map();
 const {swapActiveRouter}=await import('../src/swap-aggregator.mjs?v=mainnet-20261113-47');
 const rowKey=c=>{
  const parsed=E.parseTransaction({data:c.callData});
  if(c.target.toLowerCase()===swapActiveRouter().toLowerCase()&&parsed?.name==='getPairInfo')return wire([c.target.toLowerCase(),parsed.args[0].toLowerCase(),...parsed.args.slice(1,3).map(x=>x.toLowerCase()).sort(),parsed.args[3].toLowerCase()]).join(':');
  return[c.target,c.callData].join(':').toLowerCase();
 };
 let canonicalNonzero=0;
 for(const record of records.filter(r=>r.request.method==='eth_call')){
  const calls=children(record.request),values=E.decodeFunctionResult('tryAggregate',record.response.result)[0];assert.equal(calls.length,values.length);
  calls.forEach((c,n)=>{
   rows.set(rowKey(c),values[n]);const parsed=E.parseTransaction({data:c.callData});
   if(parsed?.name==='getPairInfo'&&values[n].success){const value=E.decodeFunctionResult('getPairInfo',values[n].returnData);if(value[0]!==Z){canonicalNonzero++;assert.ok(value[1].toLowerCase()<value[2].toLowerCase(),'recorded pair reports canonical token0/token1 regardless of query order');}}
  });
 }
 assert.ok(canonicalNonzero>0,'nonzero synthetic reserve responses, not only absent pairs, must be exercised');
 const source=async p=>{
  if(p.method==='eth_getBlockByNumber')return block;
  assert.equal(p.method,'eth_call');assert.equal(p.params[1],block.number,'every replayed pool/oracle/depth call uses the recorded same block');
  return E.encodeFunctionResult('tryAggregate',[children(p).map(c=>{const key=rowKey(c);assert.ok(rows.has(key),'replay must not invent a response missing from the pinned recording');return rows.get(key);})]);
 };
 for(const[tokenIn,tokenOut]of[[U,F],[F,U]]){
  const options={tokenIn,tokenOut,clock:()=>Number(BigInt(block.timestamp))*1000};
  const before=await prior.readPoolPolicy(source,options),after=await readPoolPolicy(source,options);
  assert.deepEqual(wire([...after.pools]),wire([...before.pools]));assert.deepEqual(comparable(after),comparable(before));before.assertFresh();after.assertFresh();
 }
});
