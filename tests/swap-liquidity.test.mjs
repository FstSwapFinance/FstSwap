import test from'node:test';import assert from'node:assert/strict';import{ethers}from'ethers';globalThis.ethers=ethers;
const{createPoolPolicy,poolLiquidityUsd}=await import('../src/swap-liquidity.mjs');
const{SWAP_ADAPTERS,SWAP_TOKENS}=await import('../src/swap-aggregator.mjs');
const usd=SWAP_TOKENS.usdt.address.toLowerCase(),usdc='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',alt=SWAP_TOKENS.fist.address.toLowerCase(),scale=10n**18n;
const prices=new Map([[usd,scale],[usdc,scale]]),adapter=SWAP_ADAPTERS.fst.adapter;
const key=(a,b)=>[adapter.toLowerCase(),...[a,b].sort(),'v2'].join(':');
const pool=(a,b,value)=>({id:key(a,b),address:'pool-'+value,token0:a,token1:b,reserves:[BigInt(value)*scale/2n,BigInt(value)*scale/2n]});
const leg=(a,b)=>({adapter,path:[a,b]});
test('mainstream pools must be strictly above $100k on both sides',()=>{
 for(const value of[0,99999,100000,100001]){
  const p=pool(usd,usdc,value),policy=createPoolPolicy(new Map([[p.id,p]]),prices,usd,usdc);
  assert.equal(policy.allows(leg(usd,usdc)),value>100000);
 }
 const p=pool(usd,usdc,1000000);p.reserves[1]=10n*scale;assert.equal(poolLiquidityUsd(p,prices),20n*scale);
});
test('altcoins use the strongest independently valued main pool, not the route with a fake better quote',()=>{
 const deep=pool(alt,usd,500000),thin=pool(alt,usdc,1000),bridge=pool(usd,usdc,1000000);
 const policy=createPoolPolicy(new Map([deep,thin,bridge].map(p=>[p.id,p])),prices,alt,usdc);
 assert.equal(policy.allows(leg(alt,usdc)),false);assert.equal(policy.allows({adapter,path:[alt,usd,usdc]}),true);
 assert.equal(policy.main.get(alt).id,deep.id);
});
test('every mainstream intermediate pool must meet the threshold',()=>{
 const deep=pool(alt,usd,500000),thinBridge=pool(usd,usdc,1000);
 const policy=createPoolPolicy(new Map([deep,thinBridge].map(p=>[p.id,p])),prices,alt,usdc);
 assert.equal(policy.allows({adapter,path:[alt,usd,usdc]}),false);
});
test('unknown pool prices and missing pool records fail closed',()=>{
 const p=pool(alt,'0x'+'11'.repeat(20),100000000);assert.equal(poolLiquidityUsd(p,prices),0n);
 assert.equal(createPoolPolicy(new Map(),prices,usd,usdc).allows(leg(usd,usdc)),false);
});
test('independent oracle valuation rejects manipulated mainstream execution prices',()=>{
 const policy=createPoolPolicy(new Map(),prices,usd,usdc);
 assert.doesNotThrow(()=>policy.assertValue(1000n,990n));
 assert.throws(()=>policy.assertValue(1000n,979n),{code:'POOL_LIQUIDITY',reason:'price',retryable:false});
});
test('a manipulated mainstream bridge cannot hide inside an altcoin route',()=>{
 const main=pool(alt,usdc,500000),bridge=pool(usd,usdc,500000);bridge.reserves[1]*=3n;
 const policy=createPoolPolicy(new Map([main,bridge].map(p=>[p.id,p])),prices,usd,alt);
 assert.equal(policy.allows({adapter,path:[usd,usdc,alt]}),false);
});
test('a mainstream pool cannot use a one-sided oracle valuation',()=>{
 const p=pool(usd,usdc,1000000);assert.equal(poolLiquidityUsd(p,new Map([[usd,scale]])),0n);
 assert.equal(createPoolPolicy(new Map([[p.id,p]]),new Map([[usd,scale]]),usd,usdc).allows(leg(usd,usdc)),false);
});

const{readPoolPolicy}=await import('../src/swap-liquidity.mjs');
const abi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)',
 'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)','function liquidity() view returns(uint128)',
 'function token0() view returns(address)','function token1() view returns(address)','function balanceOf(address) view returns(uint256)',
 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
const routerAbi=new ethers.Interface((await import('../src/swap-aggregator.mjs')).SWAP_ABI);
function rpcFixture({stale=false,missingPool=false,missingDiscovery=false,reorg=false,slow=false,deepV3=false,fistAltV3=false}={}){
 const cmsn='0x'+'33'.repeat(20),v3Tokens=fistAltV3?[alt,cmsn]:[usd,alt];
 const time=1800000000000,block={number:'0x100',timestamp:ethers.toQuantity(time/1000),hash:'0x'+'01'.repeat(32)};let reads=0,clock=time;const discovered=new Set(),v3Pairs=[],headers=[];
 const read=async p=>{
  if(p.method==='eth_getBlockByNumber'){headers.push(p.params[0]);if(p.params[0]!=='latest'){if(slow)clock+=21000;return{...block,hash:reorg?'0x'+'02'.repeat(32):block.hash};}return block;}
  assert.equal(p.params[1],block.number);reads++;
  const calls=abi.decodeFunctionData('tryAggregate',p.params[0].data)[1];
  return abi.encodeFunctionResult('tryAggregate',[calls.map(c=>{
   let parsed,codec;try{parsed=abi.parseTransaction({data:c.callData});codec=abi;}catch{}
   if(!parsed){parsed=routerAbi.parseTransaction({data:c.callData});codec=routerAbi;}
   if(parsed.name==='getPairInfo')parsed.args.slice(1,3).forEach(t=>discovered.add(t.toLowerCase()));
   if((deepV3||fistAltV3)&&parsed.name==='getPairInfo'&&[...parsed.args.slice(1,3)].map(t=>t.toLowerCase()).sort().join() === [usd,alt].sort().join())return[true,codec.encodeFunctionResult(parsed.name,['0x'+'77'.repeat(20),...parsed.args.slice(1,3),100000n*scale,100000n*scale,1n,0n])];
   if(parsed.name==='getPairInfo')return missingPool?[false,'0x']:[true,codec.encodeFunctionResult(parsed.name,['0x'+'00'.repeat(20),...parsed.args.slice(1,3),0n,0n,0n,0n])];
   if(parsed.name==='latestRoundData')return[true,codec.encodeFunctionResult(parsed.name,[1n,100000000n,0n,BigInt(time/1000-(stale?10000:0)),1n])];
   if(parsed.name==='decimals')return[true,codec.encodeFunctionResult(parsed.name,[8])];
   if(parsed.name==='factory')return[true,codec.encodeFunctionResult(parsed.name,['0x'+'99'.repeat(20)])];
   if(parsed.name==='getPool'){v3Pairs.push(parsed.args.slice(0,2).map(t=>t.toLowerCase()));if((deepV3||fistAltV3)&&parsed.args[2]===500n&&v3Pairs.at(-1).slice().sort().join()===v3Tokens.slice().sort().join())return[true,codec.encodeFunctionResult(parsed.name,['0x'+'88'.repeat(20)])];return missingDiscovery?[false,'0x']:[true,codec.encodeFunctionResult(parsed.name,['0x'+'00'.repeat(20)])];}
   if(parsed.name==='slot0')return[true,codec.encodeFunctionResult(parsed.name,[2n**96n,0,0,0,0,0,true])];
   if(['liquidity','balanceOf'].includes(parsed.name))return[true,codec.encodeFunctionResult(parsed.name,[1000000n*scale])];
   if(['token0','token1'].includes(parsed.name))return[true,codec.encodeFunctionResult(parsed.name,[parsed.name==='token0'?v3Tokens[0]:v3Tokens[1]])];
   if(parsed.name==='quoteExactInputSingle')return[true,codec.encodeFunctionResult(parsed.name,[parsed.args[0][2]*999500n/1000000n,2n**96n,0,0])];
   throw Error(parsed.name);
  })]);
 };return{read,discovered,v3Pairs,headers,clock:()=>clock,advance:()=>clock+=21000};
}
test('only an explicit engine defer option leaves canonical validation to the final engine check',async()=>{
 const normal=rpcFixture();await readPoolPolicy(normal.read,{tokenIn:usd,tokenOut:usdc,v3Mode:'legacy',clock:normal.clock});
 assert.deepEqual(normal.headers,['latest','0x100']);
 const deferred=rpcFixture();const policy=await readPoolPolicy(deferred.read,{tokenIn:usd,tokenOut:usdc,v3Mode:'legacy',clock:deferred.clock,deferCanonical:true});
 assert.deepEqual(deferred.headers,['latest']);policy.assertFresh();deferred.advance();assert.throws(()=>policy.assertFresh(),{code:'POOL_LIQUIDITY'});
});
test('pool snapshot rejects stale oracle, incomplete discovery, reorg and slow reads',async()=>{
 for(const option of['stale','missingPool','missingDiscovery','reorg','slow']){
  const f=rpcFixture({[option]:true});await assert.rejects(readPoolPolicy(f.read,{tokenIn:usd,tokenOut:usdc,clock:f.clock}),{code:'POOL_LIQUIDITY',reason:option==='stale'?'oracle':option.startsWith('missing')?'data':'stale',retryable:true},option);
 }
});
test('pool snapshot expires again immediately before the wallet request',async()=>{
 const f=rpcFixture();const policy=await readPoolPolicy(f.read,{tokenIn:usd,tokenOut:usdc,clock:f.clock});
 policy.assertFresh();f.advance();assert.throws(()=>policy.assertFresh(),{code:'POOL_LIQUIDITY'});
});
import{sendWalletOnce}from'../src/swap-send.mjs';
test('fresh liquidity callback permits the real send controller and expired liquidity prevents it',async()=>{
 for(const expired of[false,true]){
  const f=rpcFixture(),policy=await readPoolPolicy(f.read,{tokenIn:usd,tokenOut:usdc,clock:f.clock});if(expired)f.advance();
  const account='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32),block={number:'0x100',hash:'0x'+'44'.repeat(32)};
  const map=new Map(),storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  let sends=0;const provider={request:async({method})=>{
   if(method==='eth_chainId')return'0x38';if(method==='eth_accounts')return[account];if(method==='eth_getCode')return'0x1234';if(method==='eth_getBlockByNumber')return block;if(method==='eth_getTransactionCount')return'0x1';
   if(method==='eth_sendTransaction'){sends++;return hash;}throw Error(method);
  }};
  const send=()=>sendWalletOnce({provider,read:async()=>block,transaction:{from:account,to:target,value:'0x0',data:'0x1234'},storage,locks:{request:(_,o,fn)=>fn({})},beforeSubmit:()=>policy.assertFresh()});
  if(expired){await assert.rejects(send(),{code:'POOL_LIQUIDITY'});assert.equal(sends,0);}else{assert.equal((await send()).hash,hash);assert.equal(sends,1);}
 }
});

test('configured intermediate FIST is discovered even when neither endpoint is FIST',async()=>{
 const f=rpcFixture();await readPoolPolicy(f.read,{tokenIn:usd,tokenOut:usdc,extraTokens:[alt],clock:f.clock});assert.equal(f.discovered.has(alt),true);
});

test('legacy quote scans all altcoin V3 main-pool competitors without scanning unused anchor V3 routes',async()=>{
 const f=rpcFixture();await readPoolPolicy(f.read,{tokenIn:usd,tokenOut:alt,v3Mode:'legacy',clock:f.clock});
 assert.ok(f.v3Pairs.length>0);assert.ok(f.v3Pairs.every(pair=>pair.includes(alt)));
 assert.ok(f.v3Pairs.some(pair=>pair.includes(usdc)));
 const stable=rpcFixture();await readPoolPolicy(stable.read,{tokenIn:usd,tokenOut:usdc,v3Mode:'legacy',clock:stable.clock});assert.equal(stable.v3Pairs.length,0);
 const full=rpcFixture();await readPoolPolicy(full.read,{tokenIn:usd,tokenOut:usdc,clock:full.clock});assert.ok(full.v3Pairs.length>0);
});

test('legacy quote still rejects a V2 alt pool when a deeper executable V3 main pool exists',async()=>{
 for(const v3Mode of['legacy','all']){
  const f=rpcFixture({deepV3:true});const p=await readPoolPolicy(f.read,{tokenIn:usd,tokenOut:alt,v3Mode,clock:f.clock});
  assert.equal(p.main.get(alt).kind,'v3');assert.equal(p.main.get(alt).depthVerified,true);
  assert.equal(p.allows(leg(usd,alt)),false);
  assert.equal(p.allows({kind:'v3',adapter:SWAP_ADAPTERS.v3.adapter,path:usd+'0001f4'+alt.slice(2)}),true);
 }
});

test('FIST-quoted alt main pool uses a separate deep FIST/USDT reference, never itself',()=>{
 const cmsn='0x'+'33'.repeat(20),reference=pool(alt,usd,7000000),direct=pool(alt,cmsn,1500000),small=pool(usd,cmsn,40000);
 const pools=new Map([reference,direct,small].map(p=>[p.id,p]));
 const policy=createPoolPolicy(pools,prices,alt,cmsn);
 assert.equal(policy.main.get(cmsn).id,direct.id);assert.equal(policy.allows(leg(alt,cmsn)),true);
 assert.equal(policy.allows(leg(usd,cmsn)),false);
 assert.equal(createPoolPolicy(pools,prices,usd,cmsn).allows({adapter,path:[usd,alt,cmsn]}),true);
 assert.equal(prices.has(alt),false); // The caller's independent oracle map is untouched.
 for(const depth of[0,99999,100000]){
  const shallow=pool(alt,usd,depth),blocked=createPoolPolicy(new Map([shallow,direct].map(p=>[p.id,p])),prices,alt,cmsn);
  assert.equal(blocked.allows(leg(alt,cmsn)),false);
 }
 const noReference=createPoolPolicy(new Map([[direct.id,direct]]),prices,alt,cmsn);assert.equal(noReference.allows(leg(alt,cmsn)),false);
 const other='0x'+'44'.repeat(20),unknown=pool(other,cmsn,9000000);
 assert.equal(createPoolPolicy(new Map([reference,unknown].map(p=>[p.id,p])),prices,other,cmsn).allows(leg(other,cmsn)),false);
});

test('FIST-alt V3 depth probes use the external reference before ranking the main pool',async()=>{
 const cmsn='0x'+'33'.repeat(20),f=rpcFixture({fistAltV3:true});
 const policy=await readPoolPolicy(f.read,{tokenIn:alt,tokenOut:cmsn,clock:f.clock});
 assert.equal(policy.main.get(cmsn).kind,'v3');assert.equal(policy.main.get(cmsn).depthVerified,true);
 assert.equal(policy.allows({kind:'v3',adapter:SWAP_ADAPTERS.v3.adapter,path:alt+'0001f4'+cmsn.slice(2)}),true);
});
