import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {quoteFstRoutes,buildFstQuote,quoteFstSwap,fstRequest,FST_ABI,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {SWAP_ABI,SWAP_ADAPTERS,swapActiveRouter} from '../src/swap-aggregator.mjs';

globalThis.ethers=ethers;
const A=n=>'0x'+n.toString(16).padStart(40,'0'),ZERO=ethers.ZeroAddress;
const U=FST_FEE_ASSETS.USDT,C=FST_FEE_ASSETS.USDC,W=FST_FEE_ASSETS.WBNB,T=A(0xa1),B=A(0xb1);
const fst=SWAP_ADAPTERS.fst.adapter.toLowerCase(),pancake=SWAP_ADAPTERS.pancake.adapter.toLowerCase();
const router=new ethers.Interface(SWAP_ABI),multi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const codeHash='0x'+'ab'.repeat(32),block='0x123';
const none=()=>({kind:'none'}),tax=(pair,buyBps=300n,sellBps=300n)=>({kind:'pair',pair,buyBps,sellBps,codeHash,blockNumber:block});
const config={version:'2.1.0',platformFeeBps:30,defaultFeeToken:U,feeConfigVersion:4n,adaptersOff:[]};

// The mock only implements the DEX's pre-transfer getAmountsOut result. Tax
// classification and net route selection run through production quoteFstRoutes.
function fixture(specs,{profiles,failedAdapters=[]}={}){
 const pools=new Map(),models=new Map(),calls=[];
 for(const [id,adapter,token0,token1,numerator=2n,denominator=1n]of specs){
  const p={id:String(id),address:A(id),adapter,token0,token1,kind:'v2',reserves:[1000000n*denominator,1000000n*numerator]};
  pools.set(p.id,p);models.set(adapter+':'+[token0,token1].sort().join(':'),{...p,numerator,denominator});
 }
 const transferTaxes=profiles||new Map([...new Set(specs.flatMap(s=>[s[2],s[3]]))].map(t=>[t,none()]));
 const policy={pools,blockNumber:block,timestamp:1800000000,allowsRoute:()=>true,assertFresh(){}};
 const request=async payload=>{
  assert.equal(payload.method,'eth_call');assert.equal(payload.params[1],block,'quote uses one pinned block');
  assert.equal(payload.params[0].to.toLowerCase(),'0xca11bde05977b3631167028862be2a173976ca11');
  const [,batch]=multi.decodeFunctionData('tryAggregate',payload.params[0].data);
  const decoded=batch.map(call=>{
   assert.equal(call.target.toLowerCase(),swapActiveRouter().toLowerCase());
   const tx=router.parseTransaction({data:call.callData});assert.equal(tx.name,'getAmountsOutVia');
   const [adapter,amount,path]=tx.args,normalized=adapter.toLowerCase(),tokens=[...path].map(x=>x.toLowerCase());
   const model=models.get(normalized+':'+[...tokens].sort().join(':'));assert.ok(model,'no invented pool in the route');
   const forward=tokens[0]===model.token0;
   const out=forward?amount*model.numerator/model.denominator:amount*model.denominator/model.numerator;
   return{adapter:normalized,amount,tokens,out};
  });calls.push(decoded);
  return multi.encodeFunctionResult('tryAggregate',[decoded.map(x=>failedAdapters.includes(x.adapter)?[false,'0x']:[true,router.encodeFunctionResult('getAmountsOutVia',[[x.amount,x.out]])])]);
 };
 const route=(from,to,amount,extra={})=>quoteFstRoutes(request,{from,to,amount,policy,configVersion:'2.1.0',linearV2Only:true,transferTaxes,...extra});
 const quote=(from,to,amountIn=10000n,slippageBps=50)=>buildFstQuote({tokenIn:from,tokenOut:to,amountIn,config,slippageBps,
  findRoute:(a,b,amount,used,routeOptions)=>route(a,b,amount,{used,...routeOptions})});
 return{pools,policy,request,calls,transferTaxes,route,quote};
}

const shape=leg=>({amountIn:leg.amountIn,poolAmountIn:leg.poolAmountIn,grossOut:leg.grossOut,out:leg.out,transferInBps:leg.transferInBps,transferOutBps:leg.transferOutBps});

test('canonical pool buy compares user net receipt instead of pre-transfer router output',async()=>{
 const f=fixture([[1,fst,U,T]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 const q=await f.route(U,T,10000n);
 assert.equal(q.out,19400n,'a 20000 pool output delivers 19400 to a non-exempt recipient');
 assert.deepEqual(shape(q.legs[0]),{amountIn:10000n,poolAmountIn:10000n,grossOut:20000n,out:19400n,transferInBps:0,transferOutBps:300});
 assert.equal(q.impact,0,'flat AMM price has no price impact merely because the token takes 3%');
});

test('canonical pool sell quotes the amount actually deposited after input transfer tax',async()=>{
 const f=fixture([[1,fst,T,U]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 const q=await f.route(T,U,10000n);
 assert.equal(q.out,19400n);assert.equal(f.calls[0][0].amount,9700n,'router must receive the real pair balance delta');
 assert.deepEqual(shape(q.legs[0]),{amountIn:10000n,poolAmountIn:9700n,grossOut:19400n,out:19400n,transferInBps:300,transferOutBps:0});
 assert.equal(q.impact,0);
});

for(const direction of ['buy','sell'])test(`noncanonical ${direction} does not apply the canonical-pair tax globally`,async()=>{
 const from=direction==='buy'?U:T,to=direction==='buy'?T:U;
 const f=fixture([[2,fst,from,to]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 const q=await f.route(from,to,10000n);
 assert.equal(q.out,20000n);assert.equal(q.legs[0].poolAmountIn,10000n);assert.equal(q.legs[0].transferInBps,0);assert.equal(q.legs[0].transferOutBps,0);
});

test('canonical pair to next pair pays one buy tax and next hop uses prefunded net balance without taxing again',async()=>{
 const f=fixture([[1,fst,U,T],[2,pancake,T,C]],{profiles:new Map([[U,none()],[C,none()],[T,tax(A(1))]])});
 const q=await f.route(U,C,10000n);
 assert.equal(q.out,38800n);assert.deepEqual(q.legs.map(l=>[l.amountIn,l.poolAmountIn,l.grossOut,l.out,l.transferInBps,l.transferOutBps]),[
  [10000n,10000n,20000n,19400n,0,300],[19400n,19400n,38800n,38800n,0,0],
 ]);
 assert.equal(f.calls[1][0].amount,19400n);assert.equal(q.impact,0);
});

test('other pair to canonical next pair pays sell tax on that transfer rather than charging the prefunded hop again',async()=>{
 const f=fixture([[1,fst,U,T],[2,pancake,T,C]],{profiles:new Map([[U,none()],[C,none()],[T,tax(A(2),700n,300n)]])});
 const q=await f.route(U,C,10000n);
 assert.equal(q.out,38800n);assert.equal(q.legs[0].transferOutBps,300,'destination canonical pair makes this a sell');
 assert.equal(q.legs[1].transferInBps,0,'the same transfer is not charged twice');assert.equal(q.legs[1].poolAmountIn,19400n);
});

test('candidate winner is selected by net output when a larger gross quote loses to an untaxed pool',async()=>{
 const f=fixture([[1,fst,U,T,2n],[2,pancake,U,T,198n,100n]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 const q=await f.route(U,T,10000n);
 assert.equal(q.out,19800n);assert.equal(q.legs[0].poolIds[0],A(2),'19400 net from the 20000 gross pool must lose');
 assert.deepEqual(q.candidates.map(c=>c.out),[19800n,19400n]);
});

test('a direction-specific sell rate is read separately from buy rate',async()=>{
 const profiles=new Map([[U,none()],[T,tax(A(1),700n,100n)]]);
 const buy=await fixture([[1,fst,U,T]],{profiles}).route(U,T,10000n);
 const sell=await fixture([[1,fst,T,U]],{profiles}).route(T,U,10000n);
 assert.equal(buy.out,18600n);assert.equal(sell.out,19800n);
});

test('input platform fee is deducted once before tax-aware route funding and minimum uses final net receipt',async()=>{
 const f=fixture([[1,fst,U,T]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 const q=await f.quote(U,T);
 assert.equal(q.lpFee,30n);assert.equal(q.segments[0].amountIn,9970n);assert.equal(q.segments[0].legs[0].grossOut,19940n);
 assert.equal(q.out,19342n);assert.equal(q.minimum,19245n);assert.equal(q.stages[0].minOut,19245n);
 const encoded=new ethers.Interface(FST_ABI).parseTransaction(fstRequest(ethers.Interface,{router:swapActiveRouter(),account:A(99),quote:q,deadline:1800001200}));
 assert.equal(encoded.args[0].amountIn,10000n);assert.equal(encoded.args[0].minOut,19245n);
});

test('output platform fee uses the actual aggregator receipt after input token tax',async()=>{
 const f=fixture([[1,fst,T,U]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 const q=await f.quote(T,U);
 assert.equal(q.segments[0].out,19400n);assert.equal(q.stages[0].minOut,19303n,'stage checks the pre-platform-fee aggregator receipt');
 assert.equal(q.lpFee,58n);assert.equal(q.out,19342n);assert.equal(q.minimum,19245n);
});

test('intermediate platform fee is charged between net first receipt and tax-aware final receipt',async()=>{
 const f=fixture([[1,fst,T,U],[2,pancake,U,B]],{profiles:new Map([[U,none()],[T,tax(A(1))],[B,tax(A(2))]])});
 const q=await f.quote(T,B);
 assert.equal(q.feeMode,'intermediate');assert.equal(q.segments[0].out,19400n);assert.equal(q.lpFee,58n);
 assert.equal(q.segments[1].amountIn,19342n);assert.equal(q.segments[1].legs[0].grossOut,38684n);assert.equal(q.out,37524n);
 assert.equal(q.minimum,37336n);assert.deepEqual(q.stages.map(s=>s.minOut),[19303n,37336n]);
});

test('three-hop protection keeps per-stage net minimums and one global slippage floor, not compounded final slippage',async()=>{
 const f=fixture([[1,fst,U,W,1n],[2,pancake,W,T,1n],[3,fst,T,C,1n]],{profiles:new Map([[U,none()],[W,none()],[C,none()],[T,tax(A(2))]])});
 const q=await f.quote(U,C);
 assert.equal(q.out,9671n);assert.deepEqual(q.segments[0].routeStages.map(s=>s.out),[9970n,9671n,9671n]);
 assert.deepEqual(q.stages.map(s=>s.minOut),[9920n,9622n,9622n]);assert.equal(q.minimum,9622n);
 assert.ok(q.minimum>9526n,'three stages must not expand the final loss budget to repeated slippage');
});

test('tax rounding subtracts floor(gross * bps) and preserves full 18-decimal integer precision',async()=>{
 const f=fixture([[1,fst,U,T,1n]],{profiles:new Map([[U,none()],[T,tax(A(1))]])});
 assert.equal((await f.route(U,T,1n)).out,1n);assert.equal((await f.route(U,T,99n)).out,97n,'99 minus floor(2.97) is 97, not floor(96.03)');
 const sixDecimals=await f.route(U,T,123456789n);assert.equal(sixDecimals.out,119753086n,'the same integer semantics preserve six-decimal token base units');
 const full=await f.route(U,T,123456789123456789123n);assert.equal(full.out,119753085449753085450n);
});

test('unverified transfer profiles cannot silently become a gross output promise',async()=>{
 const f=fixture([[1,fst,U,T]],{profiles:new Map([[U,none()]])});
 await assert.rejects(f.route(U,T,10000n),{code:'TAX_UNVERIFIED'});
});

test('a failed larger source is excluded while a verified executable net quote remains available',async()=>{
 const f=fixture([[1,fst,U,T,2n],[2,pancake,U,T,198n,100n]],{profiles:new Map([[U,none()],[T,tax(A(1))]]),failedAdapters:[fst]});
 const q=await f.route(U,T,10000n);assert.equal(q.out,19800n);assert.equal(q.candidates.length,1);assert.equal(q.legs[0].poolIds[0],A(2));
});

test('BNB and WBNB wrap paths keep their existing fee and unit semantics without token tax reads',async()=>{
 const request=async()=>{throw Error('wrap must not perform a DEX or tax RPC read');};
 for(const [tokenIn,tokenOut]of [[ZERO,W],[W,ZERO]]){
  const q=await quoteFstSwap(request,{tokenIn,tokenOut,amountIn:10001n,config,slippageBps:50});
  assert.equal(q.lpFee,30n);assert.equal(q.out,9971n);assert.equal(q.stages[0].minOut,9971n);assert.equal(q.minimum,9921n);
 }
});
