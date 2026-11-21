import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceClient} from '../src/swap-service-client.mjs';

const account='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20);
for(const [name,origin,base,want]of[
 ['same-origin relative API','https://fstswap-live.vercel.app','/api/swap','same-origin'],
 ['same-origin absolute API','https://fstswap-live.vercel.app','https://fstswap-live.vercel.app/api/swap','same-origin'],
 ['cross-origin read API','https://fstswap-live.vercel.app','https://logo-api.fstswap.si/api/swap','omit'],
 ['another protocol is not the same origin','https://fst.test','http://fst.test/api/swap','omit'],
 ['non-browser client has no ambient credentials',null,'https://fst.test/api/swap','omit'],
])test(name+' uses the intended connection mode for both warmup and reads',async t=>{
 const old=globalThis.location;if(origin)globalThis.location={origin};else delete globalThis.location;
 t.after(()=>{if(old===undefined)delete globalThis.location;else globalThis.location=old;});
 const requests=[];
 const client=createServiceClient({base,fetchImpl:async(url,options)=>{
  requests.push({url,method:options.method,credentials:options.credentials});
  if(options.method==='GET')return new Response(JSON.stringify({ready:true}));
  return new Response(JSON.stringify({schema:1,chainId:56,account,blockHash:'0x'+'ab'.repeat(32),blockNumber:'0x1',readAt:Date.now(),balances:{[token]:'123'},failedTokens:[]}));
 }});
 assert.equal(await client.warmConnection(),true);
 assert.deepEqual(await client.balances(account,[{key:'token',address:token}]),{balances:{token:123n},failed:[]});
 assert.deepEqual(requests.map(r=>[r.method,r.credentials]),[['GET',want],['POST',want]]);
 assert.equal(requests.some(r=>r.credentials==='include'),false,'cross-origin credentials must never be enabled');
});
