import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadPool} from './swap-read-pool.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function response(id, result) {
  return new Response(JSON.stringify({jsonrpc:'2.0', id, result}), {status:200, headers:{'content-type':'application/json'}});
}
function block() {
  return {number:'0x10', hash:'0x' + '11'.repeat(32), timestamp:'0x' + Math.floor(Date.now() / 1000).toString(16)};
}

// Measured before this change, with the same 900ms primary and 30ms backup:
// a balance read stayed on the slow node for 3635ms and made 4 serial calls.
// A 25ms primary finished in 102ms and did not need the backup.
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

test('a slow balance node yields to a fast node without waiting for the full timeout', async () => {
  const {seen, pool} = poolFor(900);
  const started = Date.now();
  const hash = await balanceRead(pool);
  const elapsed = Date.now() - started;
  assert.equal(hash, '0x' + '11'.repeat(32));
  assert.equal(seen.some(url => url.endsWith('/fast')), true);
  assert.ok(elapsed < 800, 'slow-node balance took ' + elapsed + 'ms; previous measured run was 3635ms');
});

test('a slow quote attempt yields to a fast node and keeps that node block hash', async () => {
  const {seen, pool} = poolFor(900);
  const started = Date.now();
  const hash = await pool.run(async request => {
    const header = await request({method:'eth_getBlockByNumber', params:['latest', false]});
    await request({method:'eth_call', params:[{to:'0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7', data:'0x'}, header.number]});
    const canonical = await request({method:'eth_getBlockByNumber', params:[header.number, false]});
    if (canonical.hash !== header.hash) throw Object.assign(new Error('STALE_BLOCK'), {code:'STALE_BLOCK'});
    return canonical.hash;
  }, undefined, {operation:'quote', hedge:true});
  const elapsed = Date.now() - started;
  assert.equal(hash, '0x' + '11'.repeat(32));
  assert.equal(seen.some(url => url.endsWith('/fast')), true);
  assert.ok(elapsed < 800, 'slow-node quote took ' + elapsed + 'ms');
});
