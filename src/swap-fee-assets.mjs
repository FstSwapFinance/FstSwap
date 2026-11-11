// Fee metadata must retain the actual on-chain asset even when its token list
// entry is disabled. Receipt checks use the quote's feeToken directly.
const ZERO='0x'+'00'.repeat(20);
const assets=[
 [ZERO,'BNB',18],
 ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c','WBNB',18],
 ['0x55d398326f99059ff775485246999027b3197955','USDT',18],
 ['0xc9882def23bc42d53895b8361d0b1edc7570bc6a','FIST',6],
 ['0x2170ed0880ac9a755fd29b2688956bd959f933f8','ETH',18],
 ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d','USDC',18],
];
export function resolveFeeAsset(feeToken,tokens={}){
 const address=String(feeToken||ZERO).toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(address))throw Error('INVALID_FEE_ASSET');
 const listed=Object.values(tokens).find(token=>String(token.address||ZERO).toLowerCase()===address);
 if(listed)return {...listed,address:address===ZERO?null:address};
 const known=assets.find(([a])=>a===address);
 if(!known)throw Error('INVALID_FEE_ASSET');
 return {address:address===ZERO?null:address,symbol:known[1],decimals:known[2]};
}
