// One wallet intent per account. Unknown transport results never trigger a new transaction.
const prefix='fstswap-wallet-intent-v1:56:';
const fail=(code,message,intent)=>Object.assign(new Error(message),{code,pendingIntent:intent});
const key=account=>prefix+account.toLowerCase();
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
function walletDiagnostic(error) {
 const code=Number(error?.code);
 const message=String(error?.message||'钱包请求未完成').replace(/(?:https?|wss?):\/\/\S+/gi,'[RPC]').replace(/\b(?:0x)?[a-f0-9]{64,}\b/gi,'[redacted]').slice(0,240);
 return {code:Number.isFinite(code)?code:null,message};
}
function matchesCallData(tx,expected,receipt) {
 if(same(tx.input,expected.data))return true;
 // Wallets may reduce ERC20 approval limits in their confirmation screen.
 // Accept only that change, for the same spender, with the emitted amount.
 const actual=String(tx.input||'').toLowerCase(),planned=String(expected.data||'').toLowerCase();
 if(!/^0x095ea7b3[0-9a-f]{128}$/.test(actual)||!/^0x095ea7b3[0-9a-f]{128}$/.test(planned)||actual.slice(0,74)!==planned.slice(0,74))return false;
 if(BigInt('0x'+actual.slice(74))>BigInt('0x'+planned.slice(74)))return false;
 if(BigInt(receipt.status)===0n)return true;
 const owner='0x'+String(expected.from).slice(2).toLowerCase().padStart(64,'0');
 const spender='0x'+actual.slice(10,74),amount='0x'+actual.slice(74);
 return receipt.logs?.some(log=>same(log.address,expected.to)&&log.topics?.length===3&&
  same(log.topics[0],'0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925')&&
  same(log.topics[1],owner)&&same(log.topics[2],spender)&&same(log.data,amount))||false;
}
async function recoverLocked({read,account,hash,storage=globalThis.localStorage}) {
 const snapshot=storage.getItem(key(account));
 const intent=JSON.parse(snapshot||'null');
 if(!intent) return null;
 hash ||= intent.hash;
 if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw fail('TX_UNKNOWN','请从钱包提供原交易哈希进行核验',intent);
 const [tx,receipt]=await Promise.all([read({method:'eth_getTransactionByHash',params:[hash]}),read({method:'eth_getTransactionReceipt',params:[hash]})]);
 if(!tx||!receipt?.blockHash)throw fail('TX_PENDING','原交易尚未确认，请勿重复提交',intent);
 const block=await read({method:'eth_getBlockByNumber',params:[receipt.blockNumber,false]});
 const expected=intent.transaction;
 if(!same(tx.hash,hash)||!same(receipt.transactionHash,hash)||!same(tx.from,expected.from)||!same(receipt.from,expected.from)||!same(tx.to,expected.to)||!same(receipt.to,expected.to)||!matchesCallData(tx,expected,receipt)||BigInt(tx.value)!==BigInt(expected.value||0)||BigInt(tx.nonce)!==BigInt(expected.nonce)||!same(tx.blockHash,receipt.blockHash)||!same(block?.hash,receipt.blockHash)||(tx.chainId&&BigInt(tx.chainId)!==56n))throw fail('INVALID_RECEIPT','交易与原始提交意图不符，保持锁定',intent);
 const status=BigInt(receipt.status);
 if(status!==0n&&status!==1n)throw fail('INVALID_RECEIPT','交易状态无效',intent);
 if(storage.getItem(key(account))!==snapshot)throw fail("INTENT_CHANGED","待处理交易已变化，保持新交易锁定",intent);
 storage.removeItem(key(account));
 return {receipt,transaction:expected,reverted:status===0n};
}
export async function recoverWalletIntent({read,account,hash,storage=globalThis.localStorage,locks=globalThis.navigator?.locks}) {
 if(!locks?.request)throw fail('WALLET_LOCK_UNAVAILABLE','此浏览器不支持交易互斥锁');
 return locks.request(key(account),()=>recoverLocked({read,account,hash,storage}));
}
// Only the user can attest that they never confirmed the wallet request. A matching
// nonce alone cannot establish that an unknown transport request was never sent.
export async function releaseUnsentWalletIntent({provider,read,account,expectedIntent,confirmedUnsent=false,storage=globalThis.localStorage,locks=globalThis.navigator?.locks}) {
 if(!confirmedUnsent)throw fail('CONFIRM_UNSENT','请确认你没有在钱包中确认这笔交易');
 if(!locks?.request)throw fail('WALLET_LOCK_UNAVAILABLE','此浏览器不支持交易互斥锁');
 return locks.request(key(account),async()=>{
  const snapshot=storage.getItem(key(account));const intent=JSON.parse(snapshot||'null');
  if(!intent)return null;
  if(!expectedIntent||JSON.stringify(expectedIntent)!==snapshot)throw fail('INTENT_CHANGED','待处理交易已变化，请关闭旧弹窗后重试',intent);
  if(intent.hash)throw fail('TX_PENDING','交易已提交，请等待交易结果',intent);
  const [chain,accounts,latest,pending,walletPending]=await Promise.all([
   provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'}),
   read({method:'eth_getTransactionCount',params:[account,'latest']}),
   read({method:'eth_getTransactionCount',params:[account,'pending']}),
   provider.request({method:'eth_getTransactionCount',params:[account,'pending']}),
  ]);
  if(BigInt(chain)!==56n||!same(accounts?.[0],account)||!same(intent.transaction.from,account)||BigInt(intent.transaction.chainId)!==56n)throw fail('WALLET_CHANGED','钱包网络或账户已改变',intent);
  const nonce=BigInt(intent.transaction.nonce);
  if([latest,pending,walletPending].some(n=>BigInt(n)!==nonce))throw fail('NONCE_CHANGED','钱包已有其他交易记录，请先在钱包中查看交易状态',intent);
  if(storage.getItem(key(account))!==snapshot)throw fail('INTENT_CHANGED','待处理交易已变化，请刷新页面',intent);
  storage.setItem(key(account)+':archive:'+Date.now(),JSON.stringify({...intent,releasedAt:Date.now(),releaseReason:'user-confirmed-unsent'}));
  storage.removeItem(key(account));
  return {released:true};
 });
}
export async function sendWalletOnce({provider,read,transaction,gasLimit,gasPrice,storage=globalThis.localStorage,locks=globalThis.navigator?.locks}) {
 const account=transaction.from;
 if(!locks?.request)throw fail('WALLET_LOCK_UNAVAILABLE','此浏览器不支持交易互斥锁，请使用最新版浏览器');
 return locks.request(key(account),async()=>{
  let previous=JSON.parse(storage.getItem(key(account))||'null');
  if(previous?.hash){await recoverLocked({read,account,hash:previous.hash,storage});previous=null;}
  if(previous)throw fail('TX_UNKNOWN','上次钱包请求未完成。若你没有在钱包确认交易，可解除等待后重新操作。',previous);
  const [chain,accounts,code]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'}),provider.request({method:'eth_getCode',params:[transaction.to,'latest']})]);
  if(BigInt(chain)!==56n||!same(accounts[0],account))throw fail('WALLET_CHANGED','钱包网络或账户已改变，请重新核对');
  if(!code||code==='0x')throw fail('TARGET_MISSING','当前网络没有目标合约');
  const canonical=await read({method:'eth_getBlockByNumber',params:['latest',false]});
  const block=await provider.request({method:'eth_getBlockByNumber',params:[canonical.number,false]});
  if(!block||!same(block.hash,canonical.hash))throw fail('WRONG_CHAIN','钱包网络与读链节点不一致');
  const nonce=await provider.request({method:'eth_getTransactionCount',params:[account,'pending']});
  const tx={...transaction,chainId:'0x38',nonce};
  if(gasLimit)tx.gas='0x'+BigInt(gasLimit).toString(16);
  if(gasPrice)tx.gasPrice='0x'+BigInt(gasPrice).toString(16);
  const intent={transaction:tx,createdAt:Date.now()};storage.setItem(key(account),JSON.stringify(intent));
  try{
   const hash=await provider.request({method:'eth_sendTransaction',params:[tx]});
   if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('钱包未返回有效交易哈希');
   intent.hash=hash;storage.setItem(key(account),JSON.stringify(intent));
   return {hash,transaction:tx,mev:false};
  }catch(error){
   const diagnostic=walletDiagnostic(error);
   if([4001,4100,4200,-32601,-32602].includes(diagnostic.code)){
    storage.removeItem(key(account));
    throw Object.assign(new Error(diagnostic.message),{code:diagnostic.code});
   }
   intent.walletError=diagnostic;storage.setItem(key(account),JSON.stringify(intent));
   throw fail('TX_UNKNOWN','钱包未返回交易结果：'+diagnostic.message+'。若未在钱包确认交易，可解除等待。',intent);
  }
 });
}
