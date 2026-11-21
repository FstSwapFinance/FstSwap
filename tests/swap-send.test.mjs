import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {sendWalletOnce,recoverWalletIntent} from '../src/swap-send.mjs';
const account='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32),blockHash='0x'+'44'.repeat(32);
function fixture(){
 const map=new Map(),storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const f={map,storage,sends:[],chain:'0x38',nonce:'0x7',blockHash,code:'0x1234',sendError:null,receipt:null,tx:null};
 f.read=async({method})=>method==='eth_getTransactionByHash'?f.tx:method==='eth_getTransactionReceipt'?f.receipt:{number:'0x1',hash:blockHash};
 f.provider={request:async({method,params})=>{
  if(method==='eth_chainId')return f.chain;if(method==='eth_accounts')return[account];if(method==='eth_getCode')return f.code;
  if(method==='eth_getBlockByNumber')return{number:'0x1',hash:f.blockHash};
  if(method==='eth_getTransactionCount'){assert.equal(params[1],'pending');return f.nonce;}
  if(method==='eth_sendTransaction'){f.sends.push(params[0]);if(f.sendError)throw f.sendError;return hash;}throw Error(method);
 }};
 f.send=(options={})=>sendWalletOnce({provider:f.provider,read:f.read,transaction:{from:account,to:target,data:'0x1234',value:'0x0'},gasLimit:21000n,gasPrice:100n,storage,locks:{request:(_,options,fn)=>(fn||options)({name:'test'})},...options});
 f.confirm=()=>{f.tx={...f.sends[0],hash,input:f.sends[0].data,blockHash};f.receipt={transactionHash:hash,from:account,to:target,blockHash,blockNumber:'0x1',status:'0x1'};};
 return f;
}
test('wallet send freezes pending nonce and BSC chain, sends once',async()=>{const f=fixture();const r=await f.send();assert.equal(r.hash,hash);assert.equal(f.sends.length,1);assert.equal(r.transaction.nonce,'0x7');assert.equal(r.transaction.chainId,'0x38');});
test('an unknown wallet response restores the UI without automatically resending',async()=>{
 const f=fixture();f.sendError=Error('transport timeout after submission');await assert.rejects(f.send(),e=>e.code==='WALLET_RESPONSE_UNKNOWN'&&!e.pendingIntent);
 assert.equal(f.sends.length,1);assert.equal(f.storage.getItem('fstswap-wallet-intent-v1:56:'+account),null);
 assert.ok([...f.map.keys()].some(k=>k.includes(':archive:')));
 f.sendError=null;f.nonce='0x8';await f.send();assert.equal(f.sends.length,2);assert.equal(f.sends[1].nonce,'0x8');
});
test('explicit wallet rejection releases unsent intent',async()=>{const f=fixture();f.sendError=Object.assign(Error('rejected'),{code:4001});await assert.rejects(f.send(),{code:4001});assert.equal(f.map.size,0);});
test('wrong chain, empty target or fork divergence cannot send',async()=>{for(const change of [{chain:'0x1'},{code:'0x'},{blockHash:'0x'+'55'.repeat(32)}]){const f=Object.assign(fixture(),change);await assert.rejects(f.send());assert.equal(f.sends.length,0);assert.equal(f.map.size,0);}});
test('canonical matching receipt resolves intent; wrong nonce stays locked',async()=>{const f=fixture();await f.send();f.confirm();f.tx.nonce='0x8';await assert.rejects(recoverWalletIntent({read:f.read,account,hash,storage:f.storage,locks:{request:(_,fn)=>fn()}}),{code:'INVALID_RECEIPT'});assert.equal(f.map.size,1);f.tx.nonce='0x7';const r=await recoverWalletIntent({read:f.read,account,hash,storage:f.storage,locks:{request:(_,fn)=>fn()}});assert.equal(r.reverted,false);assert.equal(f.map.size,0);});
test('pending hash prevents a new send; confirmed revert releases intent',async()=>{const f=fixture();await f.send();await assert.rejects(f.send(),{code:'TX_PENDING'});assert.equal(f.sends.length,1);f.confirm();f.receipt.status='0x0';assert.equal((await recoverWalletIntent({read:f.read,account,hash,storage:f.storage,locks:{request:(_,fn)=>fn()}})).reverted,true);assert.equal(f.map.size,0);});

test('stale recovery cannot erase a successor intent',async()=>{
 const f=fixture();await f.send();f.confirm();let release;const gate=new Promise(r=>release=r);const read=f.read;
 const delayed=async p=>{if(p.method==='eth_getBlockByNumber')await gate;return read(p);};
 const recovery=recoverWalletIntent({read:delayed,account,hash,storage:f.storage,locks:{request:(_,fn)=>fn()}});
 await new Promise(r=>setImmediate(r));const storageKey=[...f.map.keys()][0];const successor=JSON.stringify({transaction:{...f.sends[0],nonce:'0x8'}});f.storage.setItem(storageKey,successor);release();
 await assert.rejects(recovery,{code:'INTENT_CHANGED'});assert.equal(f.storage.getItem(storageKey),successor);
});
test('definite pre-submission wallet errors release the intent and preserve the cause',async()=>{
 for(const code of [-32602,-32601,4100,4200,'4001']){const f=fixture();f.sendError=Object.assign(Error('Invalid parameters'),{code});await assert.rejects(f.send(),e=>Number(e.code)===Number(code)&&!e.pendingIntent);assert.equal(f.map.size,0);}
});
test('unknown errors retain a bounded diagnostic without exposing RPC credentials',async()=>{
 const f=fixture();f.sendError=Object.assign(Error('RPC failed https://example.org/private-key-path'),{code:-32603});await assert.rejects(f.send(),e=>e.code==='WALLET_RESPONSE_UNKNOWN'&&!e.pendingIntent&&!e.message.includes('private-key-path'));assert.equal(f.map.size,1);
});
test('legacy records without a hash no longer block a user-initiated transaction',async()=>{
 const f=fixture(),storageKey='fstswap-wallet-intent-v1:56:'+account;
 f.storage.setItem(storageKey,JSON.stringify({transaction:{from:account,to:target,nonce:'0x6'},createdAt:1}));
 await f.send();assert.equal(f.sends.length,1);assert.equal(JSON.parse(f.storage.getItem(storageKey)).hash,hash);
});
test('an open wallet request is not queued again',async()=>{
 const f=fixture();await assert.rejects(sendWalletOnce({provider:f.provider,read:f.read,transaction:{from:account,to:target},storage:f.storage,locks:{request:(_,options,fn)=>{assert.equal(options.ifAvailable,true);return fn(null);}}}),{code:'WALLET_BUSY'});
 assert.equal(f.sends.length,0);
});
test('a wallet-confirmed lower ERC20 approval amount settles from the canonical Approval event',async()=>{
 const f=fixture();await f.send();f.confirm();const i=new ethers.Interface(['function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
 const spender='0x'+'66'.repeat(20),requested=i.encodeFunctionData('approve',[spender,ethers.MaxUint256]);
 const storageKey=[...f.map.keys()][0],intent=JSON.parse(f.storage.getItem(storageKey));intent.transaction.data=requested;f.storage.setItem(storageKey,JSON.stringify(intent));
 f.tx.input=i.encodeFunctionData('approve',[spender,10n**18n]);const event=i.encodeEventLog(i.getEvent('Approval'),[account,spender,10n**18n]);f.receipt.logs=[{address:target,...event}];
 const opts={read:f.read,account,storage:f.storage,locks:{request:(_,fn)=>fn()}};
 // Omitted hash uses the persisted wallet result; no copy/paste is required.
 await recoverWalletIntent(opts);assert.equal(f.map.size,0);assert.equal(f.sends.length,1);
});
test('approval recovery rejects changed spender, increased amount and missing approval evidence',async()=>{
 const i=new ethers.Interface(['function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)']);const spender='0x'+'66'.repeat(20);
 for(const kind of ['spender','amount','event']){
  const f=fixture();await f.send();f.confirm();const storageKey=[...f.map.keys()][0],intent=JSON.parse(f.storage.getItem(storageKey));intent.transaction.data=i.encodeFunctionData('approve',[spender,100n]);f.storage.setItem(storageKey,JSON.stringify(intent));
  const actualSpender=kind==='spender'?target:spender,actualAmount=kind==='amount'?101n:50n;f.tx.input=i.encodeFunctionData('approve',[actualSpender,actualAmount]);const event=i.encodeEventLog(i.getEvent('Approval'),[account,actualSpender,actualAmount]);f.receipt.logs=kind==='event'?[]:[{address:target,...event}];
  await assert.rejects(recoverWalletIntent({read:f.read,account,hash,storage:f.storage,locks:{request:(_,fn)=>fn()}}),{code:'INVALID_RECEIPT'});assert.equal(f.map.size,1);
 }
});

test('wallet timeouts restore the caller and preserve late hashes without resending',async()=>{
 const f=fixture();let reply;const original=f.provider.request;
 f.provider.request=p=>p.method==='eth_sendTransaction'?new Promise(r=>{f.sends.push(p.params[0]);reply=r;}):original(p);
 await assert.rejects(f.send({walletTimeoutMs:10}),{code:'WALLET_RESPONSE_UNKNOWN'});
 assert.equal(f.storage.getItem('fstswap-wallet-intent-v1:56:'+account),null);assert.equal(f.sends.length,1);
 reply(hash);await new Promise(r=>setImmediate(r));
 assert.ok([...f.map.values()].some(v=>JSON.parse(v).hash===hash));assert.equal(f.sends.length,1);
});
test('a hung wallet read and a changed selection cannot reach a send',async()=>{
 const f=fixture(),read=f.provider.request;
 f.provider.request=p=>p.method==='eth_getCode'?new Promise(()=>{}):read(p);
 await assert.rejects(f.send({walletReadTimeoutMs:10}),{code:'WALLET_TIMEOUT'});assert.equal(f.sends.length,0);
 const other=fixture();await assert.rejects(other.send({beforeSubmit:()=>false}),{code:'REQUEST_CHANGED'});assert.equal(other.sends.length,0);
});

test('late known hashes still pending prevent another wallet send',async()=>{
 const f=fixture();let reply;const original=f.provider.request;
 f.provider.request=p=>p.method==='eth_sendTransaction'?new Promise(r=>{f.sends.push(p.params[0]);reply=r;}):original(p);
 await assert.rejects(f.send({walletTimeoutMs:10}));reply(hash);await new Promise(r=>setImmediate(r));
 await assert.rejects(f.send(),{code:'TX_PENDING'});assert.equal(f.sends.length,1);
 f.confirm();f.provider.request=original;await f.send();assert.equal(f.sends.length,2);
});
test('injected wallets receive only hex strings and no SDK fields',async()=>{
 const {walletTransaction}=await import('../src/swap-send.mjs');
 const tx=walletTransaction({from:account,to:target,data:'0x1234',value:1000000000000000n,nonce:7,gas:21000,gasPrice:3n,chainId:56,gasLimit:21000,custom:{}});
 assert.deepEqual(Object.keys(tx),['from','to','data','value','nonce','gas','gasPrice','chainId']);
 for(const e of Object.values(tx))assert.equal(e.startsWith('0x'),true);
 const f=fixture();f.nonce=7;await f.send();assert.equal(f.sends[0].nonce,'0x7');assert.equal(f.sends[0].chainId,'0x38');
});

test('a late hash arriving during preflight stops the next send',async()=>{
 const f=fixture();let reply,unblock;const original=f.provider.request;
 f.provider.request=p=>p.method==='eth_sendTransaction'?new Promise(r=>{f.sends.push(p.params[0]);reply=r;}):original(p);
 await assert.rejects(f.send({walletTimeoutMs:10}));
 f.provider.request=p=>p.method==='eth_getCode'?new Promise(r=>unblock=()=>r('0x1234')):original(p);
 const next=f.send();await new Promise(r=>setImmediate(r));reply(hash);await new Promise(r=>setImmediate(r));unblock();
 await assert.rejects(next,{code:'TX_PENDING'});assert.equal(f.sends.length,1);
});
