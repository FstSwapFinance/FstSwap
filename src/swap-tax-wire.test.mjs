import test from 'node:test';
import assert from 'node:assert/strict';
import {validateServiceQuote,createServiceClient} from './swap-service-client.mjs';
const zero='0x'+'00'.repeat(20),usd='0x55d398326f99059ff775485246999027b3197955',usdc='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',wbnb='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const alt='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e',pool='0x'+'11'.repeat(20),adapter='0x'+'22'.repeat(20),router='0x'+'33'.repeat(20),receiver='0x'+'44'.repeat(20);
const options={router,adapters:{pancake:{adapter,weth:wbnb}},clock:()=>10000};
const clone=x=>structuredClone(x);
function fixture({tokenIn=usd,tokenOut=usdc,amountIn=10000n,grossOut=20000n,netOut=grossOut,inputBps=0,outputBps=0,net=true,poolAddress=pool}={}){
 const input={chainId:56,tokenIn,tokenOut,amountIn:amountIn.toString(),slippageBps:50,singleHop:false};
 const mode=[usd,usdc,wbnb,zero].includes(tokenIn)?'input':'output',feeBase=mode==='input'?amountIn:netOut,fee=feeBase*30n/10000n;
 const source=mode==='input'?amountIn-fee:amountIn,final=netOut-(mode==='output'?fee:0n),min=v=>v*9950n/10000n;
 const leg={adapter,kind:'v2',path:[tokenIn===zero?wbnb:tokenIn,tokenOut===zero?wbnb:tokenOut],tokenIn,tokenOut,amountIn:source,out:netOut,weightBps:10000,poolIds:[poolAddress]};
 if(net)Object.assign(leg,{poolAmountIn:source-source*BigInt(inputBps)/10000n,grossOut,transferInBps:inputBps,transferOutBps:outputBps});
 const quote={kind:'fstswap',tokenIn,tokenOut,amountIn,out:final,minimum:min(final),lpFee:fee,feeToken:mode==='input'?tokenIn:tokenOut,feeMode:mode,configVersion:5n,impact:0.01,poolCheckedAt:5000,
  stages:[{tokenIn,tokenOut,minOut:min(netOut)||1n,branches:[{adapter,kind:0,weightBps:10000,path:leg.path,v3Path:'0x'}]}],
  segments:[{from:tokenIn,to:tokenOut,amountIn:source,out:netOut,minimum:min(netOut),impact:0.01,legs:[clone(leg)],routeStages:[{tokenIn,tokenOut,out:netOut,legs:[clone(leg)]}]}]};
 if(net)Object.assign(quote,{quoteModel:'net-transfer-v1',taxProfiles:[]});
 return{schema:1,chainId:56,router,blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),quotedAt:9500,expiresAt:20000,input,config:{version:'2.1.0',platformFeeBps:30,feeReceiver:receiver,wbnb,defaultFeeToken:usd,feeConfigVersion:5n,adaptersOff:[]},quote};
}
const validate=data=>validateServiceQuote(data,data.input,options);
const encode=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?{$bigint:v.toString()}:v);

test('new net quote accepts explicit zero-tax accounting without changing fee or minOut',()=>{
 const data=fixture();assert.equal(validate(data),data);
 assert.equal(data.quote.segments[0].legs[0].poolAmountIn,9970n);assert.equal(data.quote.out,20000n);assert.equal(data.quote.minimum,19900n);
});
test('legacy unknown-token gross quotes are rejected rather than trusted as net output',()=>{
 const data=fixture({tokenOut:alt,net:false});assert.throws(()=>validate(data));
});
test('legacy known settlement-only quotes remain accepted for a rolling release',()=>{
 const data=fixture({net:false});assert.equal(validate(data),data);
});

test('new net quotes require exact accounting fields in both stage and segment copies',()=>{
 for(const mutate of[
  q=>q.segments[0].legs[0].poolAmountIn++,
  q=>q.segments[0].legs[0].grossOut++,
  q=>q.segments[0].legs[0].transferInBps=1,
  q=>q.segments[0].routeStages[0].legs[0].grossOut++,
  q=>delete q.segments[0].routeStages[0].legs[0].poolAmountIn,
  q=>q.segments[0].routeStages[0].legs[0].transferOutBps='0',
  q=>q.quoteModel='future-unverified-model',
 ]){const data=fixture();mutate(data.quote);assert.throws(()=>validate(data));}
});

test('unknown-token responses without reliable profiles never enter the completed quote cache',async()=>{
 let calls=0;const data=fixture({tokenOut:alt,net:false});
 const client=createServiceClient({base:'https://quote.invalid',clock:options.clock,fetchImpl:async()=>{calls++;return new Response(encode(data));}});
 await assert.rejects(client.quote({...data.input,amountIn:BigInt(data.input.amountIn)},options),{code:'TAX_UNVERIFIED'});
 assert.equal(client.available(),true,'an unknown token does not disable other quotes');
 await assert.rejects(client.quote({...data.input,amountIn:BigInt(data.input.amountIn)},options),{code:'TAX_UNVERIFIED'});
 assert.equal(calls,2,'no unsafe completed result is reused');
});

const canonical='0xec6abc1cbaef40878069245c2568401e56c949f1';
const profile=(buyBps=300n,sellBps=300n)=>({token:alt,kind:'pair',pair:canonical,buyBps,sellBps,codeHash:'7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed',blockNumber:'0x1'});
const withProfile=(data,buy=300n,sell=300n)=>{data.quote.taxProfiles=[profile(buy,sell)];return data;};

test('pair-specific buy and sell taxation validates net user output and output-fee timing',()=>{
 const buy=withProfile(fixture({tokenOut:alt,poolAddress:canonical,outputBps:300,netOut:19400n}));
 assert.equal(validate(buy),buy);assert.equal(buy.quote.out,19400n);assert.equal(buy.quote.minimum,19303n);assert.equal(buy.quote.lpFee,30n);
 const sell=withProfile(fixture({tokenIn:alt,poolAddress:canonical,inputBps:300}));
 assert.equal(validate(sell),sell);assert.equal(sell.quote.segments[0].legs[0].poolAmountIn,9700n);assert.equal(sell.quote.lpFee,60n);assert.equal(sell.quote.out,19940n);assert.equal(sell.quote.minimum,19840n);
});

test('a route through a different pair is not globally multiplied by the tax rate',()=>{
 const data=withProfile(fixture({tokenOut:alt}));assert.equal(validate(data),data);
 for(const list of[data.quote.segments[0].legs,data.quote.segments[0].routeStages[0].legs]){list[0].transferOutBps=300;list[0].out=19400n;}
 data.quote.segments[0].out=19400n;data.quote.segments[0].routeStages[0].out=19400n;data.quote.segments[0].minimum=19303n;data.quote.stages[0].minOut=19303n;data.quote.out=19400n;data.quote.minimum=19303n;
 assert.throws(()=>validate(data),'arithmetic alone cannot justify taxing a noncanonical pool');
});

test('malformed, stale, wrong-pair or wrong-code tax proofs fail closed',()=>{
 for(const mutate of[
  p=>p.pair=pool,p=>p.codeHash='a'.repeat(64),p=>p.blockNumber='0x2',p=>p.buyBps=10001n,p=>p.sellBps=-1n,p=>p.buyBps=300,p=>p.kind='none',p=>p.exempt=true,
 ]){const data=withProfile(fixture({tokenOut:alt,poolAddress:canonical,outputBps:300,netOut:19400n}));mutate(data.quote.taxProfiles[0]);assert.throws(()=>validate(data),{code:'TAX_UNVERIFIED'});}
});

test('changed on-chain rates must match the exact DTO net math and cannot be treated as fixed three percent',()=>{
 const data=withProfile(fixture({tokenOut:alt,poolAddress:canonical,outputBps:700,netOut:18600n}),700n,500n);assert.equal(validate(data),data);
 data.quote.taxProfiles[0].buyBps=300n;assert.throws(()=>validate(data));
});

test('a prefunded second V2 pool receives the prior net output once without a second input tax',()=>{
 const data=withProfile(fixture({tokenIn:wbnb,tokenOut:usd}));
 const first={adapter,kind:'v2',path:[wbnb,alt],tokenIn:wbnb,tokenOut:alt,amountIn:9970n,poolAmountIn:9970n,grossOut:20000n,out:19400n,transferInBps:0,transferOutBps:300,weightBps:10000,poolIds:[canonical]};
 const second={adapter,kind:'v2',path:[alt,usd],tokenIn:alt,tokenOut:usd,amountIn:19400n,poolAmountIn:19400n,grossOut:39000n,out:39000n,transferInBps:0,transferOutBps:0,weightBps:10000,poolIds:[pool]};
 data.quote.out=39000n;data.quote.minimum=38805n;
 data.quote.segments[0]={from:wbnb,to:usd,amountIn:9970n,out:39000n,minimum:38805n,impact:0.01,legs:[clone(first),clone(second)],routeStages:[{tokenIn:wbnb,tokenOut:alt,out:19400n,legs:[clone(first)]},{tokenIn:alt,tokenOut:usd,out:39000n,legs:[clone(second)]}]};
 data.quote.stages=data.quote.segments[0].routeStages.map(s=>({tokenIn:s.tokenIn,tokenOut:s.tokenOut,minOut:s.out*9950n/10000n,branches:s.legs.map(l=>({adapter:l.adapter,kind:0,weightBps:10000,path:l.path,v3Path:'0x'}))}));
 assert.equal(validate(data),data);
 for(const l of[data.quote.segments[0].legs[1],data.quote.segments[0].routeStages[1].legs[0]]){l.transferInBps=300;l.poolAmountIn=18818n;}
 assert.throws(()=>validate(data),'a valid-looking second tax subtraction must still be rejected');
});

test('tax-unverified API failures are business failures without whole-service cooldown',async()=>{
 let calls=0;const client=createServiceClient({base:'https://quote.invalid',clock:options.clock,fetchImpl:async()=>{calls++;return new Response(encode({error:'TAX_UNVERIFIED'}),{status:422});}});
 const request={tokenIn:usd,tokenOut:alt,amountIn:10000n,slippageBps:50,singleHop:false};
 await assert.rejects(client.quote(request,options),{code:'TAX_UNVERIFIED'});assert.equal(client.available(),true);
 await assert.rejects(client.quote(request,options),{code:'TAX_UNVERIFIED'});assert.equal(calls,2);
});

test('an HTTP tax rejection never enters local fallback and the next ordinary quote still works',async()=>{
 const ordinary=fixture();let calls=0,fallbacks=0;
 const client=createServiceClient({base:'https://quote.invalid',clock:options.clock,fetchImpl:async()=>{
  calls++;return calls===1?new Response(encode({error:'TAX_UNVERIFIED'}),{status:422}):new Response(encode(ordinary));
 }});
 const quoteWithFallback=async request=>{
  const result=await client.quote(request,options);
  if(result===null){fallbacks++;return{unsafeFallback:true};}
  return result;
 };
 await assert.rejects(quoteWithFallback({tokenIn:usd,tokenOut:alt,amountIn:10000n,slippageBps:50,singleHop:false}),{code:'TAX_UNVERIFIED'});
 assert.equal(fallbacks,0,'a business rejection must propagate instead of becoming a nullable transport failure');
 assert.equal(client.available(),true);
 const result=await quoteWithFallback({...ordinary.input,amountIn:BigInt(ordinary.input.amountIn)});
 assert.equal(result.quote.out,ordinary.quote.out);assert.equal(result.quote.quoteModel,'net-transfer-v1');
 assert.equal(calls,2);assert.equal(fallbacks,0,'the same client remains usable for ordinary assets');
});


test('a transfer-tax proof cannot authorize the older custody-based 2.0 execution graph',()=>{
 const data=withProfile(fixture({tokenOut:alt,poolAddress:canonical,outputBps:300,netOut:19400n}));
 data.config.version='2.0.0';assert.throws(()=>validate(data),{code:'TAX_UNVERIFIED'});
});

test('intermediate platform fees are charged after the first net segment before the next budget',()=>{
 const btcb='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c';
 const data=withProfile(fixture({tokenIn:alt,tokenOut:usd,poolAddress:canonical,inputBps:300}));
 const first=data.quote.segments[0],secondLeg={adapter,kind:'v2',path:[usd,btcb],tokenIn:usd,tokenOut:btcb,amountIn:19940n,poolAmountIn:19940n,grossOut:30000n,out:30000n,transferInBps:0,transferOutBps:0,weightBps:10000,poolIds:[pool]};
 data.input.tokenOut=btcb;data.quote.tokenOut=btcb;data.quote.feeMode='intermediate';data.quote.feeToken=usd;
 data.quote.out=30000n;data.quote.minimum=29850n;data.quote.impact=1-(1-first.impact)*(1-0.01);
 data.quote.segments.push({from:usd,to:btcb,amountIn:19940n,out:30000n,minimum:29850n,impact:0.01,legs:[clone(secondLeg)],routeStages:[{tokenIn:usd,tokenOut:btcb,out:30000n,legs:[clone(secondLeg)]}]});
 data.quote.stages.push({tokenIn:usd,tokenOut:btcb,minOut:29850n,branches:[{adapter,kind:0,weightBps:10000,path:[usd,btcb],v3Path:'0x'}]});
 assert.equal(validate(data),data);assert.equal(data.quote.lpFee,60n);
 for(const patch of[
  q=>q.lpFee=58n,
  q=>q.segments[1].amountIn=20000n,
  q=>q.minimum=30000n,
  q=>q.stages[0].minOut=19840n,
 ]){const bad=clone(data);patch(bad.quote);assert.throws(()=>validate(bad));}
});

test('prefunded transfer into the canonical pair applies its sell tax on the preceding output only',()=>{
 const data=withProfile(fixture({tokenIn:wbnb,tokenOut:usd}));
 const first={adapter,kind:'v2',path:[wbnb,alt],tokenIn:wbnb,tokenOut:alt,amountIn:9970n,poolAmountIn:9970n,grossOut:20000n,out:19400n,transferInBps:0,transferOutBps:300,weightBps:10000,poolIds:[pool]};
 const second={adapter,kind:'v2',path:[alt,usd],tokenIn:alt,tokenOut:usd,amountIn:19400n,poolAmountIn:19400n,grossOut:39000n,out:39000n,transferInBps:0,transferOutBps:0,weightBps:10000,poolIds:[canonical]};
 data.quote.out=39000n;data.quote.minimum=38805n;
 data.quote.segments[0]={from:wbnb,to:usd,amountIn:9970n,out:39000n,minimum:38805n,impact:0.01,legs:[clone(first),clone(second)],routeStages:[{tokenIn:wbnb,tokenOut:alt,out:19400n,legs:[clone(first)]},{tokenIn:alt,tokenOut:usd,out:39000n,legs:[clone(second)]}]};
 data.quote.stages=data.quote.segments[0].routeStages.map(s=>({tokenIn:s.tokenIn,tokenOut:s.tokenOut,minOut:s.out*9950n/10000n,branches:s.legs.map(l=>({adapter:l.adapter,kind:0,weightBps:10000,path:l.path,v3Path:'0x'}))}));
 assert.equal(validate(data),data);
 data.quote.taxProfiles[0].sellBps=500n;assert.throws(()=>validate(data));
});

test('integer tax rounds exactly like the token and explicit zero slippage stays zero',()=>{
 const data=withProfile(fixture({tokenOut:alt,poolAddress:canonical,outputBps:300,grossOut:33n,netOut:33n}));
 data.input.slippageBps=0;data.quote.minimum=33n;data.quote.stages[0].minOut=33n;data.quote.segments[0].minimum=33n;
 assert.equal(validate(data),data,'floor(33*300/10000) is zero tax, not one wei');
 for(const l of[data.quote.segments[0].legs[0],data.quote.segments[0].routeStages[0].legs[0]])l.out=32n;
 data.quote.segments[0].routeStages[0].out=32n;data.quote.segments[0].out=32n;data.quote.segments[0].minimum=32n;data.quote.stages[0].minOut=32n;data.quote.out=32n;data.quote.minimum=32n;
 assert.throws(()=>validate(data),'rounding net down is not the token tax implementation');
});
