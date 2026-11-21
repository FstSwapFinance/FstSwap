import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceClient} from '../src/swap-service-client.mjs';
test('connection warming is one shared simple GET and fully drains the response',async()=>{
 let calls=0,drained=false,release;const gate=new Promise(resolve=>release=resolve);
 const client=createServiceClient({base:'https://example.test/api/swap',fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'https://example.test/api/swap/health');assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.headers,undefined);assert.equal(init.cache,'no-store');assert.ok(init.signal);await gate;
  return{ok:true,text:async()=>{drained=true;return '{}';}};
 }});
 const first=client.warmConnection(),second=client.warmConnection();assert.equal(first,second);assert.equal(calls,1);assert.equal(client.available(),true);release();assert.equal(await first,true);assert.equal(drained,true);assert.equal(await client.warmConnection(),true);assert.equal(calls,1);
});
test('connection failures never put executable quote reads into cooldown',async()=>{
 const client=createServiceClient({base:'https://example.test/api/swap',fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(await client.warmConnection(),false);assert.equal(client.available(),true);
});
test('disabled service connection warming makes no network or wallet request',async()=>{
 const client=createServiceClient({fetchImpl:()=>{throw Error('must not call');}});assert.equal(await client.warmConnection(),false);
});
test('a warm HTTP rejection remains a failed warm without changing quote availability',async()=>{
 const client=createServiceClient({base:'https://example.test/api/swap',fetchImpl:async()=>({ok:false,text:async()=>'busy'})});
 assert.equal(await client.warmConnection(),false);assert.equal(client.available(),true);
});
