import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from '../tools/runtime/node_modules/ethers/lib.esm/index.js';
import {sendWalletOnce} from './swap-send.mjs?v=mainnet-20261113-50';
import {typedQuoteDelayMs} from './swap-display.mjs?v=mainnet-20261113-50';
import {readWalletBalances, invalidateWalletBalances, serviceBalanceHeadStartMs} from './swap-balances.mjs?v=mainnet-20261113-50';
import {swapService} from './swap-service-client.mjs?v=mainnet-20261113-50';
globalThis.ethers = ethers;

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
    prepare:async () => {await sleep(200); calls.push({method:'prepare-done',at:Date.now()-started}); return {gasLimit:21000n, gasPrice:3_000_000_000n};},
    walletReadTimeoutMs:5000, walletTimeoutMs:5000,
  });
  const send = calls.find(call => call.method === 'eth_sendTransaction');
  const nonce = calls.find(call => call.method === 'eth_getTransactionCount');
  assert.equal(result.transaction.gasPrice, '0x' + (3_000_000_000n).toString(16));
  assert.equal(result.transaction.nonce, '0x7');
  assert.equal(result.transaction.chainId, '0x38');
  assert.ok(nonce.at < 40, 'nonce started at ' + nonce.at + 'ms');
  const prepared=calls.find(call=>call.method==='prepare-done');
  for(const method of ['eth_chainId','eth_accounts']){
    const identityReads=calls.filter(call=>call.method===method);
    assert.equal(identityReads.length,2);
    assert.ok(identityReads[1].at>=prepared.at,method+' must sample identity after preparation');
    assert.ok(identityReads[1].at<send.at,method+' must complete before send');
  }
  // Preparation still overlaps nonce/block reads, but the final identity round
  // trip is mandatory: a 200ms simulation plus an 80ms wallet identity read.
  assert.ok(send.at < 400, 'eth_sendTransaction was invoked at ' + send.at + 'ms');
  assert.ok(send.at + 80 <= Date.now() - started);
});

const balanceAccount = '0x' + '11'.repeat(20);
const balanceToken = {key:'usdt', address:'0x55d398326f99059ff775485246999027b3197955', decimals:18};
const balanceCodec = new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])', 'function balanceOf(address) view returns(uint256)']);
function balanceHeader(hash = '0x' + '11'.repeat(32)) {
  return {number:'0x20', hash, timestamp:'0x' + Math.floor(Date.now() / 1000).toString(16)};
}
function encodedBalance(amount) {
  return balanceCodec.encodeFunctionResult('tryAggregate', [[{success:true, returnData:balanceCodec.encodeFunctionResult('balanceOf', [amount])}]]);
}

test('a fast balance service is shown without a public read', async () => {
  invalidateWalletBalances();
  const original = swapService.balances;
  let publicCalls = 0;
  swapService.balances = async () => ({balances:{usdt:7n}, failed:[]});
  try {
    const result = await readWalletBalances(async () => { publicCalls++; throw new Error('public read'); }, balanceAccount, [balanceToken]);
    assert.equal(result.balances.usdt, 7n);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(publicCalls, 0);
    assert.equal(serviceBalanceHeadStartMs, 350);
  } finally { swapService.balances = original; invalidateWalletBalances(); }
});

test('a slow balance service yields to one canonical public read', async () => {
  invalidateWalletBalances();
  const original = swapService.balances;
  const calls = [];
  let releaseService;
  const service = new Promise(resolve => { releaseService = resolve; });
  let serviceSignal;
  swapService.balances = (_account, _tokens, options = {}) => { serviceSignal = options.signal; return service; };
  const request = async payload => {
    calls.push(payload);
    await new Promise(resolve => setTimeout(resolve, 20));
    if (payload.method === 'eth_getBlockByNumber') return balanceHeader();
    if (payload.method === 'eth_call') return encodedBalance(9n);
    throw new Error(payload.method);
  };
  try {
    const started = Date.now();
    const result = await readWalletBalances(request, balanceAccount, [balanceToken]);
    const elapsed = Date.now() - started;
    assert.equal(result.balances.usdt, 9n);
    assert.equal(calls.filter(call => call.method === 'eth_call').length, 1);
    assert.equal(calls.find(call => call.method === 'eth_call').params[1], '0x20');
    assert.equal(calls.filter(call => call.method === 'eth_getBlockByNumber').length, 2);
    assert.equal(serviceSignal.aborted, true);
    assert.ok(elapsed < 700, 'slow service balance became visible at ' + elapsed + 'ms');
    assert.ok(elapsed >= serviceBalanceHeadStartMs);
  } finally { releaseService(null); swapService.balances = original; invalidateWalletBalances(); }
});

test('a public block hash change does not replace the service balance', async () => {
  invalidateWalletBalances();
  const original = swapService.balances;
  let headers = 0;
  swapService.balances = () => new Promise(resolve => setTimeout(() => resolve({balances:{usdt:5n}, failed:[]}), 500));
  const request = async payload => {
    if (payload.method === 'eth_getBlockByNumber') return balanceHeader(headers++ === 0 ? '0x' + '11'.repeat(32) : '0x' + '22'.repeat(32));
    if (payload.method === 'eth_call') return encodedBalance(9n);
    throw new Error(payload.method);
  };
  try {
    const result = await readWalletBalances(request, balanceAccount, [balanceToken]);
    assert.equal(result.balances.usdt, 5n);
  } finally { swapService.balances = original; invalidateWalletBalances(); }
});
