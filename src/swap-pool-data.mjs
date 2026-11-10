export const FST_ROUTER = '0x1B6C9c20693afDE803B27F8782156c0f892ABC2d';
export const FST_WBNB = '0x0efb5FD2402A0967B92551d6AF54De148504A115';
const ABI = ['function factory() view returns(address)', 'function getPair(address,address) view returns(address)',
  'function token0() view returns(address)', 'function token1() view returns(address)'];
const lower = value => value.toLowerCase();
export async function discoverPool(request, a, b) {
  if (!a || !b || a.key === b.key) return null;
  const addressOf = token => token.key === 'bnb' ? FST_WBNB : token.address;
  const addresses = [addressOf(a), addressOf(b)];
  if (addresses.some(address => !/^0x[0-9a-f]{40}$/i.test(address || '')) || lower(addresses[0]) === lower(addresses[1])) return null;
  const codec = new globalThis.ethers.Interface(ABI);
  const call = async (to, method, args = []) => codec.decodeFunctionResult(method,
    await request({method:'eth_call',params:[{to,data:codec.encodeFunctionData(method,args)},'latest']}))[0];
  const factory = await call(FST_ROUTER, 'factory');
  const pair = await call(factory, 'getPair', addresses);
  if (/^0x0{40}$/i.test(pair)) return null;
  const [token0, token1] = await Promise.all([call(pair, 'token0'), call(pair, 'token1')]);
  if (![token0,token1].every(t => addresses.some(a => lower(a) === lower(t))) || lower(token0) === lower(token1)) throw new Error('池子代币与所选币对不一致');
  return { id:lower(pair), keys:[a.key,b.key], tokenA:a.symbol, tokenB:b.symbol, pair, token0, token1, native:a.key === 'bnb' || b.key === 'bnb' };
}

export function reservesByToken(pool, r0, r1, totalSupply) {
  return {reserves: {[lower(pool.token0)]: r0, [lower(pool.token1)]: r1}, totalSupply};
}
