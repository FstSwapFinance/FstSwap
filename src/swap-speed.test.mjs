import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendWalletOnce} from './swap-send.mjs?v=mainnet-20261113-50';
import {typedQuoteDelayMs} from './swap-display.mjs?v=mainnet-20261113-50';

const account = '0x1111111111111111111111111111111111111111';
const router = '0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function memoryStorage() {
  const values = new Map();
  return {getItem:key => values.has(key) ? values.get(key) : null, setItem:(key, value) => values.set(key, String(value)), removeItem:key => values.delete(key), get length(){return values.size;}, key:index => [...values.keys()][index]};
}

test('typed quotes are not held for the previous 100ms debounce', () => {
  assert.equal(typedQuoteDelayMs, 0);
});

test('wallet preparation overlaps nonce and block recheck before eth_sendTransaction', async () => {
  const calls = [];
  const started = Date.now();
  const block = {number:'0x10', hash:'0x' + '11'.repeat(32), timestamp:'0x1'};
  const provider = {async request(payload) {
    calls.push({method:payload.method, at:Date.now() - started});
    await sleep(80);
    if (payload.method === 'eth_chainId') return '0x38';
    if (payload.method === 'eth_accounts') return [account];
    if (payload.method === 'eth_getCode') return '0x12';
    if (payload.method === 'eth_getTransactionCount') return '0x7';
    if (payload.method === 'eth_getBlockByNumber') return block;
    if (payload.method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32);
    throw new Error(payload.method);
  }};
  const read = async () => {calls.push({method:'public-block', at:Date.now() - started}); await sleep(80); return block;};
  const result = await sendWalletOnce({
    provider, read, storage:memoryStorage(), locks:{request:async (_name, _options, callback) => callback({name:'lock'})},
    transaction:{from:account, to:router, data:'0x1234', value:0n},
    prepare:async () => {await sleep(200); return {gasLimit:21000n, gasPrice:3_000_000_000n};},
    walletReadTimeoutMs:5000, walletTimeoutMs:5000,
  });
  const send = calls.find(call => call.method === 'eth_sendTransaction');
  const nonce = calls.find(call => call.method === 'eth_getTransactionCount');
  assert.equal(result.transaction.gasPrice, '0x' + (3_000_000_000n).toString(16));
  assert.equal(result.transaction.nonce, '0x7');
  assert.equal(result.transaction.chainId, '0x38');
  assert.ok(nonce.at < 40, 'nonce started at ' + nonce.at + 'ms');
  // Previous measured invocation was 284ms: 200ms preparation plus a later 80ms round trip.
  assert.ok(send.at < 240, 'eth_sendTransaction was invoked at ' + send.at + 'ms');
  assert.ok(send.at + 80 <= Date.now() - started);
});
