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

function injectedProviders() {
  const list = [];
  for (const key of ["ethereum", "okxwallet", "binance"]) {
    const provider = globalThis[key];
    if (provider && typeof provider.request === "function" && !list.some((p) => p === provider)) list.push(provider);
  }
  // 多钱包注入时（MetaMask 等）ethereum.providers 数组取第一个支持 eth_accounts 的
  if (!list.length && Array.isArray(globalThis.ethereum?.providers)) {
    for (const provider of globalThis.ethereum.providers) {
      if (provider && typeof provider.request === "function") { list.push(provider); break; }
    }
  }
  return list;
}

/// 连接注入式钱包并确保 BSC 主网。
export async function connectInjected() {
  const provider = injectedProviders()[0];
  if (!provider) {
    throw Object.assign(new Error("未检测到浏览器钱包（可安装 MetaMask / OKX / TokenPocket）"), { code: "NO_WALLET" });
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw Object.assign(new Error("钱包未返回账户"), { code: "NO_ACCOUNT" });
  const switched = await ensureMainnet(provider);
  if (!switched) throw Object.assign(new Error("请手动切换到 BSC 主网（chainId 56）"), { code: "WRONG_CHAIN" });
  return { provider, account: accounts[0], kind: "injected" };
}

/// 切换到 BSC 主网；失败时尝试 addEthereumChain 后再切。
export async function ensureMainnet(provider) {
  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    if (chainId === SWAP_CHAIN.hex) return true;
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SWAP_CHAIN.hex }] });
  } catch (switchError) {
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
