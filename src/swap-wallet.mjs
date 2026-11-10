// Swap 页钱包连接（BSC 主网 56）：注入式钱包（MetaMask/OKX/TP 等）+
// WalletConnect（复用 walletconnect.json 的 projectId 与 vendor bundle）。
export const SWAP_CHAIN = Object.freeze({
  chainId: 56,
  hex: "0x38",
  name: "BNB Smart Chain Mainnet",
  rpc: "https://fast.bsc-rpc.com",
  explorer: "https://bscscan.com",
  native: { name: "BNB", symbol: "BNB", decimals: 18 },
});

export function walletShort(account) {
  return typeof account === "string" && account.length >= 10
    ? account.slice(0, 6) + "…" + account.slice(-4) : "";
}

const announced = [];
const RDNS = { metamask: ['io.metamask'], okx: ['com.okex.wallet', 'com.okx.wallet'],
  binance: ['com.binance.wallet'], tokenpocket: ['pro.tokenpocket'], coinbase: ['com.coinbase.wallet'] };
globalThis.addEventListener?.('eip6963:announceProvider', ({ detail }) => {
  if (typeof detail?.provider?.request === 'function' && !announced.some(p => p.provider === detail.provider)) announced.push(detail);
});
export function discoverWallets() {
  if (globalThis.dispatchEvent && globalThis.Event) globalThis.dispatchEvent(new Event('eip6963:requestProvider'));
}
discoverWallets();

// A named button must select that wallet even when several extensions coexist.
export function injectedProvider(brand = 'injected', scope = globalThis, discovered = announced) {
  const direct = { okx: scope.okxwallet?.ethereum || scope.okxwallet,
    binance: scope.binancew3w?.ethereum || scope.binancew3w || scope.binancew3?.ethereum || scope.binance,
    coinbase: scope.coinbaseWalletExtension, tokenpocket: scope.tokenpocket?.ethereum };
  const valid = p => typeof p?.request === 'function';
  if (valid(direct[brand])) return direct[brand];
  const match = discovered.find(p => RDNS[brand]?.includes(p.info?.rdns) && valid(p.provider));
  if (match) return match.provider;
  const candidates = [...(scope.ethereum?.providers || []), scope.ethereum, ...Object.values(direct), ...discovered.map(p => p.provider)].filter(valid);
  const flags = { okx: p => p.isOkxWallet || p.isOKExWallet, binance: p => p.isBinance,
    tokenpocket: p => p.isTokenPocket, coinbase: p => p.isCoinbaseWallet,
    metamask: p => p.isMetaMask && !p.isTokenPocket && !p.isOkxWallet && !p.isOKExWallet && !p.isBinance && !p.isCoinbaseWallet };
  return brand === 'injected' ? candidates[0] : candidates.find(flags[brand] || (() => false));
}

export async function connectInjected(brand = 'injected') {
  discoverWallets();
  const provider = injectedProvider(brand);
  if (!provider) throw Object.assign(new Error('未检测到所选钱包'), { code: 'NO_WALLET' });
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts?.length) throw Object.assign(new Error('钱包未返回账户'), { code: 'NO_ACCOUNT' });
  if (!await ensureMainnet(provider)) throw Object.assign(new Error('请切换到 BSC 主网'), { code: 'WRONG_CHAIN' });
  return { provider, account: accounts[0], kind: 'injected', brand };
}

// Silent restoration never requests permissions, switches networks or signs.
export async function restoreInjected(brand = 'injected') {
  discoverWallets();
  const provider = injectedProvider(brand);
  if (!provider) return null;
  try {
    const [accounts, chain] = await Promise.all([provider.request({method:'eth_accounts'}), provider.request({method:'eth_chainId'})]);
    return accounts?.[0] && Number(chain) === 56 ? {provider, account:accounts[0], kind:'injected', brand} : null;
  } catch { return null; }
}

export function walletAppLink(brand, uri) {
  if (typeof uri !== 'string' || !uri.startsWith('wc:')) return null;
  const encoded = encodeURIComponent(uri);
  return ({binance: 'bnc://app.binance.com/cedefi/wc?uri=', okx: 'okex://main/wc?uri=',
    tokenpocket: 'tpoutside://wc?uri=', metamask: 'https://metamask.app.link/wc?uri=',
    coinbase: 'https://go.cb-w.com/wc?uri='})[brand]?.concat(encoded) || null;
}

/// 切换到 BSC 主网；失败时尝试 addEthereumChain 后再切。
export async function ensureMainnet(provider) {
  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    if (chainId === SWAP_CHAIN.hex) return true;
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SWAP_CHAIN.hex }] });
  } catch (switchError) {
    if (Number(switchError?.code) !== 4902) return false;
    try {
      await provider.request({ method: "wallet_addEthereumChain", params: [{
        chainId: SWAP_CHAIN.hex, chainName: SWAP_CHAIN.name,
        nativeCurrency: SWAP_CHAIN.native,
        rpcUrls: [SWAP_CHAIN.rpc], blockExplorerUrls: [SWAP_CHAIN.explorer],
      }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SWAP_CHAIN.hex }] });
    } catch { return false; }
  }
  try { return await provider.request({ method: "eth_chainId" }) === SWAP_CHAIN.hex; } catch { return false; }
}

const wcProviderPromises = new Map();
/// WalletConnect 会话式连接（chain 56 专用，不影响测试网配置）。
export async function loadSwapWalletConnect({ storagePrefix = "" } = {}) {
  if (!wcProviderPromises.has(storagePrefix)) {
    const promise = (async () => {
      const response = await fetch("./assets/data/walletconnect.json", { cache: "no-cache", signal: AbortSignal.timeout(8000) });
      const config = response.ok ? await response.json() : null;
      const projectId = typeof config?.projectId === "string" ? config.projectId.trim() : "";
      // Project ID 是服务端标识，是否有效交由 WalletConnect 校验，避免前端按长度误拦截。
      if (!projectId) {
        throw Object.assign(new Error("WalletConnect Project ID is missing"), { code: "WC_NOT_CONFIGURED" });
      }
      const { EthereumProvider } = await import("../assets/vendor/walletconnect/ethereum-provider-UMLN347C.js");
      return EthereumProvider.init({
        projectId,
        ...(storagePrefix ? { customStoragePrefix: storagePrefix } : {}),
        showQrModal: false,
        optionalChains: [SWAP_CHAIN.chainId],
        optionalMethods: ["eth_sendTransaction", "personal_sign"],
        optionalEvents: ["accountsChanged", "chainChanged"],
        rpcMap: { [SWAP_CHAIN.chainId]: SWAP_CHAIN.rpc }, // BSC read RPC; signing/sending stays in the paired wallet
        metadata: {
          name: "FstSwap Aggregator", description: "FstSwap · BSC Mainnet Aggregated Swap", url: location.origin,
        },
      });
    })().catch((err) => { wcProviderPromises.delete(storagePrefix); throw err; });
    wcProviderPromises.set(storagePrefix, promise);
  }
  return wcProviderPromises.get(storagePrefix);
}

/// WalletConnect 已配对会话的账户；无会话/网络不符返回 null。
export async function walletConnectAccount(provider) {
  if (!provider?.session) return null;
  try {
    const [chain, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    const account = accounts?.[0];
    const approved = Object.values(provider.session?.namespaces ?? {}).some((namespace) =>
      namespace.methods?.includes("eth_sendTransaction") && namespace.accounts?.some((entry) =>
        entry.toLowerCase() === `eip155:${SWAP_CHAIN.chainId}:${account?.toLowerCase()}`));
    return Number(chain) === SWAP_CHAIN.chainId && approved ? account : null;
  } catch { return null; }
}

/// 配对 WalletConnect（返回 provider，UI 负责展示二维码）。
export async function connectWalletConnect(onUri) {
  const provider = await loadSwapWalletConnect();
  await provider.connect({ pairings: [], optionalNamespaces: { eip155: { chains: [`eip155:${SWAP_CHAIN.chainId}`],
    methods: ["eth_sendTransaction", "personal_sign"], events: ["accountsChanged", "chainChanged"] } } });
  // 已绑定 uri 事件则交给调用方画二维码
  if (typeof onUri === "function") {
    const handler = ({ uri }) => onUri(uri);
    provider.on("display_uri", handler);
    provider.sessionPromise = new Promise((resolve, reject) => {
      provider.on("session_event", ({ params }) => {
        if (params?.chainId) resolve(params);
      });
      provider.on("connect", () => resolve(null));
      provider.on("session_delete", () => reject(Object.assign(new Error("配对已取消"), { code: "WC_REJECTED" })));
    });
  }
  return provider;
}

export async function disconnectWalletConnect(provider) {
  try { await provider?.disconnect(); } catch { /* 忽略 */ }
}
