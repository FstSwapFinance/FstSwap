import {formatAmountInput} from './swap-amount.mjs';

// Typing used to wait 100ms after the last change before a quote could start.
export const typedQuoteDelayMs=0;

// The latest typed amount owns the output. An older response, an abort, or a
// mismatched raw amount must not paint a number.
export function acceptQuoteResult({requestId,currentId,requestedText,currentText,aborted=false}={}){
 return aborted!==true&&requestId===currentId&&requestedText===currentText&&requestedText!==undefined;
}

export function quoteFieldState({amount='',quote=null,error='',decimals=18,now=Date.now(),amountRaw=null}={}){
 const text=String(amount??''),typed=text!==''&&Number(text)>0;
 if(!typed)return {value:'',placeholder:'0.0',state:'empty',showDetails:false};
 if(error)return {value:'',placeholder:'—',state:'error',showDetails:false};
 const matches=!!quote&&typeof quote.out==='bigint'&&quote.out>0n&&typeof quote.amountIn==='bigint'&&(amountRaw==null||quote.amountIn===amountRaw);
 const expires=quote?.serviceExpiresAt;
 if(matches&&Number.isFinite(expires)&&now>=expires)return {value:'',placeholder:'…',state:'stale',showDetails:false};
  if(!matches)return {value:'',placeholder:'…',state:'loading',showDetails:false};
 // Four displayed decimals must not turn a positive raw amount into a confirmed zero.
 const value=formatAmountInput(quote.out,decimals);
 return {value:value&&value!=='0'?value:'<0.0001',placeholder:'0.0',state:'ready',showDetails:true};
}

// A ready quote can become the new input. A hidden stale, failed, or loading
// output cannot, because that number is not the amount the user still sees.
export function amountForDirectionChange({quoteState,quotedOutput,typedAmount}={}){
 return quoteState==='ready'?String(quotedOutput??''):String(typedAmount??'');
}

// The latest balance read clears its own pending mark and any older one. A
// superseded read must leave a newer pending mark alone.
export function shouldClearBalancePending(pendingId,requestId,latestId){
 return latestId===requestId&&(pendingId==null||pendingId<=requestId);
}

// Missing, failed, and invalidated rows are never a confirmed zero and cannot
// size a spend or Max action. A real 0n balance remains spendable and visible.
export function balanceFieldState({connected=false,balance=null,error=false,pending=false}={}){
 if(!connected)return {state:'disconnected',spendable:false,balance:null};
 if(pending||error||typeof balance!=='bigint'||balance<0n)return {state:error&&!pending?'error':'loading',spendable:false,balance:null};
 return {state:'ready',spendable:true,balance};
}

export function holdingLabel(balance,decimals,format,full){
 if(typeof balance!=='bigint'||balance<0n||!Number.isInteger(decimals)||decimals<0||typeof format!=='function'||typeof full!=='function')return null;
 return {text:format(balance,decimals),title:full(balance,decimals)};
}
