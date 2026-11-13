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

// Keep full integer precision; only the input's display is truncated separately.
export function balanceFraction(balance, percent, reserve = 0n) {
 if(typeof balance!=='bigint'||balance<0n||typeof reserve!=='bigint'||reserve<0n)throw new TypeError('Invalid balance or reserve');
 if(!Number.isInteger(percent)||percent<0||percent>100)throw new RangeError('Invalid balance percentage');
 const available=balance>reserve?balance-reserve:0n;
 return available*BigInt(percent)/100n;
}
