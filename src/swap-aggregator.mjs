import { FSTSWAP_CONFIG, fstSwapReady } from "./fstswap-config.mjs?v=mainnet-20261112-39";
import { matchesWalletExecution } from "./swap-receipt.mjs?v=mainnet-20261112-39";
import { swapRpcWork } from "./swap-rpc-work.mjs?v=mainnet-20261112-39";
// 聚合路由 Swap 引擎（BSC 主网 56，FstSi aggregator-live v9「multi-pool」，合约 VERSION 1.01）。
// 与 market-trade.mjs 相同的约束风格：全部函数只通过注入的 JSON-RPC
// request 访问链上，返回精确的十进制字符串/大整数，浏览器与 Node 均可运行。
// 链上事实（2026-11-09 已核验）：
//  - AggregatedRouter 0x0b31…3FD2（FstSi v9，2026-11-09 部署，源码 FstSi/contracts/aggregator/src/AggregatedRouter.sol），
//    owner=执行器，平台费 30bps，预留 5bps，WBNB()=0x0efb…A115；旧 v7 路由 0x3250…8ADf4 仅用于历史回执核验；
//  - FIST 0xC988…Bc6A（6 位小数，无转账税 getter，owner 已放弃）；
//  - FistSwap 路由 0x1B6C…BC2d 的 WETH 为 0x0efb…A115（自有 WBNB）；
//  - v9 新增 swapBnbToTokenMulti / swapTokenToBnbMulti（1-3 池并行拆单）、1inch / OpenOcean 网关入口；
//    网关需链下 API 生成 calldata（本前端未接入），仅登记地址（SWAP_GATEWAYS），不参与路线。
//  - 卖出授权：合约由首段适配器 transferFrom(payer)，所以 spender = 首段适配器（不是路由器）。

// —— v10 聚合路由（AggregatedRouterV10，contracts/fstsi-v10）——
// 前端全部「兑换」经聚合合约：代币⇄代币、精确输出、报价、兑换授权（spender = 路由器）。
// 流动性（注入 / 去除 / LP 授权）按用户决定仍直接走 FstSwap 原路由器 0x1B6C…（swap-pool.mjs 保持 v10 前原样）。
// BSC 主网 v10 1.11；部署地址与链上配置见 contracts/fstsi-v10/deployment/mainnet-record.json。
// 本地 fork / v9 回归测试可在加载前注入 FST_V10_CONFIG，显式空配置不会回退到主网地址。
const V10_DEFAULT = Object.freeze({
  router: "0x6b149377b0d68c7cF09DDa6B6467861D997C9646",
  adapters: Object.freeze({
    fst: "0xB3F425939E0bef2E1312376dF2288CF8a39A63E5",
    pancake: "0xe3f83002413c029BA7F194a878b8C36B03d3d8a0",
    v3: "0x43B2Ede2217ACd3de6542F7C4baFEb488cbbC7a2",
  }),
});
const V10_CONFIG = globalThis.FST_V10_CONFIG ?? (fstSwapReady() ? FSTSWAP_CONFIG : V10_DEFAULT);
const V10_REQUIRED = ["fst", "pancake", "v3"];
export const SWAP_V10 = Object.freeze({
  router: V10_CONFIG.router || "",
  adapters: Object.freeze(Object.fromEntries([...V10_REQUIRED,"thena","kyber"].map(k=>[k,V10_CONFIG.adapters?.[k]||""]))),
});
const isAddr = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value || "")) && !/^0x0{40}$/.test(String(value));
/// v10 是否可用（路由器 + 必需适配器均已配置）。
export const swapV10Ready = () => isAddr(SWAP_V10.router) && V10_REQUIRED.every((key) => isAddr(SWAP_V10.adapters[key]));
/// 当前聚合路由：v10 就绪用 v10，否则用已部署的 v9。
export const swapActiveRouter = () => (swapV10Ready() ? SWAP_V10.router : SWAP_MAINNET.router);
/// v10 未就绪时的统一提示。
export const SWAP_V10_MISSING = { code: "V10_NOT_DEPLOYED", zh: "聚合合约未部署", en: "Aggregator not deployed" };

export const SWAP_MAINNET = Object.freeze({
  version: "aggregator-live-v9",
  contractVersion: "1.01",
  chainId: 56,
  // 单一配置常量：更换聚合路由时只改这里（及下方 SWAP_ADAPTERS 适配器地址）。
  router: "0x0b313506e41a21e178e4F1393e1480f55A3d3FD2",
  // 旧路由（v7）：只用于核验历史交易回执，不再发起新交易。
  legacyRouters: Object.freeze(["0x3250dCAa26Dab6a1cf328b1E179013ABf8B8ADf4"]),
  // 当前 v10 主网 / 显式测试配置。
  routerV10: SWAP_V10.router,
  executor: "0xE942BcB9629e04B40eAe6253C88A4Ae1EB94fA08",
  feeReceiver: "0xfF820D0553Ccb72dDa17A63212F79E7F3f789a99",
  explorer: "https://bscscan.com",
  reserveBps: 5, // 买入预留，合约固定 5/10000，自动退还
  deadlineSeconds: 120,
  gasFloor: 1_500_000, // 跨 DEX 两段实测所需下限（README 实测值）
});

/// MEV Blocker 发送端点（与 lvswap.app 同款）：防抢跑/三明治保护。
/// 无需 API key：签名交易直接 POST 即进入其保护池。
export const SWAP_MEV_ENDPOINT = "https://rpc.mevblocker.io";

/// 通过 MEV Blocker 发送已签名的原始交易，返回交易哈希。
export async function mevSendRawTransaction(raw, fetchImpl = globalThis.fetch) {
  if (!/^0x[0-9a-f]+$/i.test(raw)) throw invalid();
  let response;
  try {
    response = await fetchImpl(SWAP_MEV_ENDPOINT, { method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }) });
  } catch (err) {
    throw error("MEV_SEND_FAILED", "防 MEV 发送请求失败：" + (err?.message || "网络错误"));
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error || !/^0x[0-9a-f]{64}$/i.test(body.result)) {
    throw error("MEV_SEND_FAILED", "防 MEV 发送被拒绝：" + (body?.error?.message || "响应无效"));
  }
  return body.result;
}

/// 探测钱包是否支持 eth_signTransaction（支持则可走 MEV Blocker 直发）。
export async function walletSupportsSignTransaction(provider) {
  try {
    if (typeof provider?.request !== "function") return false;
    // 无害探测：以缺失参数调用，钱包若实现该方法会返回参数错误而非"方法不存在"
    await provider.request({ method: "eth_signTransaction" });
    return true;
  } catch (err) {
    const message = String(err?.message || err?.code || "");
    // 方法不存在/未实现 → 不支持；参数错误说明方法存在
    return !/method not (found|supported)|not supported|unrecognized|not available|does not exist/i.test(message) &&
      /transaction|params|argument|required|invalid/i.test(message);
  }
}

/// 构造 eth_signTransaction 的完整参数（含 nonce/chainId/gasPrice）。
export async function buildSignableTransaction(request, transaction, gasPrice, gasLimit) {
  const nonce = await request({ method: "eth_getTransactionCount", params: [transaction.from, "pending"] });
  return {
    ...transaction,
    chainId: "0x38",
    nonce: /^0x/.test(String(nonce)) ? String(nonce) : "0x" + BigInt(nonce).toString(16),
    gas: "0x" + BigInt(gasLimit).toString(16),
    gasPrice: "0x" + BigInt(gasPrice).toString(16),
  };
}

/// 浏览器直读备用池（无私有 key，2026-11-11 本机只读复测）。
/// 日常报价/余额优先走独立只读服务；此池用于浏览器回退及链上预检。
/// 共 4 个公开备用节点：trade 2 个供询价/授权读取/预检/回执，balance 2 个供钱包余额。
/// 两个 lane 各自维护轮转、成功节点亲和与冷却，余额读取不占用交易备用池。
export const SWAP_RPC_ENDPOINTS = Object.freeze([
  "https://bsc-dataseed.bnbchain.org",
  "https://fast.bsc-rpc.com",
]);
export const SWAP_BALANCE_RPC_ENDPOINTS = Object.freeze([
  "https://swap.bsc.blockrazor.xyz",
  "https://bsc-rpc.publicnode.com",
]);

export const SWAP_TOKENS = Object.freeze({
  bnb: { symbol: "BNB", name: "BNB", decimals: 18, address: "0x0000000000000000000000000000000000000000" },
  wbnb: { symbol: "WBNB", name: "Wrapped BNB", decimals: 18, address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
  usdt: { symbol: "USDT", name: "Tether USD", decimals: 18, address: "0x55d398326f99059fF775485246999027B3197955" },
  busd: { symbol: "BUSD", name: "BUSD Token", decimals: 18, address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56" },
  fist: { symbol: "FIST", name: "FistToken", decimals: 6, address: "0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A" },
});

// 可路由适配器（FstSi v9 部署记录 aggregator-live/deployment-record.json；1inch/oo 网关见 SWAP_GATEWAYS，不参与路线）。
// v2Legs 走 swapBnbToToken/swapTokenToBnb 标准接口；v3Legs 走 V3 专用入口。
const SWAP_ADAPTERS_V9 = Object.freeze({
  fst: { key: "fst", name: "FstSwap", adapter: "0x1c99B958ae3b8eCf1E3684344b18B43F9D31E44d",
    router: "0x1B6C9c20693afDE803B27F8782156c0f892ABC2d", weth: "0x0efb5FD2402A0967B92551d6AF54De148504A115", v3: false },
  pancake: { key: "pancake", name: "PancakeSwap", adapter: "0xeAfB724dBeAB5c358a432e3958Acdd60141b64F7",
    router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", v3: false },
  v3: { key: "v3", name: "PancakeSwap V3", adapter: "0xe86dE838B0eFd64ADFCD3F1EA0e0BA04A3d58A4B",
    router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14", weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", v3: true },
  thena: { key: "thena", name: "Thena", adapter: "0x50e3835222a80A3a043bA52C1f06790c329173d8",
    router: "0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109", weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", v3: false },
  kyber: { key: "kyber", name: "KyberSwap", adapter: "0xd7b6Ea84711F55b444e10b21F0944D529ED7Ec35",
    router: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", v3: true },
});

/// 当前生效的适配器表：v10 就绪时 adapter 字段换成 v10 适配器（其 aggregator() = v10 路由器），其余字段不变。
export const SWAP_ADAPTERS = Object.freeze(swapV10Ready()
  ? Object.fromEntries(Object.entries(SWAP_ADAPTERS_V9)
    .filter(([key]) => isAddr(SWAP_V10.adapters[key]))
    .map(([key, item]) => [key, Object.freeze({ ...item, adapter: SWAP_V10.adapters[key] })]))
  : SWAP_ADAPTERS_V9);

/// v9 网关适配器（已在路由器登记启用），需 1inch / OpenOcean 链下 API 生成 desc/data，前端暂不路由。
export const SWAP_GATEWAYS = Object.freeze({
  oneinch: { key: "oneinch", name: "1inch", adapter: "0x9CCff9E56bCeC28D4A4B6f3D7d6EC898bD23d3Bf", router: "0x1111111254EEB25477B68fb85Ed929f73A960582" },
  oo: { key: "oo", name: "OpenOcean", adapter: "0x0522eA8be0d99E58E1564266D5E69e0E8849FE38", router: "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64" },
});

const PCS_V3_QUOTER = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";
const V3_TIERS = [100, 500, 2500, 10000];
const BPS = 10000n;
const MAX_UINT = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x" + "0".repeat(40);
const CHAIN_HEX = "0x38";

const V10_LEG = "(address adapter,address[] path)";
const V10_FEE = `(${V10_LEG} first,${V10_LEG} second,uint256 minOut,address feeToken,uint256 configVersion)`;
export function swapFeePolicy(tokenIn, tokenOut, defaultFeeToken = SWAP_TOKENS.usdt.address) {
  const native = (x) => !x || lower(x) === ZERO_ADDRESS;
  const approved = (x) => native(x) || [SWAP_TOKENS.fist.address, SWAP_TOKENS.usdt.address].some(a => lower(a) === lower(x));
  if (approved(tokenIn)) return { mode: "input", token: native(tokenIn) ? ZERO_ADDRESS : tokenIn };
  if (approved(tokenOut)) return { mode: "output", token: native(tokenOut) ? ZERO_ADDRESS : tokenOut };
  return { mode: "convert", token: defaultFeeToken };
}

export const SWAP_ABI = [
  "function defaultFeeToken() view returns (address)",
  "function feeConfigVersion() view returns (uint256)",
  "event PlatformFeePaid(address indexed payer,address indexed token,uint256 amount)",
  `function quoteFeeConversion(address input,uint256 feeBudget,${V10_FEE} conversion) view returns (uint256)`,
  `function quoteExactOutputWithFee(${V10_LEG} first,${V10_LEG} second,uint256 amountOut,${V10_FEE} conversion) view returns (uint256 amountIn,uint256 feeBudget,address feeToken,uint256 feeAmount)`,
  `function swapTokenToTokenWithFee(${V10_LEG} first,${V10_LEG} second,uint256 amountIn,uint256 minOut,uint256 deadline,address recipient,${V10_FEE} conversion) returns (uint256 received)`,
  `function swapTokenForExactTokenWithFee(${V10_LEG} first,${V10_LEG} second,uint256 amountOut,uint256 amountInMax,uint256 deadline,address recipient,${V10_FEE} conversion) returns (uint256 used)`,

  "function VERSION() view returns (string)",
  "function WBNB() view returns (address)",
  "function platformFeeBps() view returns (uint16)",
  "function feeReceiver() view returns (address)",
  "function adapters(address) view returns (bool)",
  "function aggregator() view returns (address)",
  "function weth() view returns (address)",
  "function wethToken() view returns (address)",
  "function router() view returns (address)",
  "function getPair(address,address) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)",
  "function quoteExactIn(bytes path,uint256 amountIn) returns (uint256 amountOut)",
  "function swapBnbToToken((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 minOutToken,uint256 deadline,address recipient) payable returns (uint256 receivedToken)",
  "function swapTokenToBnb((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 amountIn,uint256 minOutBnb,uint256 deadline,address recipient) returns (uint256 receivedBnb)",
  "function swapBnbToTokenV3(address adapter,bytes path,uint256 minOutToken,uint256 deadline,address recipient) payable returns (uint256 receivedToken)",
  "function swapTokenToBnbV3(address adapter,bytes path,uint256 amountIn,uint256 minOutBnb,uint256 deadline,address recipient) returns (uint256 receivedBnb)",
  "function swapBnbToTokenMulti((address adapter,address[] path)[] legs,uint256[] amountsIn,uint256 totalMinOut,uint256 deadline,address recipient) payable returns (uint256 receivedToken)",
  "function swapTokenToBnbMulti((address adapter,address[] path)[] legs,uint256[] amountsIn,uint256 totalMinOut,uint256 deadline,address recipient) returns (uint256 receivedBnb)",
  // —— v10 新增（AggregatedRouterV10）——
  "function swapTokenToToken((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 amountIn,uint256 minOut,uint256 deadline,address recipient) returns (uint256 received)",
  "function swapTokenToTokenV3(address adapter,bytes path,uint256 amountIn,uint256 minOut,uint256 deadline,address recipient) returns (uint256 received)",
  "function swapTokenToTokenMulti((address adapter,address[] path)[] legs,uint256[] amountsIn,uint256 totalMinOut,uint256 deadline,address recipient) returns (uint256 received)",
  "function swapBnbForExactToken((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 amountOut,uint256 deadline,address recipient) payable returns (uint256 amountInUsed)",
  "function swapTokenForExactBnb((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 amountOut,uint256 amountInMax,uint256 deadline,address recipient) returns (uint256 amountInUsed)",
  "function swapTokenForExactToken((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 amountOut,uint256 amountInMax,uint256 deadline,address recipient) returns (uint256 amountInUsed)",
  "function getAmountsOutVia(address adapter,uint256 amountIn,address[] path) view returns (uint256[] amounts)",
  "function getAmountsInVia(address adapter,uint256 amountOut,address[] path) view returns (uint256[] amounts)",
  "function quoteExactOutput((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 amountOut,uint8 mode) view returns (uint256 amountIn,uint256 fee)",
  "function getPairInfo(address adapter,address tokenA,address tokenB,address account) view returns (address pair,address token0,address token1,uint112 reserve0,uint112 reserve1,uint256 totalSupply,uint256 lpBalance)",
  "function balancesOf(address account,address[] tokens) view returns (uint256[] out)",
  "function allowancesOf(address account,address[] tokens) view returns (uint256[] out)",
  "event SwapExecuted(address indexed user,address indexed tokenIn,address indexed tokenOut,uint256 amountIn,uint256 amountOut,uint256 fee)",
  "event RouteExecuted(address indexed user,address indexed token,bool buy,uint256 inAmount,uint256 outAmount)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
];

const error = (code, message) => Object.assign(new Error(message), { code });
const invalid = () => error("INVALID_INPUT", "交易参数无效");
const rpcError = () => error("SWAP_RPC", "BSC 主网未返回有效数据");
export const isSwapSlippageBps = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 3000;
const address = (value) => /^0x[0-9a-f]{40}$/i.test(String(value)) && !/^0x0+$/.test(String(value)) ? String(value).toLowerCase() : "";
const lower = (value) => typeof value === "string" ? value.toLowerCase() : "";

function swapInterface(Interface) {
  if (typeof Interface !== "function") throw error("SWAP_DEPENDENCY", "交易依赖未加载");
  return new Interface(SWAP_ABI);
}

/// 平台费与预留拆分（与合约 swapBnbToToken 一致）。
export function swapBuyBudget(amount, feeBps) {
  const rate = BigInt(feeBps);
  if (typeof amount !== "bigint" || amount <= 0n || rate > 100n || rate < 0n) throw invalid();
  const fee = amount * rate / BPS;
  const reserve = amount * BigInt(SWAP_MAINNET.reserveBps) / BPS;
  return { fee, reserve, budget: amount - fee - reserve };
}

/// 卖出毛收入扣除平台费后的净额（与合约 swapTokenToBnb 一致）。
export function swapSellNet(gross, feeBps) {
  const rate = BigInt(feeBps);
  if (typeof gross !== "bigint" || gross < 0n || rate > 100n || rate < 0n) throw invalid();
  const fee = gross * rate / BPS;
  return { fee, net: gross - fee };
}

function normalizeAdapter(key) {
  const item = SWAP_ADAPTERS[key];
  if (!item) throw invalid();
  return { ...item, adapter: item.adapter.toLowerCase(), router: item.router.toLowerCase(), weth: item.weth.toLowerCase() };
}

/// 两段路由结构：每段 { key, adapter, router, weth, path:[...] }；v3 段为 { key, adapter, path:bytes }。
function legV2(key, path) {
  const item = normalizeAdapter(key);
  if (item.v3) throw invalid();
  return { kind: "v2", ...item, path: path.map((token) => token.toLowerCase()) };
}

// Factory reuse is an in-process proof, never a field trusted from a JSON API.
const configFactoryProofs = new WeakMap();
const configSnapshot = block => block && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block.number || '') && /^0x[0-9a-f]{64}$/i.test(block.hash || '')
  ? {number:block.number.toLowerCase(),hash:block.hash.toLowerCase()} : null;
export function readSwapConfigFactory(config, request, block) {
  const proof = configFactoryProofs.get(config), snapshot = configSnapshot(block);
  return proof && snapshot && proof.request === request && proof.number === snapshot.number && proof.hash === snapshot.hash ? proof.factory : null;
}

/// 读取路由器配置并核对部署一致性（一次 Multicall3 批量读取）。
export async function readSwapConfig(request, { tokens = SWAP_TOKENS, adapters = SWAP_ADAPTERS, block } = {}) {
  const iface = swapInterface(globalThis.ethers?.Interface);
  const adapterList = Object.values(adapters);
  const snapshot = configSnapshot(block);
  const factoryIface = snapshot && adapterList.some(item => item.key === 'v3') ? new globalThis.ethers.Interface(['function factory() view returns(address)']) : null;
  const calls = [
    { target: swapActiveRouter(), data: iface.encodeFunctionData("platformFeeBps", []) },
    { target: swapActiveRouter(), data: iface.encodeFunctionData("feeReceiver", []) },
    { target: swapActiveRouter(), data: iface.encodeFunctionData("WBNB", []) },
    ...adapterList.map((item) => ({ target: swapActiveRouter(), data: iface.encodeFunctionData("adapters", [item.adapter]) })),
    // v9：适配器 aggregator() 必须指回当前路由器（防止配置成旧 v7 适配器）
    ...adapterList.map((item) => ({ target: item.adapter, data: iface.encodeFunctionData("aggregator", []) })),
    { target: swapActiveRouter(), data: iface.encodeFunctionData("VERSION", []) },
    ...(swapV10Ready() ? ["defaultFeeToken", "feeConfigVersion"].map(method => ({ target: swapActiveRouter(), data: iface.encodeFunctionData(method, []) })) : []),
    ...(factoryIface ? [{target:PCS_V3_QUOTER,data:factoryIface.encodeFunctionData('factory',[])}] : []),
  ];
  const [chain, entries] = await Promise.all([
    request({ method: "eth_chainId" }),
    multicallTryAggregate(request, calls, snapshot?.number),
  ]);
  if (chain !== CHAIN_HEX) throw error("WRONG_CHAIN", "请连接 BSC 主网（chainId 56）");
  const readEntry = (index, method) => {
    const entry = entries[index];
    if (!entry?.success) throw error("SWAP_CONFIG", "聚合路由配置未就绪");
    try { return iface.decodeFunctionResult(method, entry.returnData); } catch { throw error("SWAP_CONFIG", "聚合路由配置未就绪"); }
  };
  const [fee] = readEntry(0, "platformFeeBps");
  const [receiver] = readEntry(1, "feeReceiver");
  const [wbnb] = readEntry(2, "WBNB");
  const enabled = adapterList.map((item, index) => {
    const entry = entries[3 + index];
    if (!entry?.success) return [item.key, false];
    let on = false;
    try { on = iface.decodeFunctionResult("adapters", entry.returnData)[0] === true; } catch { on = false; }
    const owner = entries[3 + adapterList.length + index];
    try { if (!owner?.success || address(iface.decodeFunctionResult("aggregator", owner.returnData)[0]) !== address(swapActiveRouter())) on = false; } catch { on = false; }
    return [item.key, on];
  });
  let contractVersion = "";
  const versionEntry = entries[3 + adapterList.length * 2];
  try { if (versionEntry?.success) contractVersion = iface.decodeFunctionResult("VERSION", versionEntry.returnData)[0]; } catch { contractVersion = ""; }
  if (!receiver || !wbnb || Number(fee) > 100) throw error("SWAP_CONFIG", "聚合路由配置未就绪");
  const off = enabled.filter(([, on]) => !on).map(([key]) => key);
  const feeConfig = swapV10Ready() ? {
    defaultFeeToken: readEntry(4 + adapterList.length * 2, "defaultFeeToken")[0],
    feeConfigVersion: readEntry(5 + adapterList.length * 2, "feeConfigVersion")[0],
  } : {};
  if (swapV10Ready() && contractVersion !== (["2.0.0","2.1.0"].includes(V10_CONFIG.version) ? V10_CONFIG.version : "1.11")) throw error("SWAP_CONFIG", "聚合路由收费版本不匹配");
  const config = { platformFeeBps: Number(fee), feeReceiver: receiver, wbnb, adaptersOff: off, version: contractVersion, ...feeConfig };
  if (factoryIface) {
    const entry = entries[calls.length - 1];
    try {
      const factory = entry?.success ? factoryIface.decodeFunctionResult('factory', entry.returnData)[0] : null;
      if (isAddr(factory)) {
        config.v3Factory = factory.toLowerCase();
        configFactoryProofs.set(config, {...snapshot,request,factory:config.v3Factory});
      }
    } catch { /* Optional discovery failures use the normal policy factory read. */ }
  }
  return config;
}

/// v2 报价已并入 quoteSwap 的 Multicall3 批量路径（getAmountsOut）。

function encodeV3Path(tokenIn, fee, tokenOut) {
  return ethersHexConcat(tokenIn.toLowerCase(), fee.toString(16).padStart(6, "0"), tokenOut.toLowerCase());
}

function ethersHexConcat(...parts) {
  return "0x" + parts.map((part) => String(part).replace(/^0x/, "")).join("");
}

function sameToken(a, b) {
  return lower(a) === lower(b);
}

/// Multicall3 批量只读：一次 eth_call 打包全部报价/配置读取，
/// 把 16+ 次请求压成 2-3 次，是报价提速的核心。
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = [
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

async function multicallTryAggregate(request, calls, blockTag = 'latest') {
  if (!calls.length) return [];
  const Interface = globalThis.ethers?.Interface;
  if (typeof Interface !== "function") throw error("SWAP_DEPENDENCY", "交易依赖未加载");
  const iface = new Interface(MULTICALL_ABI);
  // ethers 对无名 tuple 组件要求数组形式（[target, data]）
  const data = iface.encodeFunctionData("tryAggregate", [false, calls.map((call) => [call.target, call.data])]);
  const result = await request({ method: "eth_call", params: [{ to: MULTICALL3, data }, blockTag] });
  const decoded = iface.decodeFunctionResult("tryAggregate", result);
  return decoded[0].map((item) => ({ success: item.success, returnData: item.returnData }));
}

/// V2 报价调用：v10 就绪 → 聚合路由 getAmountsOutVia(adapter, amountIn, path)；否则 DEX 路由 getAmountsOut。
/// 两者返回 uint256[] 编码一致，统一用 getAmountsOut 解码。
function v2QuoteCall(iface, item, amountIn, path) {
  if (swapV10Ready()) return [swapActiveRouter(), iface.encodeFunctionData("getAmountsOutVia", [item.adapter, amountIn, path])];
  return [item.router, iface.encodeFunctionData("getAmountsOut", [amountIn, path])];
}

/// v10：经聚合路由报价（getAmountsOutVia），返回 amounts。
export async function v10AmountsOut(request, adapterKey, amountIn, path) {
  if (!swapV10Ready()) throw error(SWAP_V10_MISSING.code, SWAP_V10_MISSING.zh);
  const iface = swapInterface(globalThis.ethers?.Interface);
  const data = iface.encodeFunctionData("getAmountsOutVia", [SWAP_ADAPTERS[adapterKey].adapter, amountIn, path]);
  const raw = await request({ method: "eth_call", params: [{ to: swapActiveRouter(), data }, "latest"] });
  return iface.decodeFunctionResult("getAmountsOutVia", raw)[0].map((x) => BigInt(x));
}

/// 通用币对比较所有已启用的 V2 DEX，以及各 DEX 自己的包装币路径。
export function v10V2Candidates(tokenIn, tokenOut, { singleHop = false, config } = {}) {
  const native = token => !token || lower(token) === ZERO_ADDRESS;
  const candidates = [], seen = new Set();
  for (const [key, item] of Object.entries(SWAP_ADAPTERS)) {
    if (item.v3 || config?.adaptersOff?.includes(key)) continue;
    const input = native(tokenIn) ? item.weth : tokenIn;
    const output = native(tokenOut) ? item.weth : tokenOut;
    const paths = [[input, output]];
    if (!singleHop) for (const mid of [item.weth, SWAP_TOKENS.usdt.address, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', '0x2170ed0880ac9a755fd29b2688956bd959f933f8', SWAP_TOKENS.fist.address]) paths.push([input, mid, output]);
    for (const path of paths) {
      if (!path.every(isAddr) || new Set(path.map(lower)).size !== path.length) continue;
      const id = lower(item.adapter) + ':' + path.map(lower).join(':');
      if (seen.has(id)) continue;
      seen.add(id); candidates.push({ key, first: { adapter: item.adapter, path } });
    }
  }
  return candidates;
}

export function v10RouteCandidates(tokenIn, tokenOut, options = {}) {
  const candidates = v10V2Candidates(tokenIn, tokenOut, options);
  if (options.singleHop) return candidates;
  const adapters = Object.values(SWAP_ADAPTERS).filter(a => !a.v3 && !options.config?.adaptersOff?.includes(a.key));
  const mids = [SWAP_TOKENS.fist.address, SWAP_TOKENS.usdt.address, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', '0x2170ed0880ac9a755fd29b2688956bd959f933f8', ...new Set(adapters.map(a => a.weth))];
  for (const a of adapters) for (const b of adapters) {
    if (a.key === b.key) continue;
    const input = !tokenIn || lower(tokenIn) === ZERO_ADDRESS ? a.weth : tokenIn;
    const output = !tokenOut || lower(tokenOut) === ZERO_ADDRESS ? b.weth : tokenOut;
    for (const mid of mids) {
      if (new Set([input, mid, output].map(lower)).size !== 3) continue;
      candidates.push({ key: a.key, first: { adapter: a.adapter, path: [input, mid] }, second: { adapter: b.adapter, path: [mid, output] } });
    }
  }
  // The deployed router accepts up to three edges in each leg and two DEX
  // legs. Include main-pool bridges such as FIST -> USDT -> WBNB -> alt.
  for (const a of adapters) for (const b of adapters) {
    const input = !tokenIn || lower(tokenIn) === ZERO_ADDRESS ? a.weth : tokenIn;
    const output = !tokenOut || lower(tokenOut) === ZERO_ADDRESS ? b.weth : tokenOut;
    for (const mid1 of mids) for (const mid2 of mids) {
      const path = [input, mid1, mid2, output];
      if (new Set(path.map(lower)).size !== 4) continue;
      if (a.key === b.key) candidates.push({key:a.key, first:{adapter:a.adapter,path}});
      else for (const split of [1,2]) candidates.push({key:a.key,
        first:{adapter:a.adapter,path:path.slice(0,split+1)}, second:{adapter:b.adapter,path:path.slice(split)}});
    }
  }
  return candidates;
}

/// 所有候选一次批量报价，失败的池不影响其他 DEX 的可用报价。
export async function v10BestAmountsOut(request, { tokenIn, tokenOut, amountIn, singleHop, config, poolPolicy }) {
  if (!swapV10Ready()) throw error(SWAP_V10_MISSING.code, SWAP_V10_MISSING.zh);
  if (typeof amountIn !== 'bigint' || amountIn <= 0n) throw invalid();
  const iface = swapInterface(globalThis.ethers?.Interface);
  const candidates = (poolPolicy ? v10RouteCandidates : v10V2Candidates)(tokenIn, tokenOut, { singleHop, config }).filter(c => !poolPolicy || poolPolicy.allows(c.first, c.second));
  // Several cross-DEX routes share a first leg: read it once, then reuse its
  // exact output as input to each second leg. Never cache an executable quote.
  const calls = [], firstIndexes = [], firstCalls = new Map();
  for (const {first} of candidates) {
    const data = iface.encodeFunctionData('getAmountsOutVia', [first.adapter, amountIn, first.path]);
    if (!firstCalls.has(data)) { firstCalls.set(data, calls.length); calls.push({target:swapActiveRouter(),data}); }
    firstIndexes.push(firstCalls.get(data));
  }
  const entries = await multicallTryAggregate(request, calls);
  const quotes = [], partials = [];
  candidates.forEach((candidate, index) => {
    const entry = entries[firstIndexes[index]];
    if (!entry?.success) return;
    try {
      const amounts = Array.from(iface.decodeFunctionResult('getAmountsOutVia', entry.returnData)[0]);
      const out = amounts.at(-1);
      if (amounts.length !== candidate.first.path.length || amounts[0] !== amountIn || out <= 0n) return;
      (candidate.second ? partials : quotes).push({ ...candidate, out, amounts });
    } catch { /* 不完整的报价不可用于成交。 */ }
  });
  if (partials.length) {
    const secondResults = await multicallTryAggregate(request, partials.map(c => ({ target: swapActiveRouter(),
      data: iface.encodeFunctionData('getAmountsOutVia', [c.second.adapter, c.out, c.second.path]) })));
    secondResults.forEach((entry, n) => {
      if (!entry.success) return;
      try {
        const amounts = Array.from(iface.decodeFunctionResult('getAmountsOutVia', entry.returnData)[0]);
        if (amounts.length !== partials[n].second.path.length || amounts[0] !== partials[n].out || amounts.at(-1) <= 0n) return;
        quotes.push({ ...partials[n], out: amounts.at(-1), amounts: [...partials[n].amounts, ...amounts.slice(1)] });
      } catch {}
    });
  }
  quotes.sort((a, b) => a.out > b.out ? -1 : a.out < b.out ? 1 : 0);
  if (!quotes.length) throw error('NO_ROUTE', '当前没有可用的聚合交易路径');
  return { ...quotes[0], candidates: quotes };
}

// Pancake V3 的参考价来自所选池的 slot0，而不是另一家 DEX 的试报价。
async function v10V3Impact(request, leg, amountIn, amountOut) {
  if (!sameToken(leg.adapter, SWAP_ADAPTERS.v3?.adapter) || !/^0x[0-9a-f]{86}$/i.test(leg.path || ''))
    throw error('UNSAFE_QUOTE', '无法读取 V3 兑换路线');
  const iface = new globalThis.ethers.Interface([
    'function factory() view returns(address)', 'function getPool(address,address,uint24) view returns(address)',
    'function token0() view returns(address)', 'function token1() view returns(address)',
    'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)',
  ]);
  const call = async (target, method, args = []) => iface.decodeFunctionResult(method,
    await request({ method: 'eth_call', params: [{ to: target, data: iface.encodeFunctionData(method, args) }, 'latest'] }));
  const a = leg.path.slice(0, 42), b = '0x' + leg.path.slice(48), fee = parseInt(leg.path.slice(42, 48), 16);
  const [factory] = await call(PCS_V3_QUOTER, 'factory');
  if (!isAddr(factory)) throw error('UNSAFE_QUOTE', 'V3 工厂不可用');
  const [pool] = await call(factory, 'getPool', [a, b, fee]);
  if (!isAddr(pool)) throw error('UNSAFE_QUOTE', 'V3 池不存在');
  const entries = await multicallTryAggregate(request, ['slot0', 'token0', 'token1'].map(method => ({ target: pool, data: iface.encodeFunctionData(method) })));
  if (entries.some(e => !e.success) || entries.length !== 3) throw error('UNSAFE_QUOTE', '无法读取 V3 池价格');
  const [sqrt] = iface.decodeFunctionResult('slot0', entries[0].returnData);
  const [token0] = iface.decodeFunctionResult('token0', entries[1].returnData), [token1] = iface.decodeFunctionResult('token1', entries[2].returnData);
  const forward = sameToken(a, token0) && sameToken(b, token1), reverse = sameToken(a, token1) && sameToken(b, token0);
  if ((!forward && !reverse) || sqrt <= 0n || amountIn <= 0n || amountOut <= 0n) throw error('UNSAFE_QUOTE', 'V3 池价格无效');
  const numerator = amountIn * (forward ? sqrt * sqrt : 2n ** 192n);
  const received = amountOut * (forward ? 2n ** 192n : sqrt * sqrt);
  return received >= numerator ? 0 : Number((numerator - received) * 100000000n / numerator) / 100000000;
}

/// 用储备计算交易前的边际价格，避免“小额试报价”本身耗尽微小池子。
export async function v10RouteImpact(request, first, amountIn, amountOut, {poolPolicy, blockNumber} = {}) {
  const legs = Array.isArray(first) ? first : [first];
  if (legs.length === 1 && legs[0]?.kind === 'v3') return v10V3Impact(request, legs[0], amountIn, amountOut);
  const iface = swapInterface(globalThis.ethers?.Interface), edges = [];
  for (const leg of legs) {
    if (!Array.isArray(leg?.path) || leg.path.length < 2) throw error('UNSAFE_QUOTE', '无法读取兑换路线的流动性');
    for (let n = 1; n < leg.path.length; n++) edges.push({ adapter: leg.adapter, a: leg.path[n - 1], b: leg.path[n] });
  }
  if (!edges.length || amountIn <= 0n || amountOut <= 0n) throw error('UNSAFE_QUOTE', '兑换报价无效');
  // A caller that pins the quote may reuse its verified pool snapshot. Never
  // substitute another DEX or silently fall back to mixed-block reserve reads.
  const snapshot = poolPolicy !== undefined || blockNumber !== undefined;
  let reserves;
  if (snapshot) {
    const block = value => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value);
    if (!poolPolicy || !block(blockNumber) || !block(poolPolicy.blockNumber) || BigInt(blockNumber) !== BigInt(poolPolicy.blockNumber) ||
      !(poolPolicy.pools instanceof Map) || typeof poolPolicy.assertFresh !== 'function')
      throw error('UNSAFE_QUOTE', '兑换池快照与报价区块不符');
    if (poolPolicy.assertFresh() !== true) throw error('UNSAFE_QUOTE', '兑换池快照已失效');
    const validAddress = value => typeof value === 'string' && isAddr(value);
    if (legs.some(leg => leg.kind && leg.kind !== 'v2')) throw error('UNSAFE_QUOTE', '兑换池快照类型不符');
    reserves = edges.map(({adapter, a, b}) => {
      if (![adapter, a, b].every(validAddress) || sameToken(a, b)) throw error('UNSAFE_QUOTE', '兑换池与报价路线不符');
      const id = [lower(adapter), ...[lower(a), lower(b)].sort(), 'v2'].join(':');
      const pool = poolPolicy.pools.get(id);
      if (!pool || pool.id !== id || pool.kind !== 'v2' || !validAddress(pool.address) || !validAddress(pool.adapter) ||
        !sameToken(pool.adapter, adapter) || ![pool.token0, pool.token1].every(validAddress) ||
        !((sameToken(pool.token0, a) && sameToken(pool.token1, b)) || (sameToken(pool.token0, b) && sameToken(pool.token1, a))) ||
        !Array.isArray(pool.reserves) || pool.reserves.length !== 2 || pool.reserves.some(r => typeof r !== 'bigint' || r <= 0n))
        throw error('UNSAFE_QUOTE', '兑换池快照不完整或与报价路线不符');
      return [pool.address, pool.token0, pool.token1, ...pool.reserves];
    });
  }
  const entries = snapshot ? null : await multicallTryAggregate(request, edges.map(({ adapter, a, b }) => ({ target: swapActiveRouter(),
    data: iface.encodeFunctionData('getPairInfo', [adapter, a, b, ZERO_ADDRESS]) })));
  let numerator = amountIn, denominator = 1n;
  for (let n = 0; n < edges.length; n++) {
    let pool = reserves?.[n];
    try { if (entries?.[n]?.success) pool = iface.decodeFunctionResult('getPairInfo', entries[n].returnData); } catch {}
    const { a, b } = edges[n];
    if (!pool || !isAddr(pool[0]) || pool[3] <= 0n || pool[4] <= 0n) throw error('UNSAFE_QUOTE', '流动性不足，无法安全报价');
    const forward = sameToken(pool[1], a) && sameToken(pool[2], b);
    const reverse = sameToken(pool[1], b) && sameToken(pool[2], a);
    if (!forward && !reverse) throw error('UNSAFE_QUOTE', '兑换池与报价路线不符');
    numerator *= forward ? pool[4] : pool[3];
    denominator *= forward ? pool[3] : pool[4];
  }
  const received = amountOut * denominator;
  return received >= numerator ? 0 : Number((numerator - received) * 100000000n / numerator) / 100000000;
}

export function assertQuoteSafety({ tokenIn, tokenOut, amountIn, amountOut, impact, quotedAmountIn = amountIn, quotedAmountOut = amountOut }) {
  if (typeof amountIn !== 'bigint' || typeof amountOut !== 'bigint' || amountIn <= 0n || amountOut <= 0n)
    throw error('UNSAFE_QUOTE', '兑换报价无效');
  if (impact != null) {
    if (!Number.isFinite(impact) || impact > 0.15)
      throw error('PRICE_IMPACT_TOO_HIGH', '价格影响超过 15%，请减少金额或选择其他币对');
    if (typeof quotedAmountIn !== 'bigint' || typeof quotedAmountOut !== 'bigint' || quotedAmountIn <= 0n || quotedAmountOut <= 0n)
      throw error('UNSAFE_QUOTE', '兑换报价无效');
    // 对链上最低到账 / 最高支付生效，不能通过放大滑点绕过价格影响上限。
    const rate = BigInt(Math.floor(Math.min(1, 1 - impact) * 100000000));
    const worstRate = amountOut * quotedAmountIn * rate / (quotedAmountOut * amountIn);
    if (worstRate < 85000000n) throw error('PRICE_IMPACT_TOO_HIGH', '价格影响与滑点合计超过 15%，请减少金额或滑点');
  }
  // 仅这两个已知 BSC 18 位稳定币采用额外的 90% 最低比率保护；不按代币名称猜测精度。
  const stable = [lower(SWAP_TOKENS.usdt.address), '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'];
  if (!sameToken(tokenIn, tokenOut) && stable.includes(lower(tokenIn)) && stable.includes(lower(tokenOut)) && amountOut * 100n < amountIn * 90n)
    throw error('UNSAFE_QUOTE', '稳定币兑换价格异常，已停止兑换');
  if (impact == null) throw error('UNSAFE_QUOTE', '无法读取价格影响，请刷新报价');
}

/// v10：精确输出报价（与成交同算法）。mode 0 = BNB→代币，1 = 代币→BNB（净额），2 = 代币→代币。
export async function v10QuoteExactOutput(request, { first, second = null, amountOut, mode, conversion }) {
  if (!swapV10Ready()) throw error(SWAP_V10_MISSING.code, SWAP_V10_MISSING.zh);
  const iface = swapInterface(globalThis.ethers?.Interface);
  const leg = (l) => l ? { adapter: l.adapter, path: l.path } : { adapter: ZERO_ADDRESS, path: [] };
  const method = conversion ? "quoteExactOutputWithFee" : "quoteExactOutput";
  const data = iface.encodeFunctionData(method, [leg(first), leg(second), amountOut, conversion || mode]);
  const raw = await request({ method: "eth_call", params: [{ to: swapActiveRouter(), data }, "latest"] });
  const result = iface.decodeFunctionResult(method, raw);
  return { amountIn: BigInt(result[0]), fee: BigInt(conversion ? result[3] : result[1]) };
}

/// v10 兑换请求（代币⇄代币 / 精确输出；流动性不经聚合，仍走 FstSwap 原路由器）：method + args → { from, to: v10 路由器, data, value }。
export function v10Request(Interface, { account, method, args, value = 0n }) {
  if (!swapV10Ready()) throw error(SWAP_V10_MISSING.code, SWAP_V10_MISSING.zh);
  if (!address(account)) throw invalid();
  const iface = swapInterface(Interface);
  return { from: account, to: swapActiveRouter(), data: iface.encodeFunctionData(method, args), value: "0x" + BigInt(value).toString(16) };
}

/// 枚举并评分全部可行路线（买 FIST / 卖 FIST）。
/// 两轮 Multicall3：第一轮覆盖直接候选 + 两段第一腿 + v3 尝试；
/// 第二轮用第一腿输出对两段第二腿报价。返回最优路线。
export async function quoteSwap(request, options) {
  const { side, amountIn, feeBps = 30, tokens = SWAP_TOKENS, adapters = SWAP_ADAPTERS, includeV3 = true, poolPolicy, singleHop = false } = options ?? {};
  if (!["buy", "sell"].includes(side) || typeof amountIn !== "bigint" || amountIn <= 0n) throw invalid();
  const usdt = tokens.usdt.address, fist = tokens.fist.address;
  // 候选种子清单：2026-11-09 主网已核验的池。BUSD 无 FIST 池不列入；
  // Thena/Kyber/V3 暂无 FIST 池，报价失败自动跳过。
  const seeds = (side === "buy" ? [
    { kind: "direct", first: "pancake" },
    { kind: "direct", first: "fst" },
    { kind: "two", first: "pancake", second: "fst", via: usdt },
    { kind: "two", first: "pancake", second: "pancake", via: usdt },
    { kind: "two", first: "fst", second: "fst", via: usdt },
    { kind: "two", first: "fst", second: "pancake", via: usdt },
  ] : [
    { kind: "direct", first: "pancake" },
    { kind: "direct", first: "fst" },
    { kind: "two", first: "fst", second: "pancake", via: usdt },
    { kind: "two", first: "pancake", second: "pancake", via: usdt },
  ]).filter(seed => !singleHop || seed.kind === "direct");

  const state = side === "buy"
    ? (({ fee, reserve, budget }) => ({ fee, reserve, budget, netInput: null }))(swapBuyBudget(amountIn, feeBps))
    : (swapV10Ready() ? { fee: amountIn * BigInt(feeBps) / BPS, reserve: 0n, budget: null, netInput: amountIn - amountIn * BigInt(feeBps) / BPS }
      : { fee: 0n, reserve: 0n, budget: null, netInput: amountIn });
  const inputAmount = state.budget ?? state.netInput;
  const iface = swapInterface(globalThis.ethers?.Interface);

  function finish(raw, dir, firstKey, firstPath, secondKey, secondPath) {
    if (dir === "buy") {
      return { side, first: legV2(firstKey, firstPath),
        second: secondKey ? legV2(secondKey, secondPath) : null, estimateOut: raw,
        platformFee: state.fee, feeBps, reserve: state.reserve, swapBudget: state.budget, hops: secondKey ? 2 : 1 };
    }
    const { fee, net } = swapV10Ready() ? { fee: state.fee, net: raw } : swapSellNet(raw, feeBps);
    return { side, first: legV2(firstKey, firstPath),
      second: secondKey ? legV2(secondKey, secondPath) : null, estimateOut: net,
      platformFee: fee, feeBps, reserve: 0n, swapBudget: state.netInput, hops: secondKey ? 2 : 1 };
  }

  function firstPathOf(seed) {
    const item = adapters[seed.first];
    if (seed.kind === "direct") return side === "buy" ? [item.weth, fist] : [fist, item.weth];
    return side === "buy" ? [item.weth, seed.via] : [fist, seed.via];
  }
  function secondPathOf(seed) {
    const item = adapters[seed.second];
    return side === "buy" ? [seed.via, fist] : [seed.via, item.weth];
  }

  // —— 第一轮：直接候选 + 两段第一腿 + v3 尝试，一次 Multicall3 ——
  const calls = [];
  const callIds = new Map();
  const pushCall = (target, data) => {
    const key = target.toLowerCase() + "|" + data;
    if (callIds.has(key)) return callIds.get(key);
    const id = calls.length;
    callIds.set(key, id);
    calls.push({ target, data });
    return id;
  };
  const leg1 = seeds.map((seed) => {
    const item = adapters[seed.first];
    const path = firstPathOf(seed);
    // v10：经聚合路由 getAmountsOutVia 报价（不直连 DEX 路由）；v9：直接读 DEX 路由
    const [target, data] = v2QuoteCall(iface, item, inputAmount, path);
    return { seed, id: pushCall(target, data) };
  });
  const v3Calls = new Map();
  if (includeV3) {
    // 只报 Pancake V3（PCS QuoterV2）。Kyber 适配器的底层池不是 PCS 池，PCS Quoter 的报价不代表其成交价；
    // 已部署的 v9 V3/Kyber 适配器 quoteExactIn 实测返回 0（无 quoter()），不可用于报价 → Kyber 暂不参与路线。
    for (const key of ["v3"]) {
      const item = normalizeAdapter(key);
      for (const fee of V3_TIERS) {
        const tokenIn = side === "buy" ? item.weth : fist;
        const tokenOut = side === "buy" ? fist : item.weth;
        // PCS QuoterV2 结构体顺序为 (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)，selector 0xc6a5026a。
        // 旧实现把 fee/amountIn 顺序写反（selector 0xb3b11b7e 不存在），V3 报价一直失败、从未入选。
        const data = iface.encodeFunctionData("quoteExactInputSingle", [[tokenIn, tokenOut, inputAmount, fee, 0n]]);
        v3Calls.set(key + ":" + fee, { id: pushCall(PCS_V3_QUOTER, data), fee });
      }
    }
  }

  const round1 = await multicallTryAggregate(request, calls);
  const getAmountsOutValue = (entry) => {
    if (!entry?.success) return null;
    try {
      const [amounts] = iface.decodeFunctionResult("getAmountsOut", entry.returnData);
      return Array.isArray(amounts) && amounts.length >= 2 && amounts.at(-1) > 0n ? amounts.at(-1) : null;
    } catch { return null; }
  };

  const candidates = [];
  const midValues = new Map();
  for (let i = 0; i < seeds.length; i++) {
    const { seed, id } = leg1[i];
    const out = getAmountsOutValue(round1[id]);
    if (out == null) continue;
    if (seed.kind === "direct") {
      candidates.push(finish(out, side, seed.first, firstPathOf(seed)));
    } else {
      midValues.set(i, out);
    }
  }
  if (includeV3) {
    for (const [key, { id, fee }] of v3Calls) {
      const entry = round1[id];
      if (!entry?.success) continue;
      try {
        const [out] = iface.decodeFunctionResult("quoteExactInputSingle", entry.returnData);
        if (out <= 0n) continue;
        const [adapterKey] = key.split(":");
        const item = normalizeAdapter(adapterKey);
        const path = side === "buy" ? encodeV3Path(item.weth, fee, fist) : encodeV3Path(fist, fee, item.weth);
        candidates.push(side === "buy"
          ? { side, first: { kind: "v3", key: adapterKey, adapter: item.adapter, weth: item.weth, path }, second: null,
              estimateOut: out, platformFee: state.fee, feeBps, reserve: state.reserve, swapBudget: state.budget, hops: 1 }
          : (() => { const { fee: platformFee, net } = swapV10Ready() ? { fee: state.fee, net: out } : swapSellNet(out, feeBps); return { side,
              first: { kind: "v3", key: adapterKey, adapter: item.adapter, weth: item.weth, path }, second: null,
              estimateOut: net, platformFee, feeBps, reserve: 0n, swapBudget: state.netInput, hops: 1 }; })());
      } catch { /* 解码失败跳过 */ }
    }
  }

  // —— 第二轮：两段第二腿（依赖第一轮 mid），一次 Multicall3 ——
  const round2Calls = [];
  const round2Ids = new Map();
  const leg2Owners = new Map();
  for (const [i, seed] of seeds.entries()) {
    if (seed.kind !== "two" || !midValues.has(i)) continue;
    const mid = midValues.get(i);
    const item = adapters[seed.second];
    const path = secondPathOf(seed);
    const [target, data] = v2QuoteCall(iface, item, mid, path);
    const key = target.toLowerCase() + "|" + data;
    let id;
    if (round2Ids.has(key)) id = round2Ids.get(key);
    else {
      id = round2Calls.length;
      round2Ids.set(key, id);
      round2Calls.push({ target, data });
    }
    if (!leg2Owners.has(id)) leg2Owners.set(id, []);
    leg2Owners.get(id).push({ i, seed });
  }
  if (round2Calls.length) {
    const round2 = await multicallTryAggregate(request, round2Calls);
    for (const [id, owners] of leg2Owners) {
      const out = getAmountsOutValue(round2[id]);
      if (out == null) continue;
      for (const { seed } of owners) {
        candidates.push(finish(out, side, seed.first, firstPathOf(seed), seed.second, secondPathOf(seed)));
      }
    }
  }

  const usable = candidates
    .filter((c) => c && c.estimateOut > 0n && (!poolPolicy || poolPolicy.allows(c.first, c.second)))
    .sort((a, b) => (a.estimateOut > b.estimateOut ? -1 : a.estimateOut < b.estimateOut ? 1 : a.hops - b.hops));
  if (!usable.length) throw error("NO_ROUTE", "当前没有可用的聚合交易路径");
  return usable[0];
}

/// 授权请求（卖出需先授权首段适配器）。
export function swapApproveRequest(Interface, { account, token, spender, amount = MAX_UINT }) {
  const iface = swapInterface(Interface);
  if (!address(account) || !address(token) || !address(spender)) throw invalid();
  return { from: account, to: token, data: iface.encodeFunctionData("approve", [spender, amount]) };
}

/// 路线 → 路由器方法名（v9：V2 两段 / V3 单池 / Multi 1-3 池并行）。
export function swapRouteMethod(route) {
  const multi = Array.isArray(route?.legs);
  if (route?.side === "buy") return multi ? "swapBnbToTokenMulti" : route.first?.kind === "v3" ? "swapBnbToTokenV3" : "swapBnbToToken";
  if (route?.side === "sell") return multi ? "swapTokenToBnbMulti" : route.first?.kind === "v3" ? "swapTokenToBnbV3" : "swapTokenToBnb";
  throw invalid();
}

/// 卖出需授权的 spender 列表（合约由每段/首段适配器 transferFrom 用户代币）。
export function swapRouteSpenders(route) {
  if (swapV10Ready()) return [lower(swapActiveRouter())]; // v10：用户只授权路由器
  if (Array.isArray(route?.legs)) return [...new Set(route.legs.map((leg) => lower(leg.adapter)))];
  return route?.first?.adapter ? [lower(route.first.adapter)] : [];
}

/// 构造聚合器交易请求（对齐钱包 eth_sendTransaction 参数）。
/// Multi 路线：route.legs = [{ adapter, path }]（1-3 段，同输出/输入代币、池不重复），
/// route.amountsIn = 每段输入；买入时 Σ amountsIn 必须等于 swapBuyBudget(amountIn).budget。
export function swapTradeRequest(Interface, { account, route, amountIn, minOut, deadline }) {
  const iface = swapInterface(Interface);
  if (!address(account)) throw invalid();
  if (Array.isArray(route.legs)) {
    const legs = route.legs.map((leg) => ({ adapter: leg.adapter, path: leg.path }));
    const amounts = (route.amountsIn ?? []).map((value) => BigInt(value));
    if (!legs.length || legs.length > 3 || amounts.length !== legs.length || amounts.some((value) => value <= 0n)) throw invalid();
    const method = swapRouteMethod(route);
    const data = iface.encodeFunctionData(method, [legs, amounts, minOut, deadline, account]);
    return { from: account, to: swapActiveRouter(), data, value: route.side === "buy" ? "0x" + amountIn.toString(16) : "0x0" };
  }
  const empty = { adapter: ZERO_ADDRESS, path: [] };
  const firstTuple = route.first.kind === "v3" ? null : { adapter: route.first.adapter, path: route.first.path };
  if (route.first.kind === "v3") {
    const method = route.side === "buy" ? "swapBnbToTokenV3" : "swapTokenToBnbV3";
    const args = route.side === "buy"
      ? [route.first.adapter, route.first.path, minOut, deadline, account]
      : [route.first.adapter, route.first.path, amountIn, minOut, deadline, account];
    return { from: account, to: swapActiveRouter(), data: iface.encodeFunctionData(method, args),
      value: route.side === "buy" ? "0x" + amountIn.toString(16) : "0x0" };
  }
  const secondTuple = route.second ? { adapter: route.second.adapter, path: route.second.path } : empty;
  if (route.side === "buy") {
    const data = iface.encodeFunctionData("swapBnbToToken", [firstTuple, secondTuple, minOut, deadline, account]);
    return { from: account, to: swapActiveRouter(), data, value: "0x" + amountIn.toString(16) };
  }
  const data = iface.encodeFunctionData("swapTokenToBnb", [firstTuple, secondTuple, amountIn, minOut, deadline, account]);
  return { from: account, to: swapActiveRouter(), data, value: "0x0" };
}

/// 交易前预检：eth_call 仿真 + Gas 估算（1.5M 下限，README 实测建议）+ Gas 价格。
export async function preflightSwap(request, { account, route, amountIn, minOut, deadline, allowance = null }) {
  if (!address(account)) throw error("NO_ACCOUNT", "请先连接钱包");
  const iface = swapInterface(globalThis.ethers?.Interface);
  const transaction = swapTradeRequest(globalThis.ethers.Interface, { account, route, amountIn, minOut, deadline });
  const needsApproval = route.side === "sell" && allowance !== null && allowance < amountIn;
  // 轻量公共 RPC：estimateGas/gasPrice 快速失败（2 端点 × 8s），失败走 fallback
  const lightRpc = swapPublicRpc(globalThis.fetch, undefined, { priority: "foreground", attempts: 2, timeoutMs: 8000 });
  const decodeSim = (result) => {
    const method = swapRouteMethod(route);
    const [received] = iface.decodeFunctionResult(method, result);
    return route.side === "buy" || swapV10Ready() ? received : swapSellNet(received, route.feeBps ?? 30).net;
  };
  // 三路并行：仿真 + Gas 估算 + Gas 价格（互不阻塞）
  const [simulatedResult, estimated, price] = await Promise.allSettled([
    needsApproval ? Promise.reject() : request({ method: "eth_call", params: [transaction, "latest"] }),
    lightRpc({ method: "eth_estimateGas", params: [transaction] }),
    lightRpc({ method: "eth_gasPrice" }),
  ]);
  let simulated = null;
  if (!needsApproval && simulatedResult.status === "fulfilled") {
    try { simulated = decodeSim(simulatedResult.value); } catch { simulated = null; }
  }
  const estimatedHex = estimated.status === "fulfilled" ? estimated.value : "0x16e360";
  const priceHex = price.status === "fulfilled" ? price.value : "0xb2d05e00"; // 3 gwei fallback
  const gas = BigInt(estimatedHex) * 15n / 10n; // estimate × 1.5
  const gasLimit = gas > BigInt(SWAP_MAINNET.gasFloor) ? gas : BigInt(SWAP_MAINNET.gasFloor);
  const gasPrice = BigInt(priceHex);
  return { transaction, simulated, gasLimit, gasPrice, gasCost: gasLimit * gasPrice, needsApproval };
}

/// 回执核验：交易状态 + RouteExecuted 事件 + 最少到账。
export async function readSwapReceipt(request, hash, { account, route, minOut, expectedRequest, router = swapActiveRouter() }) {
  // 只接受当前路由器或登记的旧路由（历史回执）
  if (![SWAP_MAINNET.router, SWAP_V10.router, ...SWAP_MAINNET.legacyRouters].filter(Boolean).some((item) => address(item) === address(router))) throw invalid();
  const iface = swapInterface(globalThis.ethers?.Interface);
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw invalid();
  const [receipt, tx] = await Promise.all([
    request({ method: "eth_getTransactionReceipt", params: [hash] }),
    request({ method: "eth_getTransactionByHash", params: [hash] }),
  ]);
  if (!receipt || !tx || !tx.blockHash || lower(tx.blockHash) !== lower(receipt.blockHash)) return null;
  if (lower(receipt.transactionHash) !== lower(hash) || lower(tx.hash) !== lower(hash) ||
      address(receipt.from) !== address(account) || address(receipt.to) !== address(router) ||
      lower(tx.input) !== lower(expectedRequest.data)) throw error("INVALID_RECEIPT", "回执与已提交的交易不符");
  const status = BigInt(receipt.status);
  if (status === 0n) throw error("TX_REVERTED", "交易已回滚");
  if (status !== 1n) throw error("INVALID_RECEIPT", "回执状态无效");
  const topic = iface.getEvent("RouteExecuted").topicHash;
  // 手动解码（ethers 6.15 decodeEventLog 对非 indexed bool 存在 buffer-overrun 缺陷）：
  // topics[1]=user topics[2]=token；data = buy||inAmount||outAmount（buy 未 indexed）
  const events = (receipt.logs ?? []).flatMap((log) => {
    if (address(log?.address) !== address(router) || log.removed === true || lower(log.topics?.[0]) !== topic) return [];
    try {
      const user = "0x" + String(log.topics[1]).slice(26);
      const token = "0x" + String(log.topics[2]).slice(26);
      const buy = BigInt("0x" + String(log.data).slice(2, 66)) !== 0n;
      const inAmount = BigInt("0x" + String(log.data).slice(66, 130));
      const outAmount = BigInt("0x" + String(log.data).slice(130, 194));
      return [{ user, token, buy, inAmount, outAmount }];
    } catch { return []; }
  });
  // 合约 V3 入口的事件 token 字段记录的是 WBNB（买入记 tokenIn，卖出记 tokenOut），其余入口记 FIST
  const eventTokens = new Set([lower(SWAP_TOKENS.fist.address)]);
  if (route?.first?.kind === "v3") eventTokens.add(lower(route.first.weth || SWAP_TOKENS.wbnb.address));
  const execution = events.filter(({ user, token, buy }) => address(user) === address(account) &&
    eventTokens.has(lower(token)) && buy === (route.side === "buy")).at(-1);
  if (!execution || execution.outAmount <= 0n) throw error("INVALID_RECEIPT", "未找到有效的成交事件");
  const amountOut = route.side === "buy" || address(router) === address(SWAP_V10.router) ? execution.outAmount : swapSellNet(execution.outAmount, route.feeBps ?? 30).net;
  if (amountOut < minOut) throw error("INVALID_RECEIPT", "实际到账低于最少到账");
  return { hash: lower(hash), amountOut, gasUsed: BigInt(receipt.gasUsed) };
}

function ROUTER_ADDRESS() { return swapActiveRouter(); }

/// 路线人类可读描述（中/英）。
export function describeRoute(route, lang = "zh") {
  if (!route) return "";
  const name = (leg) => {
    const item = SWAP_ADAPTERS[leg.key];
    return item ? item.name : "?";
  };
  const symbols = { [lower(SWAP_TOKENS.wbnb.address)]: "WBNB", [lower(SWAP_TOKENS.usdt.address)]: "USDT",
    [lower(SWAP_TOKENS.busd.address)]: "BUSD", [lower(SWAP_TOKENS.fist.address)]: "FIST",
    [lower(SWAP_TOKENS.bnb.address)]: "BNB", [lower(SWAP_ADAPTERS.fst.weth)]: "WBNB" };
  const sym = (token) => symbols[lower(token)] ?? String(token).slice(0, 6) + "…";
  const legText = (leg) => leg.kind === "v3" ? `${name(leg)} V3` : `${name(leg)} ${leg.path.map(sym).join("→")}`;
  if (!route.second) return legText(route.first);
  return lang === "en" ? `${legText(route.first)} + ${legText(route.second)}` : `${legText(route.first)} ＋ ${legText(route.second)}`;
}

/// 单位转换（与 ethers 对齐，允许小数输入）。
export function swapUnits(value, decimals) {
  const ethers = globalThis.ethers;
  if (!ethers?.parseUnits) throw error("SWAP_DEPENDENCY", "交易依赖未加载");
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || value.length > 80) throw invalid();
  try {
    const result = ethers.parseUnits(value, decimals);
    if (result <= 0n || result > MAX_UINT) throw invalid();
    return result;
  } catch { throw invalid(); }
}

export function swapFormatUnits(value, decimals) {
  const ethers = globalThis.ethers;
  if (!ethers?.formatUnits) return String(value);
  try { return ethers.formatUnits(value, decimals); } catch { return String(value); }
}

let swapLibraryPromise;
export function loadSwapLibrary() {
  if (globalThis.ethers?.Interface && typeof globalThis.ethers.parseUnits === "function") return Promise.resolve();
  if (swapLibraryPromise) return swapLibraryPromise;
  swapLibraryPromise = new Promise((resolve, reject) => {
    if (!globalThis.document?.head) { reject(error("SWAP_DEPENDENCY", "交易依赖未加载")); return; }
    const script = document.createElement("script");
    const timer = setTimeout(() => complete(false), 8000);
    function complete(loaded) {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      script.remove();
      if (loaded && globalThis.ethers?.Interface && typeof globalThis.ethers.parseUnits === "function") resolve();
      else reject(error("SWAP_DEPENDENCY", "交易依赖未加载"));
    }
    script.onload = () => complete(true);
    script.onerror = () => complete(false);
    script.src = new URL("../assets/vendor/ethers.umd.min.js", import.meta.url).href;
    document.head.append(script);
  }).catch(err => { swapLibraryPromise = null; throw err; });
  return swapLibraryPromise;
}

/// 公共 RPC 封装：端点亲和（复用成功端点热连接）+ 跨端点故障转移 + 失败冷却。
const rpcLanes = {
  trade: { cursor: 0, lastGood: null, cooldown: new Map() },
  balance: { cursor: 0, lastGood: null, cooldown: new Map() },
};
const RPC_ATTEMPTS = 3; // 单请求最多尝试的端点数
const RPC_COOLDOWN_MS = 60_000;

/// 仅本地 fork 验证：globalThis.FST_RPC_OVERRIDE = ["http://127.0.0.1:8545"]（生产不注入，SWAP_RPC_ENDPOINTS 不变）。
const rpcList = lane => (Array.isArray(globalThis.FST_RPC_OVERRIDE) && globalThis.FST_RPC_OVERRIDE.length ? globalThis.FST_RPC_OVERRIDE : lane === "balance" ? SWAP_BALANCE_RPC_ENDPOINTS : SWAP_RPC_ENDPOINTS);

async function rpcUntilAborted(work, signal) {
  let onAbort;
  const canceled = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, {once:true});
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([canceled, work]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export function swapPublicRpc(fetchImpl = globalThis.fetch, signal, { lane = "trade", priority = "background", attempts = RPC_ATTEMPTS, timeoutMs = 15000 } = {}) {
  lane = lane === "balance" ? "balance" : "trade";
  const state = rpcLanes[lane];
  let nextId = 0;
  const once = (endpoint, { method, params = [], id }) => swapRpcWork.run(async ({signal:scheduledSignal}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const active = AbortSignal.any([scheduledSignal, timeout]);
    const response = await rpcUntilAborted(fetchImpl(endpoint, { method: "POST", signal: active,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }), active);
    let body;
    try { body = await rpcUntilAborted(response.json(), active); }
    catch (error) { if (active.aborted) throw active.reason; throw rpcError(); }
    if (active.aborted) throw active.reason;
    if (!response.ok || body?.id !== id || body.error || !Object.hasOwn(body, "result")) throw rpcError();
    return body.result;
  }, {priority, signal});
  return async (payload) => {
    const id = ++nextId;
    // 候选顺序：上一个成功端点优先（复用热连接），随后按轮换取号分散并发
    const list = rpcList(lane);
    const start = state.cursor % list.length;
    state.cursor = (state.cursor + 1) % list.length;
    const order = [];
    if (state.lastGood && list.includes(state.lastGood) && state.lastGood !== list[start]) order.push(state.lastGood);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const endpoint = list[(start + attempt) % list.length];
      if (!order.includes(endpoint)) order.push(endpoint);
    }
    let lastError = null, sawMissingTransaction = false;
    const nullableTransaction = ["eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(payload.method);
    for (const endpoint of order) {
      if ((state.cooldown.get(endpoint) ?? 0) > Date.now()) continue;
      try {
        const result = await once(endpoint, { ...payload, id });
        // Some public providers return null for an existing historical hash.
        // Check only the bounded alternate read set; never resend a transaction.
        if (result === null && nullableTransaction) { sawMissingTransaction = true; continue; }
        state.lastGood = endpoint;
        return result;
      } catch (err) {
        lastError = err;
        if (signal?.aborted || err?.name === "AbortError") throw err; // 主动取消不冷却，也不启动故障转移。
        state.cooldown.set(endpoint, Date.now() + RPC_COOLDOWN_MS);
      }
    }
    if (sawMissingTransaction) return null;
    // Authenticated backup is available only through the local credential-hiding proxy.
    // It is a fallback, never promoted ahead of healthy public endpoints or local fork overrides.
    if (lane === "trade" && !globalThis.FST_RPC_OVERRIDE?.length && ["127.0.0.1", "localhost"].includes(globalThis.location?.hostname)) {
      try { return await once("http://127.0.0.1:8126/rpc", { ...payload, id }); }
      catch (err) { lastError = err; if (signal?.aborted || err?.name === "AbortError") throw err; }
    }
    // 全池冷却/失败兜底：忽略冷却再试一轮，防止冷却死锁
    for (const endpoint of order) {
      try {
        const result = await once(endpoint, { ...payload, id });
        if (result === null && nullableTransaction) { sawMissingTransaction = true; continue; }
        return result;
      } catch (err) { lastError = err; if (signal?.aborted || err?.name === "AbortError") throw err; }
    }
    if (sawMissingTransaction) return null;
    throw lastError ?? rpcError();
  };
}

// v10 fees: choose an independent V2 fee route, so the main swap cannot move its price.
export async function v10PlanFeeConversion(request, { input, feeBudget, config, slippageBps, mainLegs = [] }) {
  if (!swapV10Ready() || config?.feeConfigVersion == null) throw error("SWAP_CONFIG", "请刷新聚合配置");
  const iface = swapInterface(globalThis.ethers?.Interface);
  const empty = { adapter: ZERO_ADDRESS, path: [] };
  const candidates = [];
  const poolKeys = (adapter, path) => path.slice(1).map((token, i) => lower(adapter.router) + ":" + [lower(path[i]), lower(token)].sort().join(":"));
  const used = new Set(mainLegs.flatMap(leg => {
    const a = Object.values(SWAP_ADAPTERS).find(a => lower(a.adapter) === lower(leg.adapter));
    return a ? poolKeys(a, leg.path) : [];
  }));
  for (const key of ["fst", "pancake"]) {
    const a = SWAP_ADAPTERS[key];
    if (!a || config.adaptersOff?.includes(key)) continue;
    const target = lower(config.defaultFeeToken) === ZERO_ADDRESS ? a.weth : config.defaultFeeToken;
    for (const path of [[input, target], [input, a.weth, target], [input, SWAP_TOKENS.usdt.address, target], [input, SWAP_TOKENS.fist.address, target]]) {
      if (new Set(path.map(lower)).size !== path.length || poolKeys(a, path).some(p => used.has(p))) continue;
      candidates.push({ first: { adapter: a.adapter, path }, second: empty, minOut: 1n, feeToken: config.defaultFeeToken, configVersion: config.feeConfigVersion });
    }
  }
  if (!candidates.length) throw error("NO_FEE_ROUTE", "没有独立的手续费兑换路径");
  const calls = candidates.map(conversion => ({ target: swapActiveRouter(), data: iface.encodeFunctionData("quoteFeeConversion", [input, feeBudget, conversion]) }));
  const results = await multicallTryAggregate(request, calls);
  const quotes = results.flatMap((result, i) => {
    try { if (!result.success) return []; return [{ conversion: candidates[i], fee: BigInt(iface.decodeFunctionResult("quoteFeeConversion", result.returnData)[0]) }]; } catch { return []; }
  }).sort((a, b) => a.fee > b.fee ? -1 : a.fee < b.fee ? 1 : 0);
  if (!quotes.length || (feeBudget > 0n && quotes[0].fee === 0n)) throw error("NO_FEE_ROUTE", "没有可用的手续费兑换路径");
  const best = quotes[0];
  best.conversion.minOut = best.fee * (BPS - BigInt(slippageBps)) / BPS || 1n;
  return best;
}

export async function v10AmountsIn(request, first, amountOut) {
  const iface = swapInterface(globalThis.ethers?.Interface);
  const data = iface.encodeFunctionData("getAmountsInVia", [first.adapter, amountOut, first.path]);
  const raw = await request({ method: "eth_call", params: [{ to: swapActiveRouter(), data }, "latest"] });
  return BigInt(iface.decodeFunctionResult("getAmountsInVia", raw)[0][0]);
}

export async function readV10Receipt(request, hash, { account, expectedRequest, tokenIn, tokenOut, minOut, maxIn, feeToken, expectedFee = 0n, minFeeOut = 0n }) {
  const iface = swapInterface(globalThis.ethers?.Interface);
  const [receipt, tx] = await Promise.all([
    request({ method: "eth_getTransactionReceipt", params: [hash] }),
    request({ method: "eth_getTransactionByHash", params: [hash] }),
  ]);
  const fail = () => error("INVALID_RECEIPT", "v10 成交回执与请求不符");
  if (!receipt || !tx || !tx.blockHash || lower(receipt.blockHash) !== lower(tx.blockHash)) throw fail();
  if (lower(receipt.transactionHash) !== lower(hash) || lower(tx.hash) !== lower(hash) ||
      !matchesWalletExecution(tx,receipt,{...expectedRequest,from:account})) throw fail();
  if (BigInt(receipt.status) === 0n) throw error("TX_REVERTED", "交易已回滚");
  if (BigInt(receipt.status) !== 1n) throw fail();
  const block = await request({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] });
  if (lower(block?.hash) !== lower(receipt.blockHash)) throw fail();
  const logs = (receipt.logs || []).flatMap(log => {
    if (address(log.address) !== address(expectedRequest.to) || log.removed) return [];
    try { return [iface.parseLog(log)].filter(Boolean); } catch { return []; }
  });
  const fees = logs.filter(log => log.name === "PlatformFeePaid");
  if (fees.length > 1 || fees.some(log => lower(log.args.payer) !== lower(account) || lower(log.args.token) !== lower(feeToken))) throw fail();
  if ((expectedFee > 0n || minFeeOut > 0n) && fees.length !== 1) throw fail();
  const fee = fees[0]?.args.amount ?? 0n;
  if (fee < minFeeOut) throw fail();
  const executions = logs.filter(log => ["SwapExecuted", "RouteExecuted"].includes(log.name) && lower(log.args.user) === lower(account));
  if (executions.length !== 1) throw fail();
  const event = executions[0];
  let amountOut;
  if (event.name === "SwapExecuted") {
    if (event.args.fee !== fee) throw fail();
    if (lower(event.args.tokenIn) !== lower(tokenIn || ZERO_ADDRESS) || lower(event.args.tokenOut) !== lower(tokenOut || ZERO_ADDRESS) || event.args.amountIn > maxIn) throw fail();
    amountOut = event.args.amountOut;
  } else {
    const nativeIn = !tokenIn || lower(tokenIn) === ZERO_ADDRESS;
    if (event.args.buy !== nativeIn) throw fail();
    amountOut = event.args.outAmount - (!nativeIn && lower(feeToken) === ZERO_ADDRESS ? fee : 0n);
    if (event.args.inAmount > maxIn) throw fail();
  }
  if (amountOut < minOut) throw fail();
  return { hash, amountOut, fee, feeToken, gasUsed: BigInt(receipt.gasUsed) };
}
