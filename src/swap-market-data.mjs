const BASE = "https://api.geckoterminal.com/api/v2/networks/bsc";
const STORAGE_KEY = "fst_market_cache_v1";
const MAX_AGE = 10 * 60_000;
const MAX_ENTRIES = 24;

// 只缓存公开行情，不用于兑换报价、授权或交易校验。
export function createMarketDataClient({ fetchImpl = globalThis.fetch, now = Date.now, storage } = {}) {
  const cache = new Map(), pending = new Map();
  let limitedUntil = 0;
  const valid = entry => entry && Number.isFinite(entry.fetchedAt) && entry.fetchedAt <= now()
    && now() - entry.fetchedAt < MAX_AGE && entry.body?.data != null;
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) for (const [path, entry] of saved.slice(-MAX_ENTRIES)) {
      if (typeof path === "string" && valid(entry)) cache.set(path, entry);
    }
  } catch {}
  const peek = path => valid(cache.get(path)) ? cache.get(path) : null;
  async function read(path, { ttl = 60_000 } = {}) {
    const cached = peek(path);
    if (cached && now() - cached.fetchedAt < ttl) return cached;
    if (pending.has(path)) return pending.get(path);
    if (now() < limitedUntil) throw new Error("Market data HTTP 429");
    const task = (async () => {
      const res = await fetchImpl(BASE + path, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
      if (!res.ok) {
        if (res.status === 429) {
          const retry = Number(res.headers?.get("Retry-After"));
          limitedUntil = now() + (retry > 0 ? Math.min(retry, 300) : 60) * 1000;
        }
        throw new Error(`Market data HTTP ${res.status}`);
      }
      const body = await res.json();
      if (body?.data == null || body.errors) throw new Error("Invalid market data response");
      const entry = { body, fetchedAt: now() };
      cache.delete(path); cache.set(path, entry);
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify([...cache].filter(([, value]) => valid(value)))); } catch {}
      return entry;
    })();
    pending.set(path, task);
    try { return await task; } finally { pending.delete(path); }
  }
  return { peek, read };
}

let session;
try { session = globalThis.sessionStorage; } catch {}
export const marketData = createMarketDataClient({ storage: session });
