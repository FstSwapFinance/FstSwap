// Truncate decimal text without floating-point rounding or changing integer digits.
export function limitAmountDecimals(value, places = 4) {
 const text=String(value??'');
 const dot=text.indexOf('.');
 return dot<0?text:text.slice(0,dot+1+places);
}
export function formatAmountInput(value, decimals) {
 const raw=BigInt(value).toString().padStart(decimals+1,'0');
 if(!decimals)return raw;
 const text=limitAmountDecimals(raw.slice(0,-decimals)+'.'+raw.slice(-decimals));
 return text.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}
