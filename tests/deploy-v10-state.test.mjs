// Browser-independent controller tests; all DOM, wallet and RPC interactions are local mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ethers} from 'ethers';
const base=JSON.parse(readFileSync(new URL('../contracts/fstsi-v10/deployment/mainnet-manifest.json',import.meta.url),'utf8'));
let sequence=0;
async function fixture({storageMap=new Map(),generatedAt=base.generatedAt}={}){
 const elements=new Map();
 const element=()=>({textContent:'',disabled:false,hidden:false,value:'',children:[],replaceChildren(...c){this.children=c;},append(...c){this.children.push(...c);}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const f={elements,storageMap,sends:[],nonce:'0x4',chain:'0x38',sendError:null,lockDepth:0,lockEntries:0,hash:'0x'+'11'.repeat(32)};
 globalThis.ethers=ethers;globalThis.document={getElementById:get,createElement:element};
 globalThis.localStorage={getItem:k=>storageMap.get(k)||null,setItem:(k,v)=>{assert.ok(f.lockDepth>0,"deployment state writes must hold the shared lock");storageMap.set(k,v);},removeItem:k=>storageMap.delete(k)};
 Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_,fn)=>{f.lockEntries++;f.lockDepth++;try{return await fn();}finally{f.lockDepth--;}}}},configurable:true});
 const block={number:'0x123',hash:'0x'+'22'.repeat(32)};
 const rpc=async(method)=>{
  if(method==='eth_getBlockByNumber')return block;
  if(method==='eth_estimateGas')return '0x600000';
  if(method==='eth_gasPrice')return '0x3b9aca00';
  if(method==='eth_getBalance')return '0x3635c9adc5dea00000';
  if(method==='eth_getTransactionCount')return f.nonce;
  throw Error(method);
 };
 globalThis.window={ethereum:{on(){},request:async({method,params})=>{
  if(method==='eth_requestAccounts'||method==='eth_accounts')return[base.owner];
  if(method==='eth_chainId')return f.chain;
  if(method==='eth_sendTransaction'){f.sends.push(params[0]);if(f.sendError)throw f.sendError;return f.hash;}
  return rpc(method);
 }}};
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('mainnet-manifest.json'))return{ok:true,json:async()=>({...base,generatedAt,readyForSigning:true})};
  const body=JSON.parse(options.body);return{ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:await rpc(body.method)})};
 };
 await import('../deploy-v10.mjs?unit='+ ++sequence);
 f.connect=()=>get('connect').onclick();f.sign=()=>get('sign').onclick({isTrusted:true});f.refresh=()=>get('refresh').onclick();f.status=()=>get('status').textContent;
 return f;
}
test('deployment preview fixes chain and pending nonce in the sent request',async()=>{
 const f=await fixture();await f.connect();assert.equal(f.elements.get('sign').disabled,false);await f.sign();assert.equal(f.sends.length,1);assert.equal(f.sends[0].chainId,'0x38');assert.equal(f.sends[0].nonce,'0x4');assert.equal(f.sends[0].value,'0x0');assert.ok(f.lockEntries>=2);
});
test('unknown deployment send remains locked across refresh and regenerated manifest timestamp',async()=>{
 const f=await fixture();await f.connect();f.sendError=Error('transport timeout');await f.sign();assert.equal(f.sends.length,1);await f.refresh();assert.match(f.status(),/待核验/);assert.equal(f.elements.get('sign').disabled,true);
 const reopened=await fixture({storageMap:f.storageMap,generatedAt:'different build timestamp'});await reopened.connect();assert.match(reopened.status(),/待核验/);await reopened.sign();assert.equal(reopened.sends.length,0);
});
test('deployment wallet rejection clears only the unsent intent',async()=>{
 const f=await fixture();await f.connect();f.sendError=Object.assign(Error('rejected'),{code:4001});await f.sign();await f.refresh();assert.equal(f.elements.get('sign').disabled,false);const stored=JSON.parse([...f.storageMap.values()][0]);assert.equal(stored.intent,undefined);
});
test('deployment nonce change requires a fresh preview',async()=>{
 const f=await fixture();await f.connect();f.nonce='0x5';await f.sign();assert.equal(f.sends.length,0);assert.match(f.status(),/nonce/);
});
test('deployment rejects a wallet chain change before sending',async()=>{
 const f=await fixture();await f.connect();f.chain='0x1';await f.sign();assert.equal(f.sends.length,0);assert.match(f.status(),/BSC/);
});
