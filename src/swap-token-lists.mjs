// Token-list data boundary. No DOM or wallet dependencies.
export const TOKEN_CHAIN_ID = 56;
export const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value || '').trim());
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const lower = (value) => value.toLowerCase();

export function normalizeToken(token) {
  if (!record(token) || !Number.isSafeInteger(token.chainId) || token.chainId < 1
      || !isAddress(token.address) || /^0x0{40}$/i.test(token.address.trim())
      || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255
      || !nonempty(token.name) || !nonempty(token.symbol)) throw new Error('invalid token');
  return { ...token, address: token.address.trim(), name: token.name.trim(), symbol: token.symbol.trim() };
}

export function validateTokenList(value) {
  // Some existing FstSwap lists use single-digit months/days. Normalize only that legacy form.
  const timestamp = typeof value?.timestamp === 'string' ? value.timestamp.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})T/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T`) : '';
  if (!record(value) || !nonempty(value.name) || !timestamp || !Number.isFinite(Date.parse(timestamp))
      || !record(value.version) || !['major', 'minor', 'patch'].every(k => Number.isSafeInteger(value.version[k]) && value.version[k] >= 0)
      || !Array.isArray(value.tokens) || value.tokens.length === 0 || value.tokens.length > 10000) throw new Error('invalid list');
  const seen = new Set();
  const tokens = value.tokens.map(token => {
    const t = normalizeToken(token), key = `${t.chainId}:${lower(t.address)}`;
    if (seen.has(key)) throw new Error('duplicate token');
    seen.add(key); return t;
  });
  return { ...value, name: value.name.trim(), timestamp, tokens };
}

export function listSourceUrls(source) {
  const value = String(source || '').trim();
  const decentralized = /^(ipfs|ipns):(?:\/\/)?(.+)$/i.exec(value);
  if (decentralized) {
    const protocol = decentralized[1].toLowerCase();
    const path = decentralized[2].replace(new RegExp(`^${protocol}/`, 'i'), '');
    if (!path || /\s|[?#]/.test(path) || path.startsWith('/')) return [];
    return [`https://cloudflare-ipfs.com/${protocol}/${path}`, `https://ipfs.io/${protocol}/${path}`];
  }
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return [];
    const github = url.hostname === 'github.com' && /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
    if (github) return [`https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}`];
    // Respect the supplied protocol; do not spend 10 seconds trying HTTPS on an HTTP-only source.
    return [url.href];
  } catch { return []; }
}

export function restoreTokenStore(raw, defaultUrl, defaultList) {
  let saved; try { saved = JSON.parse(raw || 'null'); } catch { saved = null; }
  const store = { lists: Object.create(null), custom: [] };
  if (record(saved?.lists)) for (const [url, entry] of Object.entries(saved.lists)) {
    if (!record(entry) || !listSourceUrls(url).length) continue;
    try { store.lists[url] = { list: validateTokenList(entry.list), active: entry.active === true }; } catch { /* Ignore broken records, preserve other entries. */ }
  }
  if (!store.lists[defaultUrl]) store.lists[defaultUrl] = { list: validateTokenList(defaultList), active: saved?.lists?.[defaultUrl]?.active !== false };
  const seen = new Set();
  if (Array.isArray(saved?.custom)) for (const token of saved.custom) {
    try {
      const t = normalizeToken(token), key = lower(t.address);
      if (t.chainId !== TOKEN_CHAIN_ID || seen.has(key)) continue;
      seen.add(key); store.custom.push(t);
    } catch { /* An invalid custom token cannot prevent the app from starting. */ }
  }
  return store;
}

export function activeEntries(store) {
  const out = new Map();
  for (const { list, active } of Object.values(store.lists)) {
    if (!active) continue;
    for (const token of list.tokens) if (token.chainId === TOKEN_CHAIN_ID && !out.has(lower(token.address))) {
      out.set(lower(token.address), { ...token, listName: list.name, userAdded: false });
    }
  }
  for (const token of store.custom) if (!out.has(lower(token.address))) out.set(lower(token.address), { ...token, userAdded: true });
  return [...out.values()];
}

export function addCustomEntry(store, value) {
  const token = normalizeToken(value);
  if (token.chainId !== TOKEN_CHAIN_ID) throw new Error('Wrong chain');
  if (!store.custom.some(t => lower(t.address) === lower(token.address))) store.custom.push(token);
}

export function removeCustomEntry(store, address) {
  store.custom = address == null ? [] : store.custom.filter(t => lower(t.address) !== lower(address));
}

export function removeListEntry(store, url, defaultUrl) {
  // The built-in fallback can be switched off; keeping it prevents reload from resurrecting a deleted list.
  if (url === defaultUrl) return false;
  delete store.lists[url]; return true;
}
