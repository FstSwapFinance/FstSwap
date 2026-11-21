import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createEngine,createReadPool} from '../server/fstswap-service.mjs';
const Z=ethers.ZeroAddress,A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),T='0x55d398326f99059ff775485246999027b3197955';
const I=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function getEthBalance(address) view returns(uint256)','function balanceOf(address) view returns(uint256)']);
function fixture(){
 let now=1800000000000,mono=1000,height=256,reorg=false;const http=[],headers=new Map();
 const head=()=>{const number=ethers.toQuantity(height),value={number,hash:'0x'+height.toString(16).padStart(64,'0'),timestamp:ethers.toQuantity(Math.floor(now/1000))};headers.set(number,value);return value;};
 const pool=createReadPool(['https://balances.invalid'],{clock:()=>now,fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body);http.push(body);
  const result=item=>{
   if(item.method==='eth_chainId')return'0x38';
   if(item.method==='eth_getBlockByNumber'){if(item.params[0]==='latest')return head();const block=headers.get(item.params[0]);return reorg?{...block,hash:'0x'+'ff'.repeat(32)}:block;}
   assert.equal(item.method,'eth_call');const rows=I.decodeFunctionData('tryAggregate',item.params[0].data)[1];
   return I.encodeFunctionResult('tryAggregate',[rows.map(call=>{const p=I.parseTransaction({data:call.callData}),value=p.args[0].toLowerCase()===A?7n:9n;return[true,I.encodeFunctionResult(p.name,[value])];})]);
  };
  const reply=item=>({jsonrpc:'2.0',id:item.id,result:result(item)});
  return new Response(JSON.stringify(Array.isArray(body)?body.map(reply):reply(body)));
 }});
 const engine=createEngine(pool,{clock:()=>now,monotonic:()=>mono,warmup:{enabled:false}});
 return{engine,http,advance:ms=>{now+=ms;mono+=ms;},next:()=>{height++;},reorg:value=>{reorg=value;}};
}
const body=account=>({chainId:56,account,tokens:[Z,T]});
test('warm balance reads remove only the header round while reading each account balance again',async()=>{
 const f=fixture(),first=await f.engine.balances(body(A)),afterFirst=f.http.length;
 const second=await f.engine.balances(body(B));
 assert.equal(afterFirst,3,'chain guard, latest, then balance/canonical batch');
 assert.equal(f.http.length-afterFirst,1,'a warm completed header removes one HTTP round');
 assert.deepEqual(first.balances,{[Z]:'7',[T]:'7'});assert.deepEqual(second.balances,{[Z]:'9',[T]:'9'});
 assert.equal(first.blockHash,second.blockHash);assert.equal(f.http.at(-1).length,2);
});
test('fresh balance reads bypass a valid short header after a receipt advances the chain',async()=>{
 const f=fixture(),first=await f.engine.balances(body(A));f.next();const before=f.http.length;
 const next=await f.engine.balances(body(A),{fresh:true});
 assert.equal(f.http.length-before,2);assert.notEqual(next.blockHash,first.blockHash);assert.equal(next.blockNumber,'0x101');
});
test('expired balance headers cannot save a round or renew their original observation',async()=>{
 const f=fixture();await f.engine.balances(body(A));f.advance(400);await f.engine.balances(body(A));f.advance(101);f.next();const before=f.http.length;
 const next=await f.engine.balances(body(A));assert.equal(f.http.length-before,2);assert.equal(next.blockNumber,'0x101');
});
test('a warm canonical mismatch rejects without publishing and preserves the node cooldown',async()=>{
 const f=fixture();await f.engine.balances(body(A));f.reorg(true);
 await assert.rejects(f.engine.balances(body(A)),error=>error.code==='STALE_BLOCK');
 assert.equal(Array.isArray(f.http.at(-1)),true,'the cached-header path still physically rechecks the canonical block');
 await assert.rejects(f.engine.balances(body(A)),error=>error.code==='UPSTREAM_UNAVAILABLE');
});
