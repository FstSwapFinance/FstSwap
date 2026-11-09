import test from "node:test";
import assert from "node:assert/strict";
import { createMarketDataClient } from "../swap-market-data.mjs";

const payload = { data: { attributes: { ohlcv_list: [[1, 2, 3, 1, 2, 8]] } } };
const response = (body = payload) => ({ ok: true, json: async () => body });

test("concurrent views share one request and fresh data avoids another request", async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createMarketDataClient({ fetchImpl: async () => { calls++; await gate; return response(); } });
  const a = client.read('/pools/a/ohlcv/hour');
  const b = client.read('/pools/a/ohlcv/hour');
  release();
  const [one, two] = await Promise.all([a, b]);
  assert.deepEqual(one.body, payload);
  assert.deepEqual(two.body, payload);
  assert.deepEqual((await client.read('/pools/a/ohlcv/hour')).body, payload);
  assert.equal(calls, 1);
});

test("expired data refreshes while a failed refresh preserves the last good result", async () => {
  let clock = 1000, fail = false;
  const client = createMarketDataClient({ now: () => clock, fetchImpl: async () => {
    if (fail) return { ok: false, status: 503, headers: new Headers() };
    return response();
  } });
  await client.read('/pools/a/trades', { ttl: 100 });
  clock = 1200; fail = true;
  await assert.rejects(client.read('/pools/a/trades', { ttl: 100 }), /503/);
  assert.deepEqual(client.peek('/pools/a/trades').body, payload);
  assert.equal(client.peek('/pools/a/trades').fetchedAt, 1000);
  clock = 700000;
  assert.equal(client.peek('/pools/a/trades'), null);
});

test("cache survives a reload and isolates each pool and interval", async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const first = createMarketDataClient({ storage, now: () => 1000, fetchImpl: async () => response() });
  await first.read('/pools/a/ohlcv/hour');
  const next = createMarketDataClient({ storage, now: () => 1100, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual((await next.read('/pools/a/ohlcv/hour')).body, payload);
  assert.equal(next.peek('/pools/b/ohlcv/hour'), null);
  assert.equal(next.peek('/pools/a/ohlcv/minute'), null);
});

test("rate limits are not cached as data and repeated clicks respect retry-after", async () => {
  let clock = 1000, calls = 0;
  const client = createMarketDataClient({ now: () => clock, fetchImpl: async () => {
    calls++;
    return { ok: false, status: 429, headers: new Headers({ 'Retry-After': '30' }) };
  } });
  await assert.rejects(client.read('/pools/a/trades'), /429/);
  await assert.rejects(client.read('/pools/a/trades'), /429/);
  assert.equal(calls, 1);
  assert.equal(client.peek('/pools/a/trades'), null);
  clock = 32000;
  await assert.rejects(client.read('/pools/a/trades'), /429/);
  assert.equal(calls, 2);
});

test("malformed API responses and unavailable storage do not poison the cache", async () => {
  let bad = true;
  const storage = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('full'); } };
  const client = createMarketDataClient({ storage, fetchImpl: async () => response(bad ? { errors: ['Unavailable'] } : payload) });
  await assert.rejects(client.read('/pools/a/trades'), /Invalid/);
  assert.equal(client.peek('/pools/a/trades'), null);
  bad = false;
  assert.deepEqual((await client.read('/pools/a/trades')).body, payload);
});
