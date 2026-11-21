import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../server/fstswap-service.mjs';

const N1='01'.repeat(16),N2='ab'.repeat(16);
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
async function api(t,engine){
 let now=10000;const server=createApi({engine,pool:{health:()=>({providers:[]})},clock:()=>now});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 return{setTime:value=>now=value,post:(action,nonce,body={},extra={})=>fetch(base+'/api/swap/'+action,{method:'POST',headers:{'content-type':'application/json',...(nonce==null?{}:{'x-fstswap-time-nonce':nonce}),...extra},body:JSON.stringify(body)})};
}
test('concurrent quote and balance replies preserve each request nonce when they finish out of order',async t=>{
 const ready=deferred(),jobs=[];
 const read=(body,options)=>{const job={body,options,gate:deferred()};jobs.push(job);if(jobs.length===2)ready.resolve();return job.gate.promise;};
 const f=await api(t,{quote:read,balances:read}),one=f.post('quote',N1,{id:'quote'}),two=f.post('balances',N2,{id:'balances'});await ready.promise;
 f.setTime(10200);jobs.find(job=>job.body.id==='balances').gate.resolve({readAt:1});const balance=await two;
 f.setTime(10500);jobs.find(job=>job.body.id==='quote').gate.resolve({quotedAt:2});const quote=await one;
 assert.equal(balance.headers.get('x-fstswap-time-nonce'),N2);assert.equal(balance.headers.get('x-fstswap-server-time'),'10200');
 assert.equal(quote.headers.get('x-fstswap-time-nonce'),N1);assert.equal(quote.headers.get('x-fstswap-server-time'),'10500');
 for(const response of[quote,balance]){assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);}
});
test('time proof uses response time rather than an earlier cached DTO timestamp and each request keeps a new binding',async t=>{
 const dto={quotedAt:1000,poolCheckedAt:999,expiresAt:15999},f=await api(t,{quote:async()=>dto});
 const first=await f.post('quote',N1);f.setTime(11000);const second=await f.post('quote',N2);
 assert.deepEqual(await first.json(),dto);assert.deepEqual(await second.json(),dto);
 assert.equal(first.headers.get('x-fstswap-server-time'),'10000');assert.equal(second.headers.get('x-fstswap-server-time'),'11000');
 assert.equal(first.headers.get('x-fstswap-time-nonce'),N1);assert.equal(second.headers.get('x-fstswap-time-nonce'),N2);
});
test('errors and incomplete or combined nonce fields never emit a valid clock proof',async t=>{
 const f=await api(t,{quote:async body=>{if(body.error)throw Object.assign(Error('no route'),{code:'NO_ROUTE'});return{ok:true};}});
 for(const nonce of[undefined,'a'.repeat(31),'A'.repeat(32),N1+', '+N2,'0x'+N1]){
  const response=await f.post('quote',nonce);assert.equal(response.status,200);assert.equal(response.headers.get('x-fstswap-time-nonce'),null);assert.equal(response.headers.get('x-fstswap-server-time'),null);
 }
 const error=await f.post('quote',N1,{error:true});assert.equal(error.status,422);assert.deepEqual(await error.json(),{error:'NO_ROUTE'});assert.equal(error.headers.get('x-fstswap-time-nonce'),null);assert.equal(error.headers.get('x-fstswap-server-time'),null);
});
test('only the exact fresh transport flag reaches the engine and quote JSON is kept separate',async t=>{
 const calls=[],f=await api(t,{quote:async(body,options)=>{calls.push({body,options});return{ok:true};}});
 for(const flag of[undefined,'0','true','1, 1','1'])await f.post('quote',N1,{chainId:56},{...(flag==null?{}:{'x-fstswap-fresh':flag})});
 assert.deepEqual(calls.map(call=>call.options.fresh),[false,false,false,false,true]);
 for(const call of calls){assert.deepEqual(call.body,{chainId:56});assert.equal(typeof call.options.signal.addEventListener,'function');}
});
test('unrecognized origins do not obtain cross-origin permission to read the time proof',async t=>{
 const f=await api(t,{quote:async()=>({ok:true})});
 const denied=await f.post('quote',N1,{}, {origin:'https://unrecognized.invalid'});
 assert.equal(denied.headers.get('access-control-allow-origin'),null);assert.equal(denied.headers.get('access-control-expose-headers'),null);
 const allowed=await f.post('quote',N2,{}, {origin:'https://fstswap.pro'});
 assert.equal(allowed.headers.get('access-control-allow-origin'),'https://fstswap.pro');
 for(const header of['x-fstswap-time-nonce','x-fstswap-server-time','server-timing'])assert.ok(allowed.headers.get('access-control-expose-headers').toLowerCase().split(/,\s*/).includes(header));
});
