import {balanceFraction} from './swap-amount.mjs';

const ceilBps=(value,bps)=>(value*BigInt(bps)+9999n)/10000n;
const positive=value=>{
 if(!(typeof value==='bigint'||typeof value==='string'&&/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)||typeof value==='number'&&Number.isSafeInteger(value)))throw new TypeError('Invalid gas quantity');
 const n=BigInt(value);if(n<=0n)throw new RangeError('Invalid gas quantity');return n;
};
const insufficient=()=>Object.assign(Error('BNB 余额不足以支付当前交易的 Gas'),{code:'NATIVE_GAS_BALANCE'});

// Read-only sizing: no wallet prompt, no zero-price guess and no fixed BNB holdback.
// The final amount has its own transaction estimate; a probe never becomes a swap.
export async function nativeBalanceFraction({balance,percent,readGasPrice,buildTransaction,estimate,
 fallbackGasLimit=900000n,extraGasLimit=0n,allowEstimateFallback=false,assertCurrent=()=>{},signal}){
 if(typeof balance!=='bigint'||balance<=0n||!Number.isInteger(percent)||percent<=0||percent>100||
  typeof extraGasLimit!=='bigint'||extraGasLimit<0n||[readGasPrice,buildTransaction,estimate,assertCurrent].some(fn=>typeof fn!=='function'))throw new TypeError('Invalid native balance request');
 const check=()=>{if(signal?.aborted)throw new DOMException('Native amount read canceled','AbortError');assertCurrent();};
 const read=async fn=>{
  check();
  let detach=()=>{};
  try{
   const canceled=new Promise((_,reject)=>{if(!signal)return;const abort=()=>reject(new DOMException('Native amount read canceled','AbortError'));signal.addEventListener('abort',abort,{once:true});detach=()=>signal.removeEventListener('abort',abort);if(signal.aborted)abort();});
   const value=await Promise.race([Promise.resolve().then(()=>{check();return fn({signal});}),canceled]);check();return value;
  }finally{detach();}
 };
 const gasPrice=positive(await read(readGasPrice)),priceBudget=ceilBps(gasPrice,12000);
 const budgetLimit=ceilBps(positive(fallbackGasLimit),13000);
 const reserveFor=limit=>(limit+extraGasLimit)*priceBudget;
 const initialReserve=reserveFor(budgetLimit),probeReserve=initialReserve<balance/2n?initialReserve:balance/2n;
 let amount=balanceFraction(balance,percent,probeReserve),largestLimit=0n;
 if(amount<=0n)throw insufficient();
 for(let round=0;round<3;round++){
  const transaction=await read(options=>buildTransaction(amount,options));
  if(!transaction||typeof transaction!=='object')throw new TypeError('Invalid native transaction');
  let limit,estimated=true;
  try{limit=ceilBps(positive(await read(options=>estimate(transaction,options))),13000);}
  catch(error){check();if(!allowEstimateFallback)throw error;limit=budgetLimit;estimated=false;}
  if(limit>largestLimit)largestLimit=limit;
  const reserve=reserveFor(largestLimit),next=balanceFraction(balance,percent,reserve);
  if(next<=0n)throw insufficient();
  if(next===amount){check();return{amount,reserve,gasLimit:largestLimit,gasPrice,estimated,transaction};}
  amount=next;
 }
 throw Object.assign(Error('Gas 估算发生变化，请重新选择余额比例'),{code:'NATIVE_GAS_CHANGED'});
}
