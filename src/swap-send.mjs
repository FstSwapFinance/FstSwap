import { matchesWalletExecution } from "./swap-receipt.mjs?v=mainnet-20261110-17";
// Track submitted transactions; only a fresh user action may request another wallet transaction.
const prefix='fstswap-wallet-intent-v1:56:';
const fail=(code,message,intent)=>Object.assign(new Error(message),{code,pendingIntent:intent});
const key=account=>prefix+account.toLowerCase();
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
function walletDeadline(promise,ms) {
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('WALLET_TIMEOUT','钱包响应超时')),ms);})]).finally(()=>clearTimeout(timer));
}
export function walletTransaction(transaction) {
 const tx={};
 for(const field of ['from','to','data']){
  if(typeof transaction[field]!=='string'||!/^0x[0-9a-f]*$/i.test(transaction[field]))throw fail('INVALID_TRANSACTION','交易参数格式不正确：'+field);
  tx[field]=transaction[field];
 }
 for(const field of ['value','nonce','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','chainId']){
  if(transaction[field]==null)continue;
  const value=BigInt(transaction[field]);if(value<0n)throw fail('INVALID_TRANSACTION','交易数值不能为负数');
  tx[field]='0x'+value.toString(16);
 }
 // Keep the BSC chain constraint, but omit SDK metadata from the wallet payload.
 return tx;
}
function walletDiagnostic(error) {
 const code=Number(error?.code);
 const message=String(error?.message||'钱包请求未完成').replace(/(?:https?|wss?):\/\/\S+/gi,'[RPC]').replace(/\b(?:0x)?[a-f0-9]{64,}\b/gi,'[redacted]').slice(0,240);
 return {code:Number.isFinite(code)?code:null,message};
}
async function recoverLocked({read,account,hash,receipt:knownReceipt,storage=globalThis.localStorage,intentKey=key(account)}) {
 const snapshot=storage.getItem(intentKey);
 const intent=JSON.parse(snapshot||'null');
 if(!intent) return null;
 hash ||= intent.hash;
 if(!hash){archiveUnresolved(storage,account,intent);return null;}
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw fail('INVALID_RECEIPT','交易哈希无效',intent);
 const receipt=knownReceipt||await read({method:'eth_getTransactionReceipt',params:[hash]});
 if(!receipt?.blockHash)throw fail('TX_PENDING','交易已提交，正在等待结果',intent);
 const [tx,block]=await Promise.all([read({method:'eth_getTransactionByHash',params:[hash]}),read({method:'eth_getBlockByNumber',params:[receipt.blockNumber,false]})]);
 if(!tx)throw fail('TX_PENDING','交易已提交，正在等待结果',intent);
 const expected=intent.transaction;
 if(!same(tx.hash,hash)||!same(receipt.transactionHash,hash)||
  !matchesWalletExecution(tx,receipt,expected,{allowApprovalReduction:true})||
  !same(tx.blockHash,receipt.blockHash)||!same(block?.hash,receipt.blockHash))throw fail('INVALID_RECEIPT','交易结果暂时无法与本次请求匹配',intent);
 const status=BigInt(receipt.status);
 if(status!==0n&&status!==1n)throw fail('INVALID_RECEIPT','交易状态无效',intent);
 if(storage.getItem(intentKey)!==snapshot)throw fail("INTENT_CHANGED","待处理交易已变化",intent);
 storage.removeItem(intentKey);
 return {receipt,transaction:expected,reverted:status===0n};
}
function lateRecords(storage,account) {
 const prefix=key(account)+':late:';const records=[];
 for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(prefix))records.push([k,JSON.parse(storage.getItem(k))]);}
 return records;
}
async function recoverLateLocked({read,account,storage}) {
 let result=null;
 for(const [intentKey,intent] of lateRecords(storage,account))result=await recoverLocked({read,account,hash:intent.hash,storage,intentKey});
 return result;
}
export async function recoverWalletIntent({read,account,hash,receipt,storage=globalThis.localStorage,locks=globalThis.navigator?.locks}) {
 if(!locks?.request)throw fail('WALLET_LOCK_UNAVAILABLE','此浏览器不支持交易互斥锁');
 return locks.request(key(account),async()=>{const late=await recoverLateLocked({read,account,storage});return await recoverLocked({read,account,hash,receipt,storage})||late;});
}
function archiveUnresolved(storage,account,intent) {
 // Diagnostics are retained, but a missing wallet hash is not a permanent UI lock.
 const archiveKey=key(account)+':archive:'+Date.now();
 storage.setItem(archiveKey,JSON.stringify({...intent,archivedAt:Date.now()}));
 storage.removeItem(key(account));
 return archiveKey;
}
export async function sendWalletOnce({provider,read,transaction,gasLimit,gasPrice,beforeSubmit,walletTimeoutMs=90000,walletReadTimeoutMs=15000,storage=globalThis.localStorage,locks=globalThis.navigator?.locks}) {
 const account=transaction.from;
 const walletRead=payload=>walletDeadline(Promise.resolve().then(()=>provider.request(payload)),walletReadTimeoutMs);
 if(!locks?.request)throw fail('WALLET_LOCK_UNAVAILABLE','此浏览器不支持交易互斥锁，请使用最新版浏览器');
 return locks.request(key(account),{ifAvailable:true},async lock=>{
  if(!lock)throw fail('WALLET_BUSY','钱包中已有请求，请先完成或取消');
  await recoverLateLocked({read,account,storage});
  let previous=JSON.parse(storage.getItem(key(account))||'null');
  if(previous?.hash){await recoverLocked({read,account,hash:previous.hash,storage});previous=null;}
  if(previous)archiveUnresolved(storage,account,previous);
  const [chain,accounts,code,canonical]=await Promise.all([walletRead({method:'eth_chainId'}),walletRead({method:'eth_accounts'}),walletRead({method:'eth_getCode',params:[transaction.to,'latest']}),read({method:'eth_getBlockByNumber',params:['latest',false]})]);
  if(BigInt(chain)!==56n||!same(accounts[0],account))throw fail('WALLET_CHANGED','钱包网络或账户已改变，请重新核对');
  if(!code||code==='0x')throw fail('TARGET_MISSING','当前网络没有目标合约');
  const [block,nonce]=await Promise.all([walletRead({method:'eth_getBlockByNumber',params:[canonical.number,false]}),walletRead({method:'eth_getTransactionCount',params:[account,'pending']})]);
  if(!block||!same(block.hash,canonical.hash))throw fail('WRONG_CHAIN','钱包网络与读链节点不一致');
  if(beforeSubmit&&!beforeSubmit())throw fail('REQUEST_CHANGED','当前选择已改变');
  const arrived=lateRecords(storage,account)[0]?.[1];
  if(arrived)throw fail('TX_PENDING','交易已提交，正在等待结果',arrived);
  const tx=walletTransaction({...transaction,chainId:'0x38',nonce,...(gasLimit?{gas:gasLimit}:{}),...(gasPrice?{gasPrice}:{})});
  const expected={...tx,chainId:'0x38'};
  const intent={transaction:expected,createdAt:Date.now()};storage.setItem(key(account),JSON.stringify(intent));
  let archiveKey;
  try{
   const submitted=Promise.resolve(provider.request({method:'eth_sendTransaction',params:[{...tx}]}));
   // Track late hashes independently so they cannot overwrite a newer active transaction.
   submitted.then(hash=>{
    if(!archiveKey||!/^0x[0-9a-f]{64}$/i.test(hash||''))return;
    const late={...intent,hash,archivedAt:Date.now()};
    // Unique per-hash records are visible immediately, even during another request's preflight.
    storage.setItem(archiveKey,JSON.stringify(late));
    storage.setItem(key(account)+':late:'+hash,JSON.stringify(late));
   }).catch(()=>{});
   const hash=await walletDeadline(submitted,walletTimeoutMs);
   if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('钱包未返回有效交易哈希');
   intent.hash=hash;storage.setItem(key(account),JSON.stringify(intent));
   return {hash,transaction:expected,mev:false};
  }catch(error){
   const diagnostic=walletDiagnostic(error);
   if([4001,4100,4200,-32601,-32602].includes(diagnostic.code)){
    storage.removeItem(key(account));
    throw Object.assign(new Error(diagnostic.message),{code:diagnostic.code});
   }
   intent.walletError=diagnostic;archiveKey=archiveUnresolved(storage,account,intent);
   throw fail('WALLET_RESPONSE_UNKNOWN','钱包未返回交易结果：'+diagnostic.message);
  }
 });
}
