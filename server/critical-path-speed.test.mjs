import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {createReadPool} from './swap-read-pool.mjs';
import {createEngine} from './fstswap-service.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function response(id, result) {
  return new Response(JSON.stringify({jsonrpc:'2.0', id, result}), {status:200, headers:{'content-type':'application/json'}});
}
function block() {
  return {number:'0x10', hash:'0x' + '11'.repeat(32), timestamp:'0x' + Math.floor(Date.now() / 1000).toString(16)};
}

function poolFor(primaryDelay) {
  const seen = [];
  const fetchImpl = async (url, {body, signal}) => {
    const request = JSON.parse(body);
    seen.push(url);
    const delay = url.endsWith('/slow') ? primaryDelay : 30;
    await Promise.race([
      sleep(delay),
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name:'AbortError'})), {once:true})),
    ]);
    if (signal.aborted) throw Object.assign(new Error('aborted'), {name:'AbortError'});
    if (request.method === 'eth_chainId') return response(request.id, '0x38');
    if (request.method === 'eth_getBlockByNumber') return response(request.id, block());
    return response(request.id, '0x1');
  };
  return {seen, pool:createReadPool(['http://rpc/slow', 'http://rpc/fast'], {fetchImpl, timeoutMs:2500, clock:Date.now})};
}

async function balanceRead(pool) {
  return pool.run(async request => {
    const header = await request({method:'eth_getBlockByNumber', params:['latest', false]});
    await request({method:'eth_call', params:[{to:'0x55d398326f99059ff775485246999027b3197955', data:'0x70a08231'}, header.number]});
    const canonical = await request({method:'eth_getBlockByNumber', params:[header.number, false]});
    if (canonical.hash !== header.hash) throw Object.assign(new Error('STALE_BLOCK'), {code:'STALE_BLOCK'});
    return header.hash;
  }, undefined, {operation:'balances'});
}

test('a fast balance node is not duplicated and still rechecks its block', async () => {
  const {seen, pool} = poolFor(5);
  const started = Date.now();
  const hash = await balanceRead(pool);
  const elapsed = Date.now() - started;
  assert.equal(hash, '0x' + '11'.repeat(32));
  assert.equal(seen.some(url => url.endsWith('/fast')), false);
  assert.equal(seen.filter(url => url.endsWith('/slow')).length, 4);
  assert.ok(elapsed < 250, 'fast balance took ' + elapsed + 'ms');
});

test('quote and balance work does not start a backup inside the cold hedge window', async () => {
  const seen = [];
  const fetchImpl = async (url, {body, signal}) => {
    const request = JSON.parse(body);
    seen.push(url);
    if (url.endsWith('/slow')) {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name:'AbortError'})), {once:true}));
      throw Object.assign(new Error('aborted'), {name:'AbortError'});
    }
    await sleep(20);
    if (request.method === 'eth_chainId') return response(request.id, '0x38');
    return response(request.id, block());
  };
  const pool = createReadPool(['http://rpc/slow', 'http://rpc/fast'], {fetchImpl, timeoutMs:5000, clock:Date.now});
  const controller = new AbortController();
  const pending = pool.run(request => request({method:'eth_call', params:[{to:'0x55d398326f99059ff775485246999027b3197955', data:'0x'}, 'latest']}), controller.signal, {operation:'balances', hedge:true});
  pending.catch(() => {});
  await sleep(400);
  assert.equal(seen.some(url => url.endsWith('/fast')), false);
  controller.abort();
  await pending.catch(() => {});
});

const account = '0x1111111111111111111111111111111111111111';
const usdt = '0x55d398326f99059ff775485246999027b3197955';
const codec = new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])', 'function balanceOf(address) view returns(uint256)']);
function header(hash = '0x' + 'ab'.repeat(32)) {
  return {number:'0x10', hash, timestamp:'0x' + Math.floor(Date.now() / 1000).toString(16)};
}
function balanceBody() {
  return codec.encodeFunctionResult('tryAggregate', [[{success:true, returnData:codec.encodeFunctionResult('balanceOf', [123n])}]]);
}

test('a balance read batches its call with the canonical hash and still rejects a changed block', async () => {
  const bodies = [];
  const delay = 80;
  const fetchImpl = async (url, {body, signal}) => {
    const parsed = JSON.parse(body);
    bodies.push(parsed);
    await new Promise(resolve => setTimeout(resolve, delay));
    if (signal.aborted) throw Object.assign(new Error('aborted'), {name:'AbortError'});
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const result = rows.map(row => {
      if (row.method === 'eth_chainId') return {jsonrpc:'2.0', id:row.id, result:'0x38'};
      if (row.method === 'eth_getBlockByNumber') return {jsonrpc:'2.0', id:row.id, result:header(row.params[0] === 'latest' ? '0x' + 'ab'.repeat(32) : '0x' + 'ab'.repeat(32))};
      if (row.method === 'eth_call') return {jsonrpc:'2.0', id:row.id, result:balanceBody()};
      return {jsonrpc:'2.0', id:row.id, error:{message:'no'}};
    });
    return new Response(JSON.stringify(Array.isArray(parsed) ? result : result[0]), {status:200, headers:{'content-type':'application/json'}});
  };
  const pool = createReadPool(['https://rpc.invalid/one'], {fetchImpl, timeoutMs:2000, clock:Date.now});
  await pool.run(() => true);
  const engine = createEngine(pool, {warmup:{enabled:false}, clock:Date.now});
  bodies.length = 0;
  const started = Date.now();
  const value = await engine.balances({chainId:56, account, tokens:[usdt]});
  const elapsed = Date.now() - started;
  assert.equal(value.balances[usdt], '123');
  assert.equal(value.blockHash, '0x' + 'ab'.repeat(32));
  assert.equal(bodies.filter(body => Array.isArray(body)).length, 1);
  assert.deepEqual(bodies.find(body => Array.isArray(body)).map(row => row.method), ['eth_call', 'eth_getBlockByNumber']);
  assert.equal(bodies.length, 2);
  // Two 80ms round trips. The previous separate call and hash recheck were three.
  assert.ok(elapsed < 230, 'batched balance took ' + elapsed + 'ms');
});

test('a changed canonical hash is not returned as a balance', async () => {
  const fetchImpl = async (_url, {body}) => {
    const parsed = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const result = rows.map(row => {
      if (row.method === 'eth_chainId') return {jsonrpc:'2.0', id:row.id, result:'0x38'};
      if (row.method === 'eth_getBlockByNumber') {
        const hash = row.params[0] === 'latest' ? '0x' + 'ab'.repeat(32) : '0x' + 'cd'.repeat(32);
        return {jsonrpc:'2.0', id:row.id, result:header(hash)};
      }
      return {jsonrpc:'2.0', id:row.id, result:balanceBody()};
    });
    return new Response(JSON.stringify(Array.isArray(parsed) ? result : result[0]), {status:200, headers:{'content-type':'application/json'}});
  };
  const pool = createReadPool(['https://rpc.invalid/one'], {fetchImpl, timeoutMs:2000, clock:Date.now});
  const engine = createEngine(pool, {warmup:{enabled:false}, clock:Date.now});
  await assert.rejects(engine.balances({chainId:56, account, tokens:[usdt]}), error => error.code === 'STALE_BLOCK');
});

test('a node that rejects batches falls back to serial reads and is not asked to batch again', async () => {
  const bodies = [];
  const fetchImpl = async (_url, {body}) => {
    const parsed = JSON.parse(body);
    bodies.push(parsed);
    if (Array.isArray(parsed)) return new Response('', {status:400});
    const row = parsed;
    const result = row.method === 'eth_chainId' ? '0x38' : row.method === 'eth_getBlockByNumber' ? header() : balanceBody();
    return new Response(JSON.stringify({jsonrpc:'2.0', id:row.id, result}), {status:200, headers:{'content-type':'application/json'}});
  };
  const pool = createReadPool(['https://rpc.invalid/one'], {fetchImpl, timeoutMs:2000, clock:Date.now});
  const engine = createEngine(pool, {warmup:{enabled:false}, clock:Date.now});
  const first = await engine.balances({chainId:56, account, tokens:[usdt]});
  assert.equal(first.balances[usdt], '123');
  const batches = bodies.filter(body => Array.isArray(body)).length;
  assert.equal(batches, 1);
  bodies.length = 0;
  const second = await engine.balances({chainId:56, account, tokens:[usdt]});
  assert.equal(second.balances[usdt], '123');
  assert.equal(bodies.some(body => Array.isArray(body)), false);
  assert.equal(pool.health().providers[0].failures, 0);
});
