import test from 'node:test';
import assert from 'node:assert/strict';
import {limitAmountDecimals,formatAmountInput} from '../swap-amount.mjs';
test('amount fields truncate to four decimal places without rounding above balance',()=>{
 assert.equal(formatAmountInput(604329530999000000000n,18),'604.3295');
 assert.equal(formatAmountInput(488394037n,6),'488.394');
 assert.equal(limitAmountDecimals('1.999999'),'1.9999');
 assert.equal(formatAmountInput(999999999999999999999999999999n,18),'999999999999.9999');
});
test('amount editing retains empty values and decimal entry; integer tokens stay exact',()=>{
 for(const v of ['', '.', '0.', '1.0000','123456789'])assert.equal(limitAmountDecimals(v),v);
 assert.equal(formatAmountInput(42n,0),'42');
 assert.equal(formatAmountInput(1n,18),'0');
});
