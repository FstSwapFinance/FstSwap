import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {sendWalletOnce,recoverWalletIntent} from '../swap-send.mjs';
const account='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32),blockHash='0x'+'44'.repeat(32);
function fixture(){
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const f={map,storage,sends:[],chain:'0x38',nonce:'0x7',blockHash,code:'0x1234',sendError:null,receipt:null,tx:null};
 f.read=async({method})=>method==='eth_getTransactionByHash'?f.tx:method==='eth_getTransactionReceipt'?f.receipt:{number:'0x1',hash:blockHash};
 f.provider={request:async({method,params})=>{
  if(method==='eth_chainId')return f.chain;if(method==='eth_accounts')return[account];if(method==='eth_getCode')return f.code;
  if(method==='eth_getBlockByNumber')return{number:'0x1',hash:f.blockHash};
  if(method==='eth_getTransactionCount'){assert.equal(params[1],'pending');return f.nonce;}
  if(method==='eth_sendTransaction'){f.sends.push(params[0]);if(f.sendError)throw f.sendError;return hash;}throw Error(method);
 }};
 f.send=()=>sendWalletOnce({provider:f.provider,read:f.read,transaction:{from:account,to:target,data:'0x1234',value:'0x0'},gasLimit:21000n,gasPrice:100n,storage,locks:{request:(_,fn)=>fn()}});
 f.confirm=()=>{f.tx={...f.sends[0],hash,input:f.sends[0].data,blockHash};f.receipt={transactionHash:hash,from:account,to:target,blockHash,blockNumber:'0x1',status:'0x1'};};
 return f;
}
test('wallet send freezes pending nonce and BSC chain, sends once',async()=>{const f=fixture();const r=await f.send();assert.equal(r.hash,hash);assert.equal(f.sends.length,1);assert.equal(r.transaction.nonce,'0x7');assert.equal(r.transaction.chainId,'0x38');});
test('unknown broadcast result persists across attempts and never falls back',async()=>{const f=fixture();f.sendError=Error('transport timeout after submission');await assert.rejects(f.send(),{code:'TX_UNKNOWN'});f.sendError=null;await assert.rejects(f.send(),{code:'TX_UNKNOWN'});assert.equal(f.sends.length,1);assert.equal(f.map.size,1);});
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
 const f=fixture();f.sendError=Object.assign(Error('RPC failed https://example.org/private-key-path'),{code:-32603});await assert.rejects(f.send(),e=>e.pendingIntent?.walletError?.code===-32603&&!e.message.includes('private-key-path'));assert.equal(f.map.size,1);
});
test('explicitly unsent recovery only clears an unused nonce and never broadcasts',async()=>{
 const {releaseUnsentWalletIntent}=await import('../swap-send.mjs');const f=fixture();f.sendError=Error('Unknown');await assert.rejects(f.send());
 const provider={request:async({method})=>method==='eth_chainId'?'0x38':method==='eth_accounts'?[account]:'0x7'};
 const read=async()=> '0x7';const opts={provider,read,account,expectedIntent:JSON.parse([...f.map.values()][0]),storage:f.storage,locks:{request:(_,fn)=>fn()}};
 await assert.rejects(()=>releaseUnsentWalletIntent(opts),{code:'CONFIRM_UNSENT'});
 await assert.rejects(()=>releaseUnsentWalletIntent({...opts,confirmedUnsent:true,read:async()=> '0x8'}),{code:'NONCE_CHANGED'});
 await releaseUnsentWalletIntent({...opts,confirmedUnsent:true});assert.equal(f.storage.getItem('fstswap-wallet-intent-v1:56:'+account),null);assert.equal(f.sends.length,1);assert.ok([...f.map.keys()].some(k=>k.includes('archive')));
});
test('a stale unsent dialog cannot release a successor intent with the same nonce',async()=>{
 const {releaseUnsentWalletIntent}=await import('../swap-send.mjs');const f=fixture();f.sendError=Error('Unknown');await assert.rejects(f.send());
 const storageKey=[...f.map.keys()][0],expectedIntent=JSON.parse(f.storage.getItem(storageKey));
 const successor={...expectedIntent,createdAt:expectedIntent.createdAt+1,transaction:{...expectedIntent.transaction,value:'0x1'}};
 f.storage.setItem(storageKey,JSON.stringify(successor));
 await assert.rejects(releaseUnsentWalletIntent({provider:f.provider,read:async()=> '0x7',account,expectedIntent,confirmedUnsent:true,storage:f.storage,locks:{request:(_,fn)=>fn()}}),{code:'INTENT_CHANGED'});
 assert.deepEqual(JSON.parse(f.storage.getItem(storageKey)),successor);assert.equal(f.sends.length,1);
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
