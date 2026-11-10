// Read-only pool analysis. These pools never enter swap routing or price selection.
import { discoverPool, FST_WBNB } from './swap-pool-data.mjs';

export const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
export const analysisPrice = value => Number.isFinite(value) && value > 0 ? String(Number(value.toPrecision(6))) : '—';
const lower = v => String(v || '').toLowerCase();
export const isPoolAddress = v => /^0x[0-9a-f]{40}$/i.test(v || '');
const relation = (row, side) => lower(row?.relationships?.[side + '_token']?.data?.id).replace(/^bsc_/, '');
export const matchesAnalysisToken = (token, address) => token?.native || token?.key === 'bnb'
  ? [WBNB, lower(FST_WBNB)].includes(lower(address)) : lower(token?.address) === lower(address);
export function matchesAnalysisPair(a, b, x, y) {
  return lower(x) !== lower(y) && ((matchesAnalysisToken(a, x) && matchesAnalysisToken(b, y))
    || (matchesAnalysisToken(a, y) && matchesAnalysisToken(b, x)));
}
export function analysisPoolFromMarket(row, a, b) {
  const at = row?.attributes, token0 = relation(row, 'base'), token1 = relation(row, 'quote');
  if (!isPoolAddress(at?.address) || !isPoolAddress(token0) || !isPoolAddress(token1)
    || !matchesAnalysisPair(a, b, token0, token1)) return null;
  return { pair: lower(at.address), token0, token1, dex: row.relationships?.dex?.data?.id || 'DEX',
    reserveUsd: Math.max(0, Number(at.reserve_in_usd) || 0), market: row };
}
export async function discoverAnalysisPools(request, a, b, market, discover = discoverPool) {
  const addresses = [...new Set([a, b].filter(t => !t.native && t.key !== 'bnb').map(t => lower(t.address)))];
  if (!addresses.length) addresses.push(WBNB);
  const results = await Promise.allSettled([
    discover(request, a, b),
    ...addresses.map(address => market.read(`/tokens/${address}/pools?page=1`)),
  ]);
  const found = new Map();
  for (const result of results.slice(1)) {
    if (result.status !== 'fulfilled') continue;
    for (const row of result.value.body?.data || []) {
      const pool = analysisPoolFromMarket(row, a, b);
      if (pool) found.set(pool.pair, pool);
    }
  }
  const fst = results[0].status === 'fulfilled' ? results[0].value : null;
  if (fst) found.set(lower(fst.pair), { ...fst, ...found.get(lower(fst.pair)), dex: 'FstSwap V2', feeRate: .003 });
  return { pools: [...found.values()].sort((a, b) => (b.reserveUsd || 0) - (a.reserveUsd || 0)),
    incomplete: results.some(r => r.status === 'rejected') };
}
const ABI = ['function token0() view returns(address)', 'function token1() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)', 'function totalSupply() view returns(uint256)',
  'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)', 'function fee() view returns(uint24)',
  'function balanceOf(address) view returns(uint256)'];
export async function readAnalysisPool(request, pool, a, b) {
  const codec = new globalThis.ethers.Interface(ABI);
  const call = async (to, name, args = []) => codec.decodeFunctionResult(name,
    await request({ method: 'eth_call', params: [{ to, data: codec.encodeFunctionData(name, args) }, 'latest'] }));
  const [[token0], [token1]] = await Promise.all([call(pool.pair, 'token0'), call(pool.pair, 'token1')]);
  if (!matchesAnalysisPair(a, b, token0, token1)) throw Error('Pool token mismatch');
  const tokens = [token0, token1].map(address => ({ ...(matchesAnalysisToken(a, address) ? a : b), poolAddress: address }));
  try {
    const [[r0, r1], [totalSupply]] = await Promise.all([call(pool.pair, 'getReserves'), call(pool.pair, 'totalSupply')]);
    return { ...pool, token0, token1, tokens, reserves: [r0, r1], totalSupply, kind: 'v2' };
  } catch {
    const [[sqrtPrice], [fee], [r0], [r1]] = await Promise.all([
      call(pool.pair, 'slot0'), call(pool.pair, 'fee'), call(token0, 'balanceOf', [pool.pair]), call(token1, 'balanceOf', [pool.pair]),
    ]);
    return { ...pool, token0, token1, tokens, reserves: [r0, r1], kind: 'v3', feeRate: Number(fee) / 1e6,
      price1Per0: (Number(sqrtPrice) / 2 ** 96) ** 2 * 10 ** (tokens[0].decimals - tokens[1].decimals) };
  }
}
export function analysisStats(row, tokens, feeRate) {
  const at = row?.attributes || {}, volume = Number(at.volume_usd?.h24);
  const vols = tokens.map(t => {
    const side = lower(t.poolAddress) === relation(row, 'base') ? 'base' : lower(t.poolAddress) === relation(row, 'quote') ? 'quote' : null;
    const price = side ? Number(at[side + '_token_price_usd']) : NaN;
    return Number.isFinite(volume) && price > 0 ? volume / 2 / price : null;
  });
  return [...vols, ...vols.map(v => v != null && feeRate != null ? v * feeRate : null)];
}
export function analysisTrade(attributes, tokens) {
  const a = attributes || {}, from = tokens.findIndex(t => lower(t.poolAddress) === lower(a.from_token_address));
  const to = tokens.findIndex(t => lower(t.poolAddress) === lower(a.to_token_address));
  if (from < 0 || to < 0 || from === to || !/^0x[0-9a-f]{64}$/i.test(a.tx_hash || '')) return null;
  return { from: tokens[from].symbol, to: tokens[to].symbol,
    amounts: tokens.map((_, i) => i === from ? a.from_token_amount : a.to_token_amount),
    hash: a.tx_hash, account: isPoolAddress(a.tx_from_address) ? a.tx_from_address : '', time: a.block_timestamp };
}
export const analysisKlinePath = (pair, iv, token) => `/pools/${lower(pair)}/ohlcv/${iv.tf}?aggregate=${iv.agg}&limit=${Math.min(1000, 300 * iv.merge)}&currency=token&token=${lower(token)}`;
