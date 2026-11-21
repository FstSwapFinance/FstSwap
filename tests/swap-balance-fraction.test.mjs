import test from 'node:test';
import assert from 'node:assert/strict';
import * as amount from '../src/swap-amount.mjs';

test('balance fractions keep integer precision for 25, 50, 75 and Max',()=>{
 const balance=123456789123456789123456789n;
 for(const percent of [25,50,75,100])assert.equal(amount.balanceFraction(balance,percent),balance*BigInt(percent)/100n);
 assert.equal(amount.balanceFraction(balance,100),balance);
});
test('native fractions use only the balance remaining after the existing gas reserve',()=>{
 const balance=15966673100000000n,reserve=10000000000000000n,available=5966673100000000n;
 for(const percent of [25,50,75,100])assert.equal(amount.balanceFraction(balance,percent,reserve),available*BigInt(percent)/100n);
 assert.equal(amount.balanceFraction(reserve,100,reserve),0n);
 assert.equal(amount.balanceFraction(reserve-1n,25,reserve),0n);
});
test('smallest units round down and Max retains a final unallocated unit',()=>{
 assert.equal(amount.balanceFraction(3n,25),0n);
 assert.equal(amount.balanceFraction(3n,50),1n);
 assert.equal(amount.balanceFraction(3n,75),2n);
 assert.equal(amount.balanceFraction(3n,100),3n);
 assert.equal(amount.balanceFraction(0n,100),0n);
});
test('fractions remain exact above Number precision and at uint256 scale',()=>{
 const balance=(1n<<256n)-1n;
 assert.equal(amount.balanceFraction(balance,75),balance*3n/4n);
 assert.equal(amount.balanceFraction(balance,0),0n);
});
test('unknown balances and invalid percentages cannot be converted into spendable amounts',()=>{
 for(const balance of [null,undefined,1,'1',-1n])assert.throws(()=>amount.balanceFraction(balance,25));
 for(const percent of [-1,101,25.5,NaN,Infinity,'25',25n])assert.throws(()=>amount.balanceFraction(1n,percent));
 for(const reserve of [-1n,1,null])assert.throws(()=>amount.balanceFraction(1n,25,reserve));
});
