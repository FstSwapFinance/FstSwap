import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ethers from '../tools/runtime/node_modules/ethers/lib.esm/index.js';
import {FSTSWAP_CONFIG} from './fstswap-config.mjs?v=mainnet-20261113-50';
import {acceptQuoteResult, quoteFieldState, balanceFieldState, holdingLabel} from './swap-display.mjs?v=mainnet-20261113-50';
import {createServiceClient, validateServiceQuote} from './swap-service-client.mjs?v=mainnet-20261113-50';
import {readTokenBalances, readWalletBalances, invalidateWalletBalances} from './swap-balances.mjs?v=mainnet-20261113-50';
import {createAllowanceReader} from './swap-allowance.mjs?v=mainnet-20261113-50';
import {createSubmissionWarmup} from './swap-submission-warmup.mjs?v=mainnet-20261113-50';
import {nativeBalanceFraction} from './swap-native-max.mjs';
import {balanceFraction, formatAmountInput} from './swap-amount.mjs';

globalThis.ethers = ethers;
const ZERO = '0x' + '00'.repeat(20);
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const FIST = '0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const ACCOUNT_A = '0x1111111111111111111111111111111111111111';
const ACCOUNT_B = '0x2222222222222222222222222222222222222222';
const SPENDER_A = '0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7';
const SPENDER_B = '0x3333333333333333333333333333333333333333';
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? {$bigint: item.toString()} : item);
const adapters = FSTSWAP_CONFIG.adapters;

function wrapQuote({amountIn, now, blockHash = '0x' + 'ab'.repeat(32), slippageBps = 50}) {
  const fee = amountIn * 30n / 10000n, swapIn = amountIn - fee, out = swapIn, minimum = out * BigInt(10000 - slippageBps) / 10000n;
  const leg = {adapter: ZERO, kind: 'wrap', path: [], tokenIn: ZERO, tokenOut: WBNB, amountIn: swapIn, out, weightBps: 10000, poolIds: []};
  const stage = {tokenIn: ZERO, tokenOut: WBNB, out, legs: [leg]};
  const quote = {
    kind: 'fstswap', tokenIn: ZERO, tokenOut: WBNB, amountIn, out, minimum, lpFee: fee, feeToken: ZERO, feeMode: 'input',
    configVersion: 1n, impact: 0, poolCheckedAt: now, stages: [{tokenIn: ZERO, tokenOut: WBNB, minOut: out, branches: [{adapter: ZERO, kind: 2, weightBps: 10000, path: [], v3Path: '0x'}]}],
    segments: [{from: ZERO, to: WBNB, amountIn: swapIn, out, minimum: out, impact: 0, legs: [leg], routeStages: [stage]}],
  };
  const config = {version: '2.1.0', platformFeeBps: 30, feeReceiver: '0xff820d0553ccb72dda17a63212f79e7f3f789a99', wbnb: WBNB, defaultFeeToken: USDT, feeConfigVersion: 1n, adaptersOff: []};
  return {schema: 1, chainId: 56, router: FSTSWAP_CONFIG.router, input: {chainId: 56, tokenIn: ZERO, tokenOut: WBNB, amountIn: amountIn.toString(), slippageBps, singleHop: true}, config, quote, blockNumber: '0x10', blockHash, quotedAt: now, expiresAt: now + 15000};
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return {promise, resolve, reject};
}

test('quote field hides loading, stale, error, and mismatched amounts', () => {
  const now = 1_700_000_000_000, amountRaw = 10n ** 18n, out = 1234567890123456789n;
  const quote = {amountIn: amountRaw, out, serviceExpiresAt: now + 1000};
  assert.equal(quoteFieldState({amount: '1', quote, decimals: 18, now, amountRaw}).state, 'ready');
  assert.equal(quoteFieldState({amount: '1', quote, decimals: 18, now, amountRaw}).value, formatAmountInput(out, 18));
  assert.equal(quoteFieldState({amount: '1', quote, decimals: 18, now: now + 1000, amountRaw}).state, 'stale');
  assert.equal(quoteFieldState({amount: '1', quote, decimals: 18, now: now + 1000, amountRaw}).value, '');
  assert.equal(quoteFieldState({amount: '1', error: 'NO_ROUTE', now}).state, 'error');
  assert.equal(quoteFieldState({amount: '1', error: 'NO_ROUTE', now}).value, '');
  assert.equal(quoteFieldState({amount: '1', now}).state, 'loading');
  assert.notEqual(quoteFieldState({amount: '1', now}).value, '0');
  assert.equal(quoteFieldState({amount: '1', quote: {amountIn: 2n, out: 3n, serviceExpiresAt: now + 1000}, now, amountRaw}).state, 'loading');
  assert.equal(quoteFieldState({amount: '', quote, now}).state, 'empty');
  assert.equal(acceptQuoteResult({requestId: 2, currentId: 3, requestedText: '1', currentText: '1.2'}), false);
  assert.equal(acceptQuoteResult({requestId: 4, currentId: 4, requestedText: '1.2', currentText: '1.2'}), true);
  assert.equal(acceptQuoteResult({requestId: 4, currentId: 4, requestedText: '1.2', currentText: '1.2', aborted: true}), false);
});

test('holdings distinguish confirmed zero from unknown, failed, and pending balances', () => {
  assert.deepEqual(balanceFieldState({connected: true, balance: 0n}), {state: 'ready', spendable: true, balance: 0n});
  for (const input of [
    {connected: false, balance: 0n},
    {connected: true, balance: null},
    {connected: true, error: true, balance: 0n},
    {connected: true, pending: true, balance: 5n},
    {connected: true, balance: undefined},
  ]) {
    const field = balanceFieldState(input);
    assert.equal(field.spendable, false);
    assert.equal(field.balance, null);
    assert.notEqual(field.state, 'ready');
  }
  const held = holdingLabel(0n, 18, value => value.toString(), value => value.toString());
  assert.equal(held.text, '0');
  assert.equal(holdingLabel(null, 18, String, String), null);
  assert.equal(holdingLabel(undefined, 18, String, String), null);
});

test('identical in-flight quotes coalesce and an older body cannot replace the latest', async () => {
  let now = 1_700_000_000_000, mono = 0, calls = 0;
  const pending = [];
  const fetchImpl = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const gate = deferred();
    pending.push({body, gate, signal: options.signal});
    const data = await gate.promise;
    return new Response(encode(data), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const client = createServiceClient({base: 'https://quote.test/api/swap', fetchImpl, clock: () => now, monotonic: () => mono, expectedVersion: '2.1.0', quoteTimeout: 5000});
  const ask = (amount, extra = {}) => client.quote({tokenIn: ZERO, tokenOut: WBNB, amountIn: amount, slippageBps: 50, singleHop: true}, {router: FSTSWAP_CONFIG.router, adapters, ...extra});
  const firstAmount = 10n ** 18n, secondAmount = 2n * 10n ** 18n;
  const slow = ask(firstAmount);
  const joined = ask(firstAmount, {fresh: true});
  await Promise.resolve();
  assert.equal(calls, 1);
  const fast = ask(secondAmount);
  await Promise.resolve();
  assert.equal(calls, 2);
  pending[1].gate.resolve(wrapQuote({amountIn: secondAmount, now}));
  pending[0].gate.resolve(wrapQuote({amountIn: firstAmount, now}));
  const [slowResult, joinedResult, fastResult] = await Promise.all([slow, joined, fast]);
  assert.equal(slowResult.quote.amountIn, firstAmount);
  assert.equal(joinedResult.quote.out, slowResult.quote.out);
  assert.equal(fastResult.quote.amountIn, secondAmount);
  assert.notEqual(fastResult.quote.amountIn, slowResult.quote.amountIn);

  const controller = new AbortController();
  const replaced = ask(firstAmount, {signal: controller.signal, fresh: true});
  await Promise.resolve();
  const late = pending.at(-1);
  controller.abort();
  await assert.rejects(replaced, error => error.name === 'AbortError');
  late.gate.resolve(wrapQuote({amountIn: firstAmount, now, blockHash: '0x' + '11'.repeat(32)}));
  await Promise.resolve();
  const current = ask(firstAmount, {fresh: true});
  await Promise.resolve();
  pending.at(-1).gate.resolve(wrapQuote({amountIn: firstAmount, now, blockHash: '0x' + '22'.repeat(32)}));
  assert.equal((await current).blockHash, '0x' + '22'.repeat(32));
  mono += 10; now += 10;
  assert.equal(calls, 4);
  assert.equal((await ask(firstAmount)).blockHash, '0x' + '22'.repeat(32));
  assert.equal(calls, 4);
});

test('balance reads coalesce by account and token set and do not cross accounts', async () => {
  let calls = 0;
  const pending = [];
  const fetchImpl = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const gate = deferred();
    pending.push({body, gate, signal: options.signal});
    options.signal.addEventListener('abort', () => gate.reject(Object.assign(new Error('aborted'), {name: 'AbortError'})));
    return new Response(encode(await gate.promise), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const client = createServiceClient({base: 'https://quote.test/api/swap', fetchImpl, clock: () => 1_700_000_000_000, monotonic: () => 0, balanceTimeout: 5000});
  const now = 1_700_000_000_000;
  const payload = account => ({schema: 1, chainId: 56, account, blockNumber: '0x11', blockHash: '0x' + 'cd'.repeat(32), readAt: now, balances: {[USDT]: '1000', [FIST]: '7'}, failedTokens: []});
  const firstTokens = [{key: 'usdt', address: USDT}, {key: 'fist', address: FIST}];
  const secondTokens = [{key: 'tether', address: USDT}, {key: 'fist-token', address: FIST}];
  const one = client.balances(ACCOUNT_A, firstTokens);
  const two = client.balances(ACCOUNT_A, secondTokens);
  const other = client.balances(ACCOUNT_B, firstTokens);
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.deepEqual(pending[0].body.tokens, [FIST, USDT].sort());
  pending.find(item => item.body.account === ACCOUNT_A).gate.resolve(payload(ACCOUNT_A));
  pending.find(item => item.body.account === ACCOUNT_B).gate.resolve(payload(ACCOUNT_B));
  const [left, right, elsewhere] = await Promise.all([one, two, other]);
  assert.equal(left.balances.usdt, 1000n);
  assert.equal(right.balances.tether, 1000n);
  assert.equal(right.balances['fist-token'], 7n);
  assert.equal(elsewhere.balances.usdt, 1000n);
  assert.equal(left.balances.usdt, right.balances.tether);
});

test('wallet balance cache is isolated by account and chain and never turns a failure into zero', async () => {
  invalidateWalletBalances();
  const codec = new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])', 'function balanceOf(address) view returns(uint256)']);
  const balances = new Map([[ACCOUNT_A, 5n], [ACCOUNT_B, 8n]]);
  let reads = 0;
  const request = async payload => {
    reads++;
    const calls = codec.decodeFunctionData('tryAggregate', payload.params[0].data)[1];
    const rows = calls.map(call => {
      const account = ethers.getAddress(codec.decodeFunctionData('balanceOf', call[1])[0]);
      const value = balances.get(account);
      if (value == null) return [false, '0x'];
      return [true, codec.encodeFunctionResult('balanceOf', [value])];
    });
    return codec.encodeFunctionResult('tryAggregate', [rows]);
  };
  const token = {key: 'usdt', address: USDT, decimals: 18};
  const first = await readWalletBalances(request, ACCOUNT_A, [token], {clock: () => 1000, monotonic: () => 1000});
  const cached = await readWalletBalances(request, ACCOUNT_A, [token], {clock: () => 2000, monotonic: () => 2000});
  const second = await readWalletBalances(request, ACCOUNT_B, [token], {clock: () => 2000, monotonic: () => 2000});
  assert.equal(first.balances.usdt, 5n);
  assert.equal(cached.balances.usdt, 5n);
  assert.equal(reads, 2);
  assert.equal(second.balances.usdt, 8n);
  assert.equal(first.balances.usdt, 5n);
  await assert.rejects(readWalletBalances(request, ACCOUNT_A, [token], {chainId: 97}), /Invalid balance chain/);
  balances.set(ACCOUNT_A, null);
  const failed = await readTokenBalances(request, ACCOUNT_A, [token]);
  assert.deepEqual(failed.balances, {});
  assert.deepEqual(failed.failed, ['usdt']);
  assert.equal(Object.values(failed.balances).includes(0n), false);
  balances.set(ACCOUNT_A, 9n);
  const refreshed = await readWalletBalances(request, ACCOUNT_A, [token], {fresh: true, clock: () => 3000, monotonic: () => 3000});
  assert.equal(refreshed.balances.usdt, 9n);
});

test('allowance cache is isolated by account, chain, and spender and drops after invalidation', async () => {
  const codec = new ethers.Interface(['function allowance(address,address) view returns(uint256)']);
  const values = new Map();
  let now = 0;
  const reader = createAllowanceReader(async payload => {
    const [owner, spender] = codec.decodeFunctionData('allowance', payload.params[0].data);
    return codec.encodeFunctionResult('allowance', [values.get(owner.toLowerCase() + ':' + spender.toLowerCase()) ?? 0n]);
  }, {clock: () => now, ttlMs: 5000});
  const key = (account, spender) => ({chainId: 56, account, token: USDT, spender});
  values.set(ACCOUNT_A.toLowerCase() + ':' + SPENDER_A.toLowerCase(), 4n);
  values.set(ACCOUNT_B.toLowerCase() + ':' + SPENDER_A.toLowerCase(), 6n);
  values.set(ACCOUNT_A.toLowerCase() + ':' + SPENDER_B.toLowerCase(), 11n);
  assert.equal(await reader.read(key(ACCOUNT_A, SPENDER_A)), 4n);
  assert.equal(await reader.read(key(ACCOUNT_B, SPENDER_A)), 6n);
  assert.equal(await reader.read(key(ACCOUNT_A, SPENDER_B)), 11n);
  values.set(ACCOUNT_A.toLowerCase() + ':' + SPENDER_A.toLowerCase(), 99n);
  now = 1000;
  assert.equal(await reader.read(key(ACCOUNT_A, SPENDER_A)), 4n);
  assert.equal(await reader.read(key(ACCOUNT_A, SPENDER_A), {fresh: true}), 99n);
  reader.invalidate();
  values.set(ACCOUNT_A.toLowerCase() + ':' + SPENDER_A.toLowerCase(), 3n);
  assert.equal(await reader.read(key(ACCOUNT_A, SPENDER_A)), 3n);
  await assert.rejects(reader.read({...key(ACCOUNT_A, SPENDER_A), chainId: 1}), /Invalid allowance chain/);
});

test('submission preparation expires and native Max reserves live gas', async () => {
  let now = 0;
  const warmup = createSubmissionWarmup({clock: () => now, ttlMs: 2000, maxRunMs: 6000});
  const provider = {request() {}};
  const identity = {key: 'swap', quote: {id: 1}, provider, providerRequest: provider.request, expiresAt: 5000};
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  assert.equal(warmup.start(identity, async () => ({gasPrice: 7n, gasLimit: 21000n, expiresAt: 5000})), true);
  await flush();
  now = 500;
  const ready = warmup.take(identity, value => value.gasPrice === 7n && value.gasLimit === 21000n);
  assert.equal(ready.gasPrice, 7n);
  assert.equal(warmup.take(identity), null);
  assert.equal(warmup.start(identity, async () => ({gasPrice: 8n, gasLimit: 21000n, expiresAt: 5000})), true);
  await flush();
  now = 8000;
  assert.equal(warmup.take(identity), null);

  const balance = 10n ** 18n;
  const low = await nativeBalanceFraction({balance, percent: 100, readGasPrice: async () => 3n * 10n ** 9n, buildTransaction: async amount => ({value: amount}), estimate: async () => 21000n});
  const high = await nativeBalanceFraction({balance, percent: 100, readGasPrice: async () => 30n * 10n ** 9n, buildTransaction: async amount => ({value: amount}), estimate: async () => 21000n});
  assert.equal(low.gasPrice, 3n * 10n ** 9n);
  assert.equal(high.gasPrice, 30n * 10n ** 9n);
  assert.ok(low.reserve > 0n && high.reserve > low.reserve);
  assert.ok(high.amount < low.amount && low.amount < balance);
  assert.equal(low.amount, balanceFraction(balance, 100, low.reserve));
  await assert.rejects(nativeBalanceFraction({balance: 1n, percent: 100, readGasPrice: async () => 10n ** 12n, buildTransaction: async amount => ({value: amount}), estimate: async () => 21000n}), error => error.code === 'NATIVE_GAS_BALANCE');
});

test('active production entry imports the quote and holdings display', () => {
  const manifest = JSON.parse(readFileSync(new URL('./fst-runtime-manifest.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(manifest.entries.app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(manifest.entries.boot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const files = new Map(manifest.files.map(file => [file.path, file]));
  const seen = new Set();
  const reaches = path => {
    if (seen.has(path)) return false;
    seen.add(path);
    const file = files.get(path);
    if (!file) return false;
    if (file.inputs.some(input => input.split('?')[0] === 'src/swap-display.mjs')) return true;
    return file.imports.some(item => !item.external && reaches(item.path));
  };
  assert.equal(reaches(manifest.entries.app), true);
  assert.equal(FSTSWAP_CONFIG.router, '0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7');
  const bundled = manifest.files.map(file => readFileSync(new URL('../' + file.path, import.meta.url), 'utf8')).join('\n');
  assert.equal(bundled.includes('0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7'), true);
  assert.equal(manifest.cacheAssets.find(asset => asset.kind === 'generated-ethers').bytes, 64895);
  validateServiceQuote(wrapQuote({amountIn: 10n ** 18n, out: 10n ** 18n, now: 1_700_000_000_000}), wrapQuote({amountIn: 10n ** 18n, out: 10n ** 18n, now: 1_700_000_000_000}).input, {router: FSTSWAP_CONFIG.router, adapters, clock: () => 1_700_000_000_000, expectedVersion: '2.1.0'});
});
