import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceClient,validateServiceQuote} from '../src/swap-service-client.mjs';
const Z='0x'+'00'.repeat(20),U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',W='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const E='0x2170ed0880ac9a755fd29b2688956bd959f933f8',C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
// BTCB and the FstSwap wrapped BNB are known non-tax, non-fee assets in
// this topology fixture; arbitrary ALT addresses require verified tax models.
const A='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',B='0x0efb5fd2402a0967b92551d6af54de148504a115',R='0x'+'11'.repeat(20),P='0x'+'22'.repeat(20),V='0x'+'33'.repeat(20),P1='0x'+'44'.repeat(20),P2='0x'+'55'.repeat(20),P3='0x'+'66'.repeat(20);
const fees=new Set([Z,U,F,W,E,C]),clock=()=>10000,options={router:R,adapters:{pancake:{adapter:P,weth:W},v3:{adapter:V,weth:W}},clock};
const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$bigint:x.toString()}:x);
const copy=v=>structuredClone(v),min=v=>v*9950n/10000n;
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
function leg(from,to,amount,out,{v3=false,weight=10000,pool=P1,wrap=false}={}){
 return{adapter:wrap?Z:v3?V:P,kind:wrap?'wrap':v3?'v3':'v2',path:wrap?[]:v3?from+'0001f4'+to.slice(2):[same(from,Z)?W:from,same(to,Z)?W:to],tokenIn:from,tokenOut:to,amountIn:amount,out,weightBps:weight,poolIds:wrap?[]:[pool]};
}
function segment(from,to,amount,out,{stages,impact=.01,wrap=false}={}){
 const routeStages=stages||[{tokenIn:from,tokenOut:to,out,legs:[leg(from,to,amount,out,{wrap})]}];
 return{from,to,amountIn:amount,out,minimum:wrap?out:min(out),impact:wrap?0:impact,legs:routeStages.flatMap(s=>s.legs),routeStages};
}
function fixture({from=U,to=F,amount=10000n,segments,defaultFee=U}={}){
 const mode=fees.has(from)?'input':fees.has(to)?'output':'intermediate',feeToken=mode==='input'?from:mode==='output'?to:defaultFee;
 const charged=mode==='input'?amount*30n/10000n:mode==='output'?20000n*30n/10000n:20000n*30n/10000n;
 segments ||= mode==='intermediate'?[segment(from,feeToken,amount,20000n),segment(feeToken,to,20000n-charged,39880n)]:[segment(from,to,mode==='input'?amount-charged:amount,20000n)];
 const fee=mode==='input'?amount*30n/10000n:mode==='output'?segments[0].out*30n/10000n:segments[0].out*30n/10000n;
 const out=mode==='output'?segments[0].out-fee:segments.at(-1).out;
 const stages=segments.flatMap(s=>s.routeStages.map(stage=>({tokenIn:stage.tokenIn,tokenOut:stage.tokenOut,minOut:stage.legs[0].kind==='wrap'?stage.out:min(stage.out)||1n,branches:stage.legs.map(l=>({adapter:l.adapter,kind:l.kind==='wrap'?2:l.kind==='v3'?1:0,weightBps:l.weightBps,path:l.kind==='v2'?l.path:[],v3Path:l.kind==='v3'?l.path:'0x'}))})));
 const input={chainId:56,tokenIn:from,tokenOut:to,amountIn:amount.toString(),slippageBps:50,singleHop:false};
 const data={schema:1,chainId:56,router:R,input,blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:9000,expiresAt:20000,config:{version:'2.0.0',platformFeeBps:30,feeReceiver:A,wbnb:W,defaultFeeToken:defaultFee,feeConfigVersion:5n,adaptersOff:[]},quote:{kind:'fstswap',tokenIn:from,tokenOut:to,amountIn:amount,out,minimum:min(out),lpFee:fee,feeToken,feeMode:mode,configVersion:5n,impact:1-segments.reduce((v,s)=>v*(1-s.impact),1),poolCheckedAt:5000,stages,segments}};
 return{data,input};
}
function valid(f){return validateServiceQuote(f.data,f.input,options);}
test('FstSwap API accepts all six fee inputs and eligible fee outputs with exact net amounts',()=>{
 for(const fee of fees){assert.ok(valid(fixture({from:fee,to:A})));assert.ok(valid(fixture({from:A,to:fee})));}
});
test('FstSwap API keeps input fee priority when both endpoints are fee assets',()=>{
 const f=fixture({from:F,to:U});assert.equal(valid(f).quote.feeToken,F);assert.equal(f.data.quote.lpFee,30n);
});
test('FstSwap API supports complete intermediate fee routes with no pool reuse',()=>{
 const f=fixture({from:A,to:B});f.data.quote.segments[1].legs[0].poolIds=[P2];
 assert.ok(valid(f));assert.equal(f.data.quote.lpFee,60n);assert.equal(f.data.quote.out,39880n);
});
test('FstSwap API validates mixed V3/V2 stages and parallel direct splits',()=>{
 const first=leg(U,W,9970n,19940n,{v3:true}),second=leg(W,A,19940n,29910n,{pool:P2});
 const mixed=fixture({from:U,to:A,segments:[segment(U,A,9970n,29910n,{stages:[{tokenIn:U,tokenOut:W,out:19940n,legs:[first]},{tokenIn:W,tokenOut:A,out:29910n,legs:[second]}]})]});
 assert.ok(valid(mixed));
 const l1=leg(U,A,2492n,4984n,{weight:2500}),l2=leg(U,A,7478n,14956n,{weight:7500,pool:P2});
 const split=fixture({from:U,to:A,segments:[segment(U,A,9970n,19940n,{stages:[{tokenIn:U,tokenOut:A,out:19940n,legs:[l1,l2]}]})]});
 assert.ok(valid(split));
});
test('FstSwap API validates canonical native wrap and unwrap without a DEX adapter or pool',()=>{
 for(const [from,to] of [[Z,W],[W,Z]])assert.ok(valid(fixture({from,to,segments:[segment(from,to,9970n,9970n,{wrap:true})]})));
});
test('FstSwap API rejects mismatched input, route, fee, config and common expiry metadata',()=>{
 const patches=[f=>f.data.input.amountIn='2',f=>f.data.router=A,f=>f.data.chainId=97,f=>f.data.blockHash='bad',f=>f.data.expiresAt=9999,f=>f.data.quotedAt=13000,f=>f.data.quote.poolCheckedAt=10000,f=>f.data.quote.tokenIn=A,f=>f.data.quote.tokenOut=B,f=>f.data.quote.configVersion=4n,f=>f.data.quote.feeToken=F,f=>f.data.quote.feeMode='output',f=>f.data.quote.lpFee++,f=>f.data.quote.out++,f=>f.data.quote.minimum++,f=>f.data.config.defaultFeeToken=A,f=>f.data.config.adaptersOff=['pancake']];
 for(const patch of patches){const f=fixture();patch(f);assert.throws(()=>valid(f),undefined,patch.toString());}
});
test('FstSwap API rejects stage changes that do not match the quoted segment graph',()=>{
 const patches=[f=>f.data.quote.stages[0].tokenIn=A,f=>f.data.quote.stages[0].tokenOut=B,f=>f.data.quote.stages[0].minOut++,f=>f.data.quote.stages[0].branches[0].adapter=V,f=>f.data.quote.stages[0].branches[0].path=[U,B],f=>f.data.quote.stages[0].branches[0].weightBps=9999,f=>f.data.quote.stages.push(copy(f.data.quote.stages[0])),f=>f.data.quote.segments[0].amountIn++,f=>f.data.quote.segments[0].minimum++,f=>f.data.quote.segments[0].routeStages[0].out++,f=>f.data.quote.segments[0].legs[0].amountIn++,f=>f.data.quote.segments[0].legs[0].poolIds=[],f=>f.data.quote.segments[0].legs[0].kind='other',f=>f.data.quote.impact=.1];
 for(const patch of patches){const f=fixture();patch(f);assert.throws(()=>valid(f),undefined,patch.toString());}
});
test('FstSwap API rejects inconsistent split weights, amounts, outputs and duplicate pools',()=>{
 const make=()=>{const l1=leg(U,A,2492n,4984n,{weight:2500}),l2=leg(U,A,7478n,14956n,{weight:7500,pool:P2});return fixture({from:U,to:A,segments:[segment(U,A,9970n,19940n,{stages:[{tokenIn:U,tokenOut:A,out:19940n,legs:[l1,l2]}]})]});};
 for(const patch of [f=>f.data.quote.segments[0].legs[0].weightBps=2501,f=>f.data.quote.segments[0].legs[0].amountIn++,f=>f.data.quote.segments[0].legs[1].out++,f=>f.data.quote.segments[0].legs[1].poolIds=[P1]]){const f=make();patch(f);assert.throws(()=>valid(f));}
});
test('FstSwap API rejects reused intermediate pools and altered post-fee budgets',()=>{
 for(const patch of [f=>f.data.quote.segments[1].amountIn++,f=>f.data.quote.lpFee++,f=>f.data.quote.stages[1].tokenIn=F,f=>f.data.quote.segments[1].from=F,f=>f.data.quote.segments[1].legs[0].poolIds=[P1]]){const f=fixture({from:A,to:B});f.data.quote.segments[1].legs[0].poolIds=[P2];patch(f);assert.throws(()=>valid(f));}
});
test('FstSwap API rejects hidden execution representations and unbounded arrays',()=>{
 for(const key of ['first','second','route','method','conversion','maxIn','exactOut','candidates']){const f=fixture();f.data.quote[key]={};assert.throws(()=>valid(f));}
 const f=fixture();f.data.quote.stages=Array(7).fill(f.data.quote.stages[0]);assert.throws(()=>valid(f));
});
test('FstSwap API permits only known UI metadata additions when revalidating before submission',()=>{
 const f=fixture();Object.assign(f.data.quote,{serviceMeta:{},serviceExpiresAt:20000,feeAsset:{address:U,symbol:'USDT'}});assert.ok(valid(f));
});
test('FstSwap API client revives precise integers and preserves 1.11-independent balance operation',async()=>{
 const f=fixture(),client=createServiceClient({base:'https://test.invalid',clock,fetchImpl:async()=>new Response(encode(f.data))});
 const q=await client.quote({...f.input,amountIn:BigInt(f.input.amountIn)},options);assert.ok(q);assert.equal(q.quote.amountIn,10000n);
});
test('FstSwap API preserves explicit zero slippage and every allowed intermediate fee asset',()=>{
 const f=fixture();f.input.slippageBps=0;f.data.quote.minimum=f.data.quote.out;
 f.data.quote.segments.forEach(s=>{s.minimum=s.out;s.routeStages.forEach((r,n)=>{f.data.quote.stages[n].minOut=r.out;});});assert.ok(valid(f));
 for(const fee of fees){const bridge=fixture({from:A,to:B,defaultFee:fee});bridge.data.quote.segments[1].legs[0].poolIds=[P2];assert.ok(valid(bridge));}
});
test('single-hop FstSwap allows a required fee bridge but rejects multihop within either segment',()=>{
 const f=fixture({from:A,to:B});f.input.singleHop=true;f.data.quote.segments[1].legs[0].poolIds=[P2];assert.ok(valid(f));
 const first=leg(U,W,9970n,19940n,{v3:true}),second=leg(W,A,19940n,29910n,{pool:P2});
 const mixed=fixture({from:U,to:A,segments:[segment(U,A,9970n,29910n,{stages:[{tokenIn:U,tokenOut:W,out:19940n,legs:[first]},{tokenIn:W,tokenOut:A,out:29910n,legs:[second]}]})]});mixed.input.singleHop=true;assert.throws(()=>valid(mixed));
});
test('FstSwap API rejects invalid integer bounds, adapter categories, paths and added execution fields',()=>{
 const max=1n<<256n,patches=[f=>f.data.quote.minimum=0n,f=>f.data.quote.out=max,f=>f.data.quote.amountIn=10000,f=>f.data.quote.lpFee=-1n,f=>f.data.quote.configVersion=0n,f=>f.data.config.feeConfigVersion=0n,f=>f.data.config.platformFeeBps=101,f=>f.input.slippageBps=50.5,f=>f.data.quote.poolCheckedAt=5000.5,f=>f.data.quote.segments[0].impact=1.1,f=>f.data.config.wbnb=F,f=>f.data.quote.segments[0].legs[0].adapter=V,f=>f.data.quote.stages[0].branches[0].calldata='0x1234',f=>f.data.quote.stages[0].branches[0].value=1n,f=>f.data.quote.segments[0].legs[0].pool={},f=>f.data.quote.recipient=A];
 for(const patch of patches){const f=fixture();patch(f);assert.throws(()=>valid(f),undefined,patch.toString());}
});
test('a mutually consistent but cyclic staged execution is still rejected',()=>{
 const legs=[leg(U,W,9970n,19940n),leg(W,U,19940n,29910n,{pool:P2}),leg(U,A,29910n,59820n,{pool:P3})];
 const f=fixture({from:U,to:A,segments:[segment(U,A,9970n,59820n,{stages:legs.map(l=>({tokenIn:l.tokenIn,tokenOut:l.tokenOut,out:l.out,legs:[l]}))})]});assert.throws(()=>valid(f));
});
test('wrap quotes reject changed output, fake impact and a noncanonical wrapped token',()=>{
 for(const patch of [f=>f.data.quote.segments[0].legs[0].out++,f=>{f.data.quote.segments[0].impact=.01;f.data.quote.impact=.01;},f=>f.data.quote.segments[0].to=F]){const f=fixture({from:Z,to:W,segments:[segment(Z,W,9970n,9970n,{wrap:true})]});patch(f);assert.throws(()=>valid(f));}
});
test('FstSwap native V2 paths use the chosen adapter wrapped token without confusing canonical WBNB',()=>{
 const f=fixture({from:Z,to:F}),fstWrapped='0x0efb5fd2402a0967b92551d6af54de148504a115';f.data.quote.segments[0].legs[0].path[0]=fstWrapped;
 assert.ok(validateServiceQuote(f.data,f.input,{...options,adapters:{fst:{adapter:P,weth:fstWrapped}}}));
});
test('FstSwap API rejects a quotedAt time at or beyond the snapshot expiry even within clock-skew allowance',()=>{
 const f=fixture();f.data.quotedAt=20100;assert.throws(()=>validateServiceQuote(f.data,f.input,{...options,clock:()=>19500}));
});

test('FstSwap API still rejects an arbitrary token as TAX_UNVERIFIED instead of trusting its gross output',()=>{
 for(const[from,to]of[[U,'0x'+'aa'.repeat(20)],['0x'+'aa'.repeat(20),U]]){
  assert.throws(()=>valid(fixture({from,to})),{code:'TAX_UNVERIFIED'});
 }
});
