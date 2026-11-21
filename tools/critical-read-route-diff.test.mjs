import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder} from 'ethers';
import * as aggregator from '../src/swap-aggregator.mjs?v=mainnet-20261113-50';
import {benchmarkCodec} from './critical-read-benchmark-fixtures.mjs';
import {constructorRouteResults,multicallRouteResults,compareRouteResults} from './critical-read-route-diff.mjs';
const abi=AbiCoder.defaultAbiCoder(),codec=benchmarkCodec(aggregator),prefix='0x60006000f3';
const U=aggregator.SWAP_TOKENS.usdt.address.toLowerCase(),C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',W=aggregator.SWAP_ADAPTERS.v3.weth.toLowerCase();
const types=['uint256','tuple(uint8,address,address,uint24)[]','tuple(uint8,uint16,uint256)[]','uint16[4]'];
const payload={method:'eth_call',params:[{data:prefix+abi.encode(types,[291n,[[2,U,C,0],[3,C,W,100]],[[0,65535,100n],[0,65535,100n],[1,0,0n]],[0,2,3,3]]).slice(2)},'0x123']};
const response=values=>({result:abi.encode(['uint256','uint256[]','uint256'],[291n,values??[90n,90n,80n],2n])});
const v2=[aggregator.swapActiveRouter(),codec.encodeFunctionData('getAmountsOutVia',[aggregator.SWAP_ADAPTERS.pancake.adapter,100n,[U,C]])];
const v3=[aggregator.SWAP_ADAPTERS.v3.adapter,codec.encodeFunctionData('quoteExactIn',[C+'000064'+W.slice(2),90n])];
const basePayload={method:'eth_call',params:[{to:'0xca11bde05977b3631167028862be2a173976ca11',data:codec.encodeFunctionData('tryAggregate',[false,[v2,v3]])},'0x123']};
const baseResponse={result:codec.encodeFunctionResult('tryAggregate',[[[true,codec.encodeFunctionResult('getAmountsOutVia',[[100n,90n]])],[true,codec.encodeFunctionResult('quoteExactIn',[80n])]]])};
const baseline=()=>multicallRouteResults(codec,basePayload,baseResponse);

test('constructor prior dependencies reconstruct the exact complete V2/V3 request/result map',()=>{
 const r=constructorRouteResults(codec,payload,response(),prefix,aggregator);
 assert.equal(r.available,true);assert.equal(r.calls.length,3);
 assert.equal(r.calls[2].callData,v3[1].toLowerCase());
 const d=compareRouteResults(baseline(),r.calls);
 assert.equal(d.same,true);assert.equal(d.beforeUnique,2);assert.equal(d.afterUnique,2);
});
test('an altered output is caught even when the other call remains identical',()=>{
 const r=constructorRouteResults(codec,payload,response([90n,90n,81n]),prefix,aggregator);
 const d=compareRouteResults(baseline(),r.calls);
 assert.equal(d.same,false);assert.equal(d.different.length,1);
});
test('conflicting duplicate outputs cannot hide behind deduplication',()=>{
 const rows=baseline(),d=compareRouteResults(rows,[...rows,{...rows[0],out:'91'}]);
 assert.equal(d.same,false);assert.equal(d.conflicts.length,1);
});
test('failed constructor returns are excluded so ordinary fallback results remain comparable',()=>{
 for(const bad of [{error:{code:-32000,message:'out of gas'}},response([0n,0n,0n]),{result:'0x'}]){
  const r=constructorRouteResults(codec,payload,bad,prefix,aggregator);
  assert.equal(r.available,false);assert.deepEqual(r.calls,[]);
  assert.equal(compareRouteResults(baseline(),[...r.calls,...baseline()]).same,true);
 }
});
test('unknown creation bytecode does not invent a reconstructed request map',()=>{
 const r=constructorRouteResults(codec,payload,response(),'0x1234',aggregator);
 assert.equal(r.available,false);assert.deepEqual(r.calls,[]);
});
test('all request keys are compared, including missing and extra queries',()=>{
 const rows=baseline(),d=compareRouteResults(rows,[rows[0],{...rows[1],key:rows[1].key+'extra'}]);
 assert.equal(d.same,false);assert.equal(d.missing.length,1);assert.equal(d.extra.length,1);
});
