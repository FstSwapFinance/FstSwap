import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../server/fstswap-service.mjs';
const nonce='0123456789abcdef0123456789abcdef';
async function fixture(t){
 let now=100000,received;
 const engine={quote:async(body,options)=>{received=options;now+=250;return{ok:true};},balances:async()=>({ok:true})};
 const server=createApi({engine,pool:{health:()=>({providers:[]})},clock:()=>now});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 return{base:'http://127.0.0.1:'+server.address().port,received:()=>received};
}
test('successful read responses bind millisecond server time to the exact transport nonce and never enable shared caching',async t=>{
 const f=await fixture(t),response=await fetch(f.base+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json','x-fstswap-time-nonce':nonce},body:'{}'});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-fstswap-time-nonce'),nonce);
 assert.equal(response.headers.get('x-fstswap-server-time'),'100250');
 assert.match(response.headers.get('cache-control'),/no-store/);
 assert.match(response.headers.get('server-timing'),/total;dur=\d/);
});
test('cross-origin preflight permits time and fresh transport headers and exposes only nonsecret time metadata',async t=>{
 const f=await fixture(t),origin='http://127.0.0.1:8124';
 const response=await fetch(f.base+'/api/swap/balances',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type,x-fstswap-time-nonce,x-fstswap-fresh'}});
 assert.equal(response.status,204);
 for(const h of ['content-type','x-fstswap-time-nonce','x-fstswap-fresh'])assert.ok(response.headers.get('access-control-allow-headers').toLowerCase().includes(h));
 for(const h of ['x-fstswap-time-nonce','x-fstswap-server-time','server-timing'])assert.ok(response.headers.get('access-control-expose-headers').toLowerCase().includes(h));
});
test('invalid transport nonce is never reflected as a valid server clock sample',async t=>{
 const f=await fixture(t);
 for(const bad of ['abc','A'.repeat(32),'a'.repeat(33)]){
  const response=await fetch(f.base+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json','x-fstswap-time-nonce':bad},body:'{}'});
  assert.equal(response.headers.get('x-fstswap-time-nonce'),null);assert.equal(response.headers.get('x-fstswap-server-time'),null);
 }
});
test('fresh transport intent reaches the engine independently of quote JSON',async t=>{
 const f=await fixture(t);
 await fetch(f.base+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json','x-fstswap-fresh':'1'},body:'{}'});
 assert.equal(f.received().fresh,true);
});
