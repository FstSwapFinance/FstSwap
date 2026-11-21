import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFstQuote,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {createPoolPolicy} from '../src/swap-liquidity.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const input='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e';
const output='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c';
const usdt=FST_FEE_ASSETS.USDT;
const config={version:'2.1.0',platformFeeBps:30,defaultFeeToken:usdt,feeConfigVersion:1n,adaptersOff:[]};
const route=(from,to,amountIn,out,pool)=>({from,to,amountIn,out,impact:0,assertFresh(){},
 legs:[{kind:'v2',adapter:address(9),path:[from,to],tokenIn:from,tokenOut:to,amountIn,out,poolIds:[address(pool)]}]});
// Candidate-pool disjointness can give the two first segments different second
// segments. These deterministic route outputs are synthetic; the independent
// value rejection itself comes from the real production price policy.
const prices=new Map([[usdt,10n**18n],[output,10n**18n]]);
const valuePolicy=createPoolPolicy(new Map(),prices,usdt,output);
function fixture(second){
 const first=[route(input,usdt,10000n,20000n,1),route(input,usdt,10000n,19000n,2)],calls=[];
 return{calls,run:()=>buildFstQuote({tokenIn:input,tokenOut:output,amountIn:10000n,config,slippageBps:50,
  findRoute:async(from,to,amount,used)=>{
   if(from===input)return{...first[0],candidates:first};
   const index=Number(BigInt(used[0].poolIds[0]))-1;calls.push({index,amount});
   return second({index,from,to,amount});
  }})};
}
function pricedRoute({from,to,amount},out){
 valuePolicy.assertValue(amount,out*9950n/10000n);
 return route(from,to,amount,out,3);
}

test('an intermediate candidate rejected by its price floor cannot hide another protected complete route',async()=>{
 const f=fixture(args=>pricedRoute(args,args.index===0?10000n:args.amount));
 const q=await f.run();
 assert.equal(f.calls.length,2);
 assert.deepEqual(q.segments[0].legs[0].poolIds,[address(2)]);
 assert.equal(q.lpFee,57n);assert.equal(q.out,18943n);assert.equal(q.minimum,18848n);
 assert.deepEqual(q.stages.map(stage=>stage.minOut),[18905n,18848n]);
 assert.doesNotThrow(()=>valuePolicy.assertValue(q.segments[1].amountIn,q.minimum));
});

test('all intermediate candidates failing price floors retain the price rejection instead of publishing a quote',async()=>{
 const errors=[];
 const f=fixture(args=>{
  try{return pricedRoute(args,10000n);}catch(error){errors[args.index]=error;throw error;}
 });
 await assert.rejects(f.run(),error=>error===errors[0]&&error.code==='POOL_LIQUIDITY'&&error.reason==='price');
 assert.equal(f.calls.length,2);
});

test('an intermediate price rejection is preserved when the other candidate has no disjoint route',async()=>{
 let rejected;
 const f=fixture(args=>{
  if(args.index===1)throw Object.assign(Error('No disjoint second segment'),{code:'NO_ROUTE'});
  try{return pricedRoute(args,10000n);}catch(error){rejected=error;throw error;}
 });
 await assert.rejects(f.run(),error=>error===rejected&&error.reason==='price');
});

for(const [code,reason,retryable,name] of [
 ['POOL_LIQUIDITY','stale',true],['POOL_LIQUIDITY','oracle',true],['POOL_LIQUIDITY','data',true],
 ['POOL_LIQUIDITY','liquidity',false],['POOL_LIQUIDITY','price',true],
 ['TAX_UNVERIFIED',undefined,false],['UNSAFE_QUOTE',undefined,false],['ABORT_ERR',undefined,false,'AbortError'],
])test(`a ${name||code}/${reason||'global'} failure cannot downgrade to another intermediate candidate`,async()=>{
 const failure=Object.assign(Error('Global validation failed'),{code,reason,retryable,...(name?{name}:{})});
 let validCandidateCompleted=false;
 const f=fixture(async args=>{
  if(args.index===0){await Promise.resolve();throw failure;}
  const valid=pricedRoute(args,args.amount);validCandidateCompleted=true;return valid;
 });
 await assert.rejects(f.run(),error=>error===failure);
 assert.equal(validCandidateCompleted,true,'a completed alternative must not mask a global validation failure');
});
