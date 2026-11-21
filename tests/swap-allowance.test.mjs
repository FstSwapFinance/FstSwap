import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createAllowanceReader} from '../src/swap-allowance.mjs';

globalThis.ethers=ethers;
const codec=new ethers.Interface(['function allowance(address,address) view returns(uint256)']);
const account='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),spender='0x'+'33'.repeat(20),other='0x'+'ab'.repeat(20);
const identity={chainId:56,account,token,spender};
const encode=value=>codec.encodeFunctionResult('allowance',[value]);
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return{promise,resolve,reject};};

test('last consumer cancellation reaches the physical read, and fresh reads carry foreground intent',async()=>{
 const jobs=[],seen=[];
 const reader=createAllowanceReader((payload,options)=>{seen.push(options);const job=deferred();jobs.push(job);return job.promise;});
 const controller=new AbortController(),pending=reader.read(identity,{signal:controller.signal});
 assert.equal(typeof seen[0]?.signal?.aborted,'boolean');assert.equal(seen[0].fresh,false);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(seen[0].signal.aborted,true);
 jobs[0].resolve(encode(99n));
 const fresh=reader.read(identity,{fresh:true});assert.equal(seen[1].fresh,true);jobs[1].resolve(encode(100n));assert.equal(await fresh,100n);
});

test('allowance reads only eth_call with the exact owner and spender and returns an exact integer',async()=>{
 const requests=[],reader=createAllowanceReader(async payload=>{requests.push(payload);return encode(123456789123456789123n);});
 assert.equal(await reader.read(identity),123456789123456789123n);
 assert.equal(requests.length,1);assert.equal(requests[0].method,'eth_call');assert.equal(requests[0].params[0].to,token);assert.equal(requests[0].params[1],'latest');
 assert.deepEqual(Array.from(codec.decodeFunctionData('allowance',requests[0].params[0].data)),[account,spender]);
});

test('latest reads share an in-flight request and expire five seconds after completion without sliding on hits',async()=>{
 const pending=deferred();let now=1000,attempts=0;
 const reader=createAllowanceReader(async()=>++attempts===1?pending.promise:encode(25n),{clock:()=>now});
 const first=reader.read(identity),second=reader.read(identity);await Promise.resolve();assert.equal(attempts,1);
 now=5000;pending.resolve(encode(17n));assert.equal(await first,17n);assert.equal(await second,17n);
 now=9999;assert.equal(await reader.read(identity),17n);assert.equal(attempts,1);
 now=10000;assert.equal(await reader.read(identity),25n);assert.equal(attempts,2);
});

test('allowance cache isolates account, token and spender while normalizing address case',async()=>{
 let attempts=0;const reader=createAllowanceReader(async()=>encode(BigInt(++attempts)));
 assert.equal(await reader.read({...identity,account:other}),1n);
 assert.equal(await reader.read({...identity,account:other.toUpperCase().replace('0X','0x')}),1n);
 assert.equal(await reader.read({...identity,token:other}),2n);
 assert.equal(await reader.read({...identity,spender:other}),3n);
 assert.equal(await reader.read(identity),4n);assert.equal(attempts,4);
});

test('fresh reads join the current pending chain read while bypassing completed display data',async()=>{
 const live=deferred();let attempts=0;
 const reader=createAllowanceReader(async()=>++attempts===1?live.promise:encode(4n));
 const before=reader.read(identity),after=reader.read(identity,{fresh:true});await Promise.resolve();assert.equal(attempts,1);
 live.resolve(encode(100n));assert.equal(await before,100n);assert.equal(await after,100n);
 assert.equal(await reader.read(identity),100n);assert.equal(attempts,1);
 assert.equal(await reader.read(identity,{fresh:true}),4n);assert.equal(attempts,2);
 assert.equal(await reader.read(identity),4n);
});

test('explicit block reads always fetch and never populate the latest cache',async()=>{
 const tags=[];let amount=1n;
 const reader=createAllowanceReader(async payload=>{tags.push(payload.params[1]);return encode(amount++);});
 assert.equal(await reader.read(identity),1n);
 assert.equal(await reader.read(identity,{blockTag:'0x123'}),2n);
 assert.equal(await reader.read(identity,{blockTag:'0x123'}),3n);
 assert.equal(await reader.read(identity),4n);
 assert.equal(await reader.read(identity,{blockTag:'pending'}),5n);
 assert.equal(await reader.read(identity),6n);
 assert.deepEqual(tags,['latest','0x123','0x123','latest','pending','latest']);
});

test('an explicit block read prevents an older latest request from warming the cache',async()=>{
 const old=deferred();let attempts=0;
 const reader=createAllowanceReader(async()=>++attempts===1?old.promise:encode(9n));
 const before=reader.read(identity);assert.equal(await reader.read(identity,{blockTag:'0x123'}),9n);
 old.resolve(encode(100n));assert.equal(await before,100n);
 assert.equal(await reader.read(identity),9n);assert.equal(attempts,3);
});

test('invalidating the reader prevents a late request from replacing a new allowance',async()=>{
 const old=deferred();let attempts=0;
 const reader=createAllowanceReader(async()=>++attempts===1?old.promise:encode(3n));
 const before=reader.read(identity),rejected=assert.rejects(before,{name:'AbortError'});await Promise.resolve();reader.invalidate();
 assert.equal(await reader.read(identity),3n);old.resolve(encode(100n));await rejected;
 assert.equal(await reader.read(identity),3n);assert.equal(attempts,2);
});

test('canceling one subscriber rejects only that caller and preserves the shared result',async()=>{
 const pending=deferred(),controller=new AbortController();let attempts=0;
 const reader=createAllowanceReader(async()=>{attempts++;return pending.promise;});
 const canceled=reader.read(identity,{signal:controller.signal}),active=reader.read(identity);
 const rejected=assert.rejects(canceled,{name:'AbortError'});controller.abort(Error('superseded'));await rejected;
 pending.resolve(encode(8n));assert.equal(await active,8n);assert.equal(await reader.read(identity),8n);assert.equal(attempts,1);
});

test('an abandoned read never warms the cache and cannot replace its replacement',async()=>{
 const old=deferred(),controller=new AbortController();let attempts=0;
 const reader=createAllowanceReader(async()=>++attempts===1?old.promise:encode(6n));
 const canceled=reader.read(identity,{signal:controller.signal});const rejected=assert.rejects(canceled,{name:'AbortError'});await Promise.resolve();
 controller.abort();await rejected;
 assert.equal(await reader.read(identity),6n);old.resolve(encode(100n));await Promise.resolve();await Promise.resolve();
 assert.equal(await reader.read(identity),6n);assert.equal(attempts,2);
});

test('a late failure from an abandoned read cannot poison the next request',async()=>{
 const old=deferred(),controller=new AbortController();let attempts=0;
 const reader=createAllowanceReader(async()=>++attempts===1?old.promise:encode(7n));
 const canceled=reader.read(identity,{signal:controller.signal});const rejected=assert.rejects(canceled,{name:'AbortError'});await Promise.resolve();
 controller.abort();await rejected;old.reject(Error('offline'));await Promise.resolve();await Promise.resolve();
 assert.equal(await reader.read(identity),7n);assert.equal(attempts,2);
});

test('pre-aborted allowance subscribers make no request or cache change',async()=>{
 let attempts=0;const controller=new AbortController();controller.abort({code:'OFFLINE'});
 const reader=createAllowanceReader(async()=>{attempts++;return encode(12n);});
 await assert.rejects(reader.read(identity,{signal:controller.signal}),{name:'AbortError'});assert.equal(attempts,0);
 assert.equal(await reader.read(identity),12n);await assert.rejects(reader.read(identity,{signal:controller.signal}),{name:'AbortError'});assert.equal(attempts,1);
});

test('invalid identities and block tags never invoke the RPC request',async()=>{
 let attempts=0;const reader=createAllowanceReader(async()=>{attempts++;return encode(1n);});
 for(const patch of [{chainId:97},{chainId:'56'},{account:'bad'},{token:null},{spender:'0x'+'00'.repeat(20)},{account:'0x'+'00'.repeat(20)}])await assert.rejects(reader.read({...identity,...patch}));
 for(const blockTag of ['tomorrow','0xzz',-1,null])await assert.rejects(reader.read(identity,{blockTag}));
 for(const options of [{signal:{}},{signal:{aborted:false}},{fresh:'yes'}])await assert.rejects(reader.read(identity,options));
 assert.equal(attempts,0);
});

test('malformed allowance results and request failures reject without being cached',async()=>{
 for(const invalid of ['0x','0x01','not-hex',null,Error('offline')]){
  let attempts=0;const reader=createAllowanceReader(async()=>{if(++attempts>1)return encode(2n);if(invalid instanceof Error)throw invalid;return invalid;});
  await assert.rejects(reader.read(identity));assert.equal(await reader.read(identity),2n);assert.equal(attempts,2);
 }
});

test('allowance reader retains at most 32 identities',async()=>{
 let attempts=0;const reader=createAllowanceReader(async()=>{attempts++;return encode(1n);});
 const identities=Array.from({length:33},(_,i)=>({...identity,token:'0x'+(i+1).toString(16).padStart(40,'0')}));
 for(const key of identities)await reader.read(key);assert.equal(attempts,33);
 await reader.read(identities[32]);assert.equal(attempts,33);
 await reader.read(identities[0]);assert.equal(attempts,34);
});
test('fresh transaction allowance bypasses a still-valid five-second display cache',async()=>{
 let now=1000,calls=0;const reader=createAllowanceReader(async()=>encode(BigInt(++calls)),{clock:()=>now});
 assert.equal(await reader.read(identity),1n);now=4500;assert.equal(await reader.read(identity),1n);
 assert.equal(await reader.read(identity,{fresh:true}),2n);assert.equal(calls,2);assert.equal(await reader.read(identity),2n);
});
test('invalidation cancels every pending allowance subscriber before late provider completion',async()=>{
 const old=deferred(),seen=[];const reader=createAllowanceReader(async(_payload,options)=>{seen.push(options.signal);return old.promise;});
 const first=reader.read(identity),second=reader.read(identity),rejected=Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
 reader.invalidate();let done=false;rejected.then(()=>done=true);await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(done,true);assert.equal(seen[0].aborted,true);}finally{old.resolve(encode(100n));await rejected;}
});
test('invalidating a shared fresh read rejects every subscriber before a replacement can populate cache',async()=>{
 const jobs=[deferred(),deferred()];let calls=0;const reader=createAllowanceReader(async()=>calls<2?jobs[calls++].promise:encode(3n));
 const old=reader.read(identity),rejectedOld=assert.rejects(old,{name:'AbortError'}),fresh=reader.read(identity,{fresh:true}),rejectedFresh=assert.rejects(fresh,{name:'AbortError'});
 assert.equal(calls,1);reader.invalidate();const replacement=reader.read(identity);assert.equal(calls,2);
 jobs[1].resolve(encode(3n));assert.equal(await replacement,3n);jobs[0].resolve(encode(100n));await Promise.all([rejectedOld,rejectedFresh]);
 assert.equal(await reader.read(identity),3n);
});
test('invalidation or cancellation before a completed allowance hit is delivered rejects it',async()=>{
 const reader=createAllowanceReader(async()=>encode(7n));await reader.read(identity);
 const old=reader.read(identity),rejected=assert.rejects(old,{name:'AbortError'});reader.invalidate();await rejected;
 await reader.read(identity);const controller=new AbortController(),canceled=reader.read(identity,{signal:controller.signal}),aborted=assert.rejects(canceled,{name:'AbortError'});controller.abort();await aborted;
});
