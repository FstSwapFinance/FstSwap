// One transaction's short receipt/transaction read scope. Both existing receipt
// validators still run; all canonical block headers always reach the network.
const HASH=/^0x[0-9a-f]{64}$/i,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const lower=value=>typeof value==='string'?value.toLowerCase():'';
function snapshot(value){
 const copy=structuredClone(value),seen=new WeakSet();
 const freeze=item=>{
  if(item&&typeof item==='object'&&!seen.has(item)){
   seen.add(item);for(const child of Object.values(item))freeze(child);Object.freeze(item);
  }
  return item;
 };
 return freeze(copy);
}
export function createReceiptReadScope(read,{hash,clock=Date.now,ttlMs=3000}={}){
 if(typeof read!=='function'||typeof clock!=='function'||!HASH.test(hash||''))throw new TypeError('Invalid receipt read scope');
 const target=hash.toLowerCase(),ttl=Math.min(3000,Math.max(0,Number(ttlMs)||0));
 let disposed=false,opened=false,closed=false,startedAt,receipt,transaction;
 const running=()=>{if(disposed)throw new DOMException('Receipt read scope disposed','AbortError');};
 const active=()=>{
  if(!opened||closed)return false;
  const age=clock()-startedAt;
  if(!Number.isFinite(age)||age<0||age>=ttl){closed=true;receipt=transaction=undefined;return false;}
  return true;
 };
 const mined=value=>value&&typeof value==='object'&&HASH.test(value.blockHash||'')&&QUANTITY.test(value.blockNumber||'');
 const matchingReceipt=value=>mined(value)&&lower(value.transactionHash)===target;
 const matchingTransaction=value=>mined(value)&&receipt&&lower(value.hash)===target&&lower(value.blockHash)===lower(receipt.blockHash)&&lower(value.blockNumber)===lower(receipt.blockNumber);
 return {
  async read(payload){
   running();
   const method=payload?.method,eligible=(method==='eth_getTransactionReceipt'||method==='eth_getTransactionByHash')&&Array.isArray(payload?.params)&&payload.params.length===1&&lower(payload.params[0])===target;
   if(eligible&&active()){
    const cached=method==='eth_getTransactionReceipt'?receipt:transaction;
    if(cached!==undefined)return cached;
   }
   let value;
   try{value=await read(payload);}catch(error){running();throw error;}
   running();
   // Headers, nonce, gas, other hashes, and all other methods remain untouched.
   if(!eligible)return value;
   const result=snapshot(value);
   if(method==='eth_getTransactionReceipt'){
    if(matchingReceipt(result)){
     if(!opened){opened=true;startedAt=clock();}
     if(active()){
      receipt=result;
      if(!matchingTransaction(transaction))transaction=undefined;
     }
    }else{receipt=transaction=undefined;}
   }else if(active()){
    transaction=matchingTransaction(result)?result:undefined;
   }
   return result;
  },
  dispose(){disposed=true;closed=true;receipt=transaction=undefined;},
 };
}
