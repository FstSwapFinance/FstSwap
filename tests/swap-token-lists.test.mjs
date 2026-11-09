import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTokenList, restoreTokenStore, activeEntries, listSourceUrls, normalizeToken, addCustomEntry, removeCustomEntry, removeListEntry } from '../swap-token-lists.mjs';

const usdt = { chainId: 56, address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 };
const fist = { chainId: 56, address: '0xc9882def23bc42d53895b8361d0b1edc7570bc6a', symbol: 'FIST', name: 'FstSwap', decimals: 6 };
const list = (tokens = [usdt, fist]) => ({ name: 'FSTSWAP', timestamp: '2026-11-10T00:00:00Z', version: { major: 1, minor: 0, patch: 0 }, tokens });
const url = 'http://localhost:8124/tokens.json?v1';

test('valid mixed-chain lists retain metadata and only BSC tokens become selectable', () => {
  const imported = validateTokenList(list([usdt, { ...fist, chainId: 97 }]));
  assert.equal(imported.tokens.length, 2);
  assert.deepEqual(activeEntries({ lists: { [url]: { list: imported, active: true } }, custom: [] }).map(t => t.symbol), ['USDT']);
});

test('malformed token metadata is rejected before import', () => {
  for (const patch of [{ address: '0x123' }, { address: '0x' + '0'.repeat(40) }, { chainId: '56' }, { decimals: '18' }, { decimals: -1 }, { decimals: 256 }, { decimals: 1.5 }, { symbol: '' }, { name: null }]) {
    assert.throws(() => validateTokenList(list([{ ...usdt, ...patch }])));
  }
  assert.equal(normalizeToken({ ...usdt, decimals: 0 }).decimals, 0);
});

test('list structure and version are required; duplicate chain/address entries are rejected', () => {
  for (const patch of [{ name: '' }, { timestamp: 'invalid' }, { version: { major: 1 } }, { tokens: null }, { tokens: [] }]) {
    assert.throws(() => validateTokenList({ ...list(), ...patch }));
  }
  assert.throws(() => validateTokenList(list([usdt, { ...usdt, address: usdt.address.toUpperCase().replace('0X', '0x') }])));
  assert.equal(validateTokenList(list([usdt, { ...usdt, chainId: 97 }])).tokens.length, 2);
});

test('corrupt browser state recovers the default list without blanking the app', () => {
  for (const raw of ['{', 'null', '[]', '{"lists":[],"custom":{}}', '{"lists":{"broken":null},"custom":[null,{}]}']) {
    const restored = restoreTokenStore(raw, url, list());
    assert.deepEqual(activeEntries(restored).map(t => t.symbol), ['USDT', 'FIST']);
  }
});

test('restoration preserves disabled lists and valid custom tokens, deduplicates and rejects other chains', () => {
  const state = { lists: { [url]: { list: list(), active: false }, bad: { list: {}, active: true } }, custom: [fist, { ...fist }, { ...usdt, chainId: 97 }, null] };
  const restored = restoreTokenStore(JSON.stringify(state), url, list());
  assert.equal(restored.lists[url].active, false);
  assert.equal(restored.custom.length, 1);
  assert.deepEqual(activeEntries(restored).map(t => [t.symbol, t.userAdded]), [['FIST', true]]);
});

test('enabled lists win duplicate addresses; custom tokens remain when their list is disabled', () => {
  const state = { lists: { [url]: { list: list(), active: true } }, custom: [fist] };
  assert.equal(activeEntries(state).length, 2);
  assert.equal(activeEntries(state)[1].userAdded, false);
  state.lists[url].active = false;
  assert.equal(activeEntries(state)[0].userAdded, true);
});

test('source URLs preserve query strings and IPFS file paths and reject unsupported sources', () => {
  assert.deepEqual(listSourceUrls(' http://localhost:8127/test.json?q=1 '), ['http://localhost:8127/test.json?q=1']);
  assert.deepEqual(listSourceUrls('https://example.com/list.json?a=1&b=2'), ['https://example.com/list.json?a=1&b=2']);
  assert.ok(listSourceUrls('ipfs://ipfs/QmTest/list.json').every(u => u.endsWith('/ipfs/QmTest/list.json')));
  for (const source of ['', 'https://', 'foo.eth', 'javascript:alert(1)', 'https://user:password@example.com/list.json', 'ipfs://']) assert.deepEqual(listSourceUrls(source), []);
});

test('FstSwap legacy timestamps and Chinese symbols remain importable', () => {
  const value = { ...list([{ ...fist, name: '吉祥小马', symbol: '吉祥小马' }]), timestamp: '2022-3-1T23:20:45.887Z' };
  assert.equal(validateTokenList(value).timestamp, '2022-03-01T23:20:45.887Z');
});

test('GitHub blob links resolve to the same raw JSON source', () => {
  assert.deepEqual(listSourceUrls('https://github.com/FstSwapFinance/FstSwap/blob/main/tokens.json'), ['https://raw.githubusercontent.com/FstSwapFinance/FstSwap/main/tokens.json']);
});

test('custom-token add, remove and clear survive persistence without affecting list tokens', () => {
  let store = restoreTokenStore(null, url, list());
  addCustomEntry(store, fist); addCustomEntry(store, { ...fist, address: fist.address.toUpperCase().replace('0X', '0x') });
  addCustomEntry(store, usdt);
  assert.equal(store.custom.length, 2);
  assert.throws(() => addCustomEntry(store, { ...usdt, chainId: 97 }));
  removeCustomEntry(store, fist.address);
  store = restoreTokenStore(JSON.stringify(store), url, list());
  assert.deepEqual(store.custom.map(t => t.symbol), ['USDT']);
  assert.equal(activeEntries(store).length, 2);
  removeCustomEntry(store);
  assert.equal(restoreTokenStore(JSON.stringify(store), url, list()).custom.length, 0);
});

test('removing an imported list persists while the built-in fallback remains switchable', () => {
  const source = 'https://example.com/tokens.json', store = restoreTokenStore(null, url, list());
  store.lists[source] = { list: list(), active: true };
  assert.equal(removeListEntry(store, url, url), false);
  assert.equal(removeListEntry(store, source, url), true);
  store.lists[url].active = false;
  const restored = restoreTokenStore(JSON.stringify(store), url, list());
  assert.equal(restored.lists[source], undefined);
  assert.equal(activeEntries(restored).length, 0);
});
