import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createReadPool,createEngine} from '../server/fstswap-service.mjs';

const A='0x'+'11'.repeat(20),T='0x55d398326f99059ff775485246999027b3197955',Z=ethers.ZeroAddress;
const body={chainId:56,account:A,tokens:[Z,T]};
const E=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function getEthBalance(address) view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const gate=()=>{let release;return{promise:new Promise(resolve=>release=resolve),release};};
function fixture(t,{holdBootstrap=false,slowBootstrap=false,wrongFirst=false,reorg=false}={}){
 let now=1800000000000,mono=0,height=256;const http=[],headers=new Map(),held=gate(),started=gate();t.after(held.release);
 const advance=ms=>{now+=ms;mono+=ms;};
 const pool=createReadPool(wrongFirst?['https://one.invalid','https://two.invalid']:['https://one.invalid'],{clock:()=>now,fetchImpl:async(url,options)=>{
  const wire=JSON.parse(options.body),items=Array.isArray(wire)?wire:[wire],index=http.length;http.push({url,wire,signal:options.signal});
  const rows=items.map(item=>{
   let result;
   if(item.method==='eth_chainId')result=wrongFirst&&url==='https://one.invalid'?'0x1':'0x38';
   else if(item.method==='eth_getBlockByNumber'){
    if(item.params[0]==='latest'){
     result={number:ethers.toQuantity(height),hash:'0x'+(height+(url==='https://two.invalid'?1000:0)).toString(16).padStart(64,'0'),timestamp:ethers.toQuantity(Math.floor(now/1000))};
     headers.set(url+':'+result.number,result);
    }else{result=headers.get(url+':'+item.params[0]);if(reorg)result={...result,hash:'0x'+'ff'.repeat(32)};}
   }else{
    assert.equal(item.method,'eth_call');assert.ok(headers.has(url+':'+item.params[1]),'balances stay pinned to this node explicit header');
    const calls=E.decodeFunctionData('tryAggregate',item.params[0].data)[1];
    result=E.encodeFunctionResult('tryAggregate',[calls.map(call=>[true,E.encodeFunctionResult(E.parseTransaction({data:call.callData}).name,[7n])])]);
   }
   return{jsonrpc:'2.0',id:item.id,result};
  });
  if(index===0&&holdBootstrap){started.release();await held.promise;}
  if(index===0&&slowBootstrap)advance(600);
  return new Response(JSON.stringify(Array.isArray(wire)?rows.reverse():rows[0]));
 }});
 const engine=createEngine(pool,{clock:()=>now,monotonic:()=>mono,warmup:{enabled:false}});t.after(()=>engine.stopWarmup());
 return{pool,engine,http,held,started,advance,advanceMono:ms=>mono+=ms,next:()=>height++};
}

test('a cold fresh balance request uses two physical rounds with a new pinned header and canonical hash',async t=>{
 const f=fixture(t),result=await f.engine.balances(body,{fresh:true});
 assert.equal(f.http.length,2);assert.deepEqual(f.http[0].wire.map(item=>item.method),['eth_chainId','eth_getBlockByNumber']);
 assert.deepEqual(f.http[1].wire.map(item=>item.method),['eth_call','eth_getBlockByNumber']);
 assert.equal(f.http[1].wire[0].params[1],result.blockNumber);assert.equal(f.http[1].wire[1].params[0],result.blockNumber);
 assert.deepEqual(result.balances,{[Z]:'7',[T]:'7'});
});

test('fresh balances joining an older shared chain bootstrap obtain a new header instead of the earlier captured block',async t=>{
 const f=fixture(t,{holdBootstrap:true}),priming=f.pool.run((_r,_n,_s,bootstrap)=>bootstrap,new AbortController().signal,{bootstrapLatest:true});
 await f.started.promise;f.advance(1);f.next();const fresh=f.engine.balances(body,{fresh:true});f.held.release();
 const [old,result]=await Promise.all([priming,fresh]);assert.equal(old.block.number,'0x100');assert.equal(result.blockNumber,'0x101');
 assert.equal(f.http.length,3,'an older shared bootstrap cannot replace this fresh request header round');
 assert.equal(f.http[1].wire.method,'eth_getBlockByNumber');
});

test('fresh balances use causal guard ownership even when an earlier bootstrap has the identical timestamp',async t=>{
 const f=fixture(t,{holdBootstrap:true}),priming=f.pool.run((_r,_n,_s,bootstrap)=>bootstrap,new AbortController().signal,{bootstrapLatest:true});
 await f.started.promise;f.next();const fresh=f.engine.balances(body,{fresh:true});f.held.release();
 const [old,result]=await Promise.all([priming,fresh]);
 assert.equal(old.observedAt,1800000000000);assert.equal(result.readAt,old.observedAt,'a frozen wall clock cannot prove ownership of an earlier header');
 assert.equal(old.block.number,'0x100');assert.equal(result.blockNumber,'0x101','fresh must fetch its own header after joining the existing chain guard');
 assert.equal(f.http.length,3);assert.deepEqual(f.http[2].wire.map(item=>item.method),['eth_call','eth_getBlockByNumber']);
 assert.equal(f.http[2].wire[1].params[0],result.blockNumber,'the new block still receives a canonical hash check');
});

test('an ordinary balance miss joining an older same-ms bootstrap cannot renew its monotonic cache age',async t=>{
 const f=fixture(t,{holdBootstrap:true}),priming=f.pool.run((_r,_n,_s,bootstrap)=>bootstrap,new AbortController().signal,{bootstrapLatest:true});
 await f.started.promise;f.advanceMono(600);f.next();const ordinary=f.engine.balances(body);f.held.release();
 const [old,result]=await Promise.all([priming,ordinary]);
 assert.equal(old.observedAt,result.readAt,'wall time remains fixed while the older bootstrap exceeds the 500ms monotonic window');
 assert.equal(old.block.number,'0x100');assert.equal(result.blockNumber,'0x101','ordinary cache misses must acquire their own causally newer header');
 const before=f.http.length,next=await f.engine.balances(body);
 assert.equal(f.http.length-before,1,'only the newly read header may begin a legitimate short cache window');assert.equal(next.blockHash,result.blockHash);
 f.advanceMono(500);f.next();const expired=await f.engine.balances(body);
 assert.equal(expired.blockNumber,'0x102','a cache hit never renews the new header original monotonic deadline');
});

test('a bootstrap slower than 500 ms never receives a new header reuse budget at operation completion',async t=>{
 const f=fixture(t,{slowBootstrap:true});await f.engine.balances(body);f.next();const before=f.http.length;
 const result=await f.engine.balances(body);assert.equal(f.http.length-before,2);assert.equal(result.blockNumber,'0x101');
});

test('a cold bootstrap canonical mismatch rejects the whole balance result',async t=>{
 const f=fixture(t,{reorg:true});await assert.rejects(f.engine.balances(body,{fresh:true}),{code:'STALE_BLOCK'});
 assert.equal(f.http.length,2);assert.equal(f.pool.health().providers[0].ready,false);
});

test('a wrong-chain first node cannot lend its bootstrap to the successful balance attempt',async t=>{
 const f=fixture(t,{wrongFirst:true}),result=await f.engine.balances(body,{fresh:true});
 assert.equal(f.http.length,3);assert.deepEqual(f.http.map(item=>item.url),['https://one.invalid','https://two.invalid','https://two.invalid']);
 assert.equal(result.blockHash,'0x'+(256+1000).toString(16).padStart(64,'0'));
});

test('an aborted bootstrap never publishes a header or stale balances to a later request',async t=>{
 const f=fixture(t,{holdBootstrap:true}),controller=new AbortController(),work=f.engine.balances(body,{signal:controller.signal,fresh:true});work.catch(()=>{});
 await f.started.promise;controller.abort();await assert.rejects(work,{code:'REQUEST_ABORTED'});f.held.release();f.next();
 const next=await f.engine.balances(body,{fresh:true});assert.equal(next.blockNumber,'0x101');assert.equal(f.http.length,3);
});
