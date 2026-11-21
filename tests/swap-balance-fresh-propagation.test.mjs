import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceClient,swapService} from '../src/swap-service-client.mjs?v=mainnet-20261113-50';
import {readWalletBalances,invalidateWalletBalances} from '../src/swap-balances.mjs';
const account='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),tokens=[{key:'token',address:token,decimals:18}];
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
const response=amount=>new Response(JSON.stringify({schema:1,chainId:56,account,blockNumber:'0x100',blockHash:'0x'+'ab'.repeat(32),readAt:Date.now(),balances:{[token]:String(amount)},failedTokens:[]}));
test('a fresh balance consumer does not join a nonfresh pending API read and sends the fresh header',async()=>{
 const old=deferred(),seen=[];
 const client=createServiceClient({base:'https://balances.invalid',fetchImpl:async(_url,options)=>{seen.push(options.headers);if(options.headers['x-fstswap-fresh']==='1')return response(9);await old.promise;return response(1);}});
 const prior=client.balances(account,tokens);await tick();
 const latest=client.balances(account,tokens,{fresh:true});await tick();
 try{assert.equal(seen.length,2);assert.equal(seen[1]['x-fstswap-fresh'],'1');assert.equal((await latest).balances.token,9n);}
 finally{old.resolve();}
 assert.equal((await prior).balances.token,1n);
});
test('wallet fresh invalidation propagates through the physical balance batch to the API',async t=>{
 invalidateWalletBalances();const original=swapService.balances,flags=[];
 swapService.balances=async(_account,_tokens,options)=>{flags.push(options.fresh);return{balances:{token:7n},failed:[]};};
 t.after(()=>{swapService.balances=original;invalidateWalletBalances();});
 const publicRead=async()=>{throw Error('Unexpected public fallback');};
 assert.equal((await readWalletBalances(publicRead,account,tokens)).balances.token,7n);
 assert.equal((await readWalletBalances(publicRead,account,tokens,{fresh:true})).balances.token,7n);
 assert.deepEqual(flags,[false,true]);
});
