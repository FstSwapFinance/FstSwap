// 聚合 Swap 引擎测试：离线纯函数 + BSC 主网真实数据集成验证。
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

globalThis.ethers = ethers;
// This suite exercises the retained v9 interface independently of the v10 default.
globalThis.FST_V10_CONFIG = {router:"",adapters:{}};
const {
  SWAP_MAINNET, SWAP_TOKENS, SWAP_MEV_ENDPOINT, swapBuyBudget, swapSellNet, swapUnits, swapFormatUnits,
  swapApproveRequest, swapTradeRequest, quoteSwap, preflightSwap, readSwapReceipt,
  describeRoute, readSwapConfig, swapPublicRpc, mevSendRawTransaction,
  walletSupportsSignTransaction, buildSignableTransaction, SWAP_ADAPTERS, swapRouteMethod, swapRouteSpenders, SWAP_ABI,
} = await import("../swap-aggregator.mjs");
import { readFileSync } from "node:fs";
const SWAP_ABI_LOCAL = () => SWAP_ABI;
// FstSi 聚合路由 v9 编译产物 ABI（来自 FstSi/aggregator-live/out，只读拷贝）
const FSTSI_ABI = JSON.parse(readFileSync(new URL("../contracts/fstsi/AggregatedRouter.abi.json", import.meta.url), "utf8"));
const FSTSI = new ethers.Interface(FSTSI_ABI);
const V7_ROUTER = SWAP_MAINNET.legacyRouters[0];

const request = swapPublicRpc(fetch);
const FIST = SWAP_TOKENS.fist.address;
const WBNB = SWAP_TOKENS.wbnb.address;
const USDT = SWAP_TOKENS.usdt.address;

test("swapBuyBudget 与合约语义一致（0.005 BNB, 30bps）", () => {
  const { fee, reserve, budget } = swapBuyBudget(5000000000000000n, 30);
  assert.equal(fee, 15000000000000n);       // 0.3%
  assert.equal(reserve, 2500000000000n);    // 0.05%
  assert.equal(budget, 4982500000000000n);  // 链上实测 RouteExecuted.inAmount
});

test("swapSellNet 与合约语义一致（live sell 毛收入）", () => {
  const { fee, net } = swapSellNet(4928423231201091n, 30);
  assert.equal(fee, 14785269693603n);
  assert.equal(net, 4913637961507488n); // live 卖出用户净到账
});

test("单位转换与格式化", () => {
  assert.equal(swapUnits("0.0049825", 18), 4982500000000000n);
  assert.equal(swapUnits("12.5", 6), 12500000n);
  assert.throws(() => swapUnits("", 18));
  assert.throws(() => swapUnits("1e3", 18));
  assert.equal(swapFormatUnits(12568147n, 6), "12.568147");
});

test("授权与交易请求编码可解码还原", () => {
  const account = SWAP_MAINNET.executor;
  const approve = swapApproveRequest(ethers.Interface, { account, token: FIST, spender: SWAP_MAINNET.router });
  const approveDecoded = new ethers.Interface(["function approve(address,uint256) returns (bool)"])
    .decodeFunctionData("approve", approve.data);
  assert.equal(approveDecoded[0].toLowerCase(), SWAP_MAINNET.router.toLowerCase());
  assert.equal(approveDecoded[1], (1n << 256n) - 1n);

  const route = {
    side: "buy",
    first: { kind: "v2", key: "pancake", adapter: SWAP_ADAPTERS.pancake.adapter,
      router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", weth: WBNB, path: [WBNB, USDT] },
    second: { kind: "v2", key: "fst", adapter: SWAP_ADAPTERS.fst.adapter,
      router: "0x1B6C9c20693afDE803B27F8782156c0f892ABC2d", weth: "0x0efb5FD2402A0967B92551d6AF54De148504A115", path: [USDT, FIST] },
  };
  const tx = swapTradeRequest(ethers.Interface, { account, route, amountIn: 5000000000000000n, minOut: 1n, deadline: 9999999999 });
  assert.equal(tx.to.toLowerCase(), SWAP_MAINNET.router.toLowerCase());
  assert.equal(BigInt(tx.value), 5000000000000000n);
  const iface = new ethers.Interface([
    "function swapBnbToToken((address adapter,address[] path) first,(address adapter,address[] path) second,uint256 minOutToken,uint256 deadline,address recipient) payable returns (uint256)",
  ]);
  const [first, second, minOut, deadline, recipient] = iface.decodeFunctionData("swapBnbToToken", tx.data);
  assert.deepEqual([...first.path].map((a) => a.toLowerCase()), [WBNB.toLowerCase(), USDT.toLowerCase()]);
  assert.deepEqual([...second.path].map((a) => a.toLowerCase()), [USDT.toLowerCase(), FIST.toLowerCase()]);
  assert.equal(minOut, 1n);
  assert.equal(recipient.toLowerCase(), account.toLowerCase());
  // 与 FstSi 编译 ABI 逐字段一致（selector + 解码）
  const parsed = FSTSI.parseTransaction({ data: tx.data, value: BigInt(tx.value) });
  assert.equal(parsed.name, "swapBnbToToken");
  assert.equal(parsed.args.first.adapter.toLowerCase(), SWAP_ADAPTERS.pancake.adapter.toLowerCase());
  assert.equal(parsed.args.second.adapter.toLowerCase(), SWAP_ADAPTERS.fst.adapter.toLowerCase());
});

test("v9 路由器地址与全部方法 selector 来自 FstSi ABI", () => {
  assert.equal(SWAP_MAINNET.router, "0x0b313506e41a21e178e4F1393e1480f55A3d3FD2");
  for (const name of ["swapBnbToToken", "swapTokenToBnb", "swapBnbToTokenV3", "swapTokenToBnbV3", "swapBnbToTokenMulti",
    "swapTokenToBnbMulti", "platformFeeBps", "feeReceiver", "WBNB", "adapters", "VERSION"]) {
    assert.equal(new ethers.Interface(SWAP_ABI_LOCAL()).getFunction(name).selector, FSTSI.getFunction(name).selector, name);
  }
  assert.equal(new ethers.Interface(SWAP_ABI_LOCAL()).getEvent("RouteExecuted").topicHash, FSTSI.getEvent("RouteExecuted").topicHash);
});

test("V3 报价使用 PCS QuoterV2 正确 selector（0xc6a5026a）", () => {
  assert.equal(new ethers.Interface(SWAP_ABI).getFunction("quoteExactInputSingle").selector, "0xc6a5026a");
});

test("Multi / V3 请求编码对 FstSi ABI 可解码；卖出 spender = 适配器", () => {
  const account = SWAP_MAINNET.executor;
  const budget = swapBuyBudget(10000000000000000n, 30).budget;
  const half = budget / 2n;
  const multi = { side: "buy", legs: [
    { adapter: SWAP_ADAPTERS.pancake.adapter, path: [WBNB, FIST] },
    { adapter: SWAP_ADAPTERS.fst.adapter, path: [SWAP_ADAPTERS.fst.weth, FIST] }], amountsIn: [half, budget - half] };
  assert.equal(swapRouteMethod(multi), "swapBnbToTokenMulti");
  const tx = swapTradeRequest(ethers.Interface, { account, route: multi, amountIn: 10000000000000000n, minOut: 1n, deadline: 9999999999 });
  assert.equal(tx.to, SWAP_MAINNET.router);
  const parsed = FSTSI.parseTransaction({ data: tx.data, value: BigInt(tx.value) });
  assert.equal(parsed.name, "swapBnbToTokenMulti");
  assert.equal(parsed.args.amountsIn.reduce((a, b) => a + b, 0n), budget);
  const sell = { ...multi, side: "sell", legs: multi.legs.map((leg) => ({ ...leg, path: [...leg.path].reverse() })), amountsIn: [5n, 6n] };
  assert.equal(FSTSI.parseTransaction({ data: swapTradeRequest(ethers.Interface, { account, route: sell, amountIn: 11n, minOut: 1n, deadline: 9999999999 }).data }).name, "swapTokenToBnbMulti");
  assert.deepEqual(swapRouteSpenders(sell), [SWAP_ADAPTERS.pancake.adapter.toLowerCase(), SWAP_ADAPTERS.fst.adapter.toLowerCase()]);
  const v3 = { side: "sell", first: { kind: "v3", key: "v3", adapter: SWAP_ADAPTERS.v3.adapter, weth: WBNB,
    path: "0x" + FIST.slice(2).toLowerCase() + "0009c4" + WBNB.slice(2).toLowerCase() }, second: null };
  const v3tx = swapTradeRequest(ethers.Interface, { account, route: v3, amountIn: 100n, minOut: 1n, deadline: 9999999999 });
  const v3parsed = FSTSI.parseTransaction({ data: v3tx.data });
  assert.equal(v3parsed.name, "swapTokenToBnbV3");
  assert.equal(v3parsed.args.adapter.toLowerCase(), SWAP_ADAPTERS.v3.adapter.toLowerCase());
  assert.deepEqual(swapRouteSpenders(v3), [SWAP_ADAPTERS.v3.adapter.toLowerCase()]);
});

test("readSwapReceipt：V3 入口事件记 WBNB 也能核验（mock 回执）", async () => {
  const account = SWAP_MAINNET.executor;
  const route = { side: "buy", first: { kind: "v3", key: "v3", adapter: SWAP_ADAPTERS.v3.adapter, weth: WBNB, path: "0x" }, second: null };
  const hash = "0x" + "11".repeat(32), block = "0x" + "22".repeat(32);
  const data = "0x" + "ab".repeat(4);
  const topic = FSTSI.getEvent("RouteExecuted").topicHash;
  const pad = (a) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
  const log = { address: SWAP_MAINNET.router, removed: false, topics: [topic, pad(account), pad(WBNB)],
    data: ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint256", "uint256"], [true, 100n, 777n]) };
  const mock = async ({ method }) => method === "eth_getTransactionReceipt"
    ? { transactionHash: hash, blockHash: block, from: account, to: SWAP_MAINNET.router, status: "0x1", gasUsed: "0x5208", logs: [log] }
    : { hash, blockHash: block, input: data, value: "0x1" };
  const receipt = await readSwapReceipt(mock, hash, { account, route, minOut: 700n,
    expectedRequest: { from: account, to: SWAP_MAINNET.router, data, value: "0x1" } });
  assert.equal(receipt.amountOut, 777n);
  await assert.rejects(() => readSwapReceipt(mock, hash, { account, route, minOut: 1n, router: "0x000000000000000000000000000000000000dEaD",
    expectedRequest: { from: account, to: SWAP_MAINNET.router, data, value: "0x1" } }), { code: "INVALID_INPUT" });
});

test("readSwapConfig 核对主网部署（chainId 56）", async () => {
  const config = await readSwapConfig(request);
  assert.equal(config.platformFeeBps, 30);
  assert.equal(config.feeReceiver.toLowerCase(), SWAP_MAINNET.feeReceiver.toLowerCase());
  assert.deepEqual(config.adaptersOff, []);
  assert.equal(config.version, "1.01");
  assert.equal(config.wbnb.toLowerCase(), SWAP_ADAPTERS.fst.weth.toLowerCase());
});

test("quoteSwap 主网买入返回可行最优路线", async () => {
  const quote = await quoteSwap(request, { side: "buy", amountIn: 5000000000000000n, feeBps: 30 });
  assert.equal(quote.side, "buy");
  assert.ok(quote.estimateOut > 0n);
  assert.equal(quote.swapBudget, 4982500000000000n);
  if (quote.first.kind === "v2") assert.equal(quote.first.path[0].toLowerCase(), quote.first.weth);
  const last = quote.second ? quote.second.path.at(-1).toLowerCase()
    : quote.first.kind === "v3" ? quote.first.path.toLowerCase().slice(-40) : quote.first.path.at(-1).toLowerCase();
  assert.equal(last, FIST.toLowerCase());
  // 路线路径合法：无零地址、无重复
  for (const leg of [quote.first, quote.second].filter(Boolean)) {
    if (leg.kind === "v2") {
      assert.ok(leg.path.length >= 2 && leg.path.length <= 4);
      assert.equal(new Set(leg.path).size, leg.path.length);
    }
  }
});

test("quoteSwap 主网卖出返回可行最优路线", async () => {
  const quote = await quoteSwap(request, { side: "sell", amountIn: 1000000n, feeBps: 30 });
  assert.equal(quote.side, "sell");
  assert.ok(quote.estimateOut > 0n);
  if (quote.first.kind === "v2") {
    assert.equal(quote.first.path[0].toLowerCase(), FIST.toLowerCase());
    // 直接路线以 weth 结尾；两段路线第二段以 weth 结尾
    const terminal = quote.second ? quote.second.path.at(-1).toLowerCase() : quote.first.path.at(-1).toLowerCase();
    assert.equal(terminal, quote.second ? quote.second.weth : quote.first.weth);
  }
});

test("preflightSwap 主网买入仿真（executor 账户）", async () => {
  const quote = await quoteSwap(request, { side: "buy", amountIn: 5000000000000000n, feeBps: 30 });
  const preflight = await preflightSwap(request, {
    account: SWAP_MAINNET.executor, route: quote, amountIn: 5000000000000000n,
    minOut: quote.estimateOut * 95n / 100n, deadline: Math.floor(Date.now() / 1000) + 300, allowance: null,
  });
  assert.equal(preflight.needsApproval, false);
  assert.ok(preflight.simulated > 0n, "买入仿真应得到正输出");
  assert.ok(preflight.gasLimit >= BigInt(SWAP_MAINNET.gasFloor), "Gas 下限 1.5M");
});

test("preflightSwap 主网卖出仿真（executor 账户 dust 余额）", async () => {
  const quote = await quoteSwap(request, { side: "sell", amountIn: 100000n, feeBps: 30 });
  // 链上实际授权决定仿真可行性：查 executor 对首段适配器的 allowance
  const allowanceData = new ethers.Interface(["function allowance(address,address) view returns (uint256)"])
    .encodeFunctionData("allowance", [SWAP_MAINNET.executor, quote.first.adapter]);
  const allowanceRaw = await request({ method: "eth_call", params: [{ to: FIST, data: allowanceData }, "latest"] });
  const chainAllowance = BigInt(allowanceRaw);
  const preflight = await preflightSwap(request, {
    account: SWAP_MAINNET.executor, route: quote, amountIn: 100000n,
    minOut: 1n, deadline: Math.floor(Date.now() / 1000) + 300, allowance: chainAllowance,
  });
  if (chainAllowance >= 100000n) {
    assert.equal(preflight.needsApproval, false);
    assert.ok(preflight.simulated > 0n, "卖出仿真应得到正输出");
  } else {
    assert.equal(preflight.needsApproval, true, "授权不足时应标记需要授权");
  }
});

test("readSwapReceipt 校验旧 v7 live 买入回执（0xaffa1df4…）", async () => {
  const hash = "0xaffa1df4940c8ba8c89c4271356730fbac230eaeb3fa9b1547cfa2d5defeeb70";
  const tx = await request({ method: "eth_getTransactionByHash", params: [hash] });
  const expectedRequest = { from: SWAP_MAINNET.executor, to: V7_ROUTER, data: tx.input, value: tx.value };
  const receipt = await readSwapReceipt(request, hash, {
    router: V7_ROUTER, account: SWAP_MAINNET.executor, route: { side: "buy" }, minOut: 12000000n, expectedRequest,
  });
  assert.equal(receipt.amountOut, 12441253n); // 链上 RouteExecuted.outAmount（FIST 6 位）
  assert.ok(receipt.gasUsed > 0n);
});

test("readSwapReceipt 校验旧 v7 live 卖出回执（0xf1456f0e…）", async () => {
  const hash = "0xf1456f0e9bd9f7fc317b7567e0b7cb82898e714eed05b2711dacdcedc108533e";
  const tx = await request({ method: "eth_getTransactionByHash", params: [hash] });
  const expectedRequest = { from: SWAP_MAINNET.executor, to: V7_ROUTER, data: tx.input, value: tx.value };
  const receipt = await readSwapReceipt(request, hash, {
    router: V7_ROUTER, account: SWAP_MAINNET.executor, route: { side: "sell", platformFee: 30n }, minOut: 4000000000000000n, expectedRequest,
  });
  assert.equal(receipt.amountOut, 4913637961507488n); // 净到账 = 毛收入 - 0.3%
});

test("describeRoute 输出路线文案", () => {
  const route = {
    first: { kind: "v2", key: "pancake", path: [WBNB, USDT] },
    second: { kind: "v2", key: "fst", path: [USDT, FIST] },
  };
  assert.match(describeRoute(route, "zh"), /PancakeSwap/);
  assert.match(describeRoute(route, "zh"), /FstSwap/);
  assert.match(describeRoute(route, "zh"), /USDT/);
});

test("mevSendRawTransaction 构造请求并校验响应", async () => {
  const raw = "0x02f8" + "ab".repeat(60);
  const hash = "0x" + "cd".repeat(32);
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: hash }) };
  };
  const result = await mevSendRawTransaction(raw, mockFetch);
  assert.equal(result, hash);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SWAP_MEV_ENDPOINT);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.method, "eth_sendRawTransaction");
  assert.deepEqual(body.params, [raw]);
  // 端点拒绝 → MEV_SEND_FAILED
  const failFetch = async () => ({ ok: false, json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "boom" } }) });
  await assert.rejects(() => mevSendRawTransaction(raw, failFetch), { code: "MEV_SEND_FAILED" });
  // 非法 raw → INVALID_INPUT
  await assert.rejects(() => mevSendRawTransaction("nope", mockFetch), { code: "INVALID_INPUT" });
});

test("walletSupportsSignTransaction 判定钱包能力", async () => {
  const unsupported = { request: async () => { throw Object.assign(new Error("The method eth_signTransaction does not exist"), { code: -32601 }); } };
  assert.equal(await walletSupportsSignTransaction(unsupported), false);
  const supported = { request: async () => { throw new Error("missing value for required argument 0"); } };
  assert.equal(await walletSupportsSignTransaction(supported), true);
  const noRequest = {};
  assert.equal(await walletSupportsSignTransaction(noRequest), false);
});

test("buildSignableTransaction 补全签名参数", async () => {
  const mockRequest = async ({ method }) => {
    assert.equal(method, "eth_getTransactionCount");
    return "0x5";
  };
  const tx = { from: SWAP_MAINNET.executor, to: SWAP_MAINNET.router, data: "0x12", value: "0x0" };
  const signable = await buildSignableTransaction(mockRequest, tx, 3000000000n, 1500000n);
  assert.equal(signable.chainId, "0x38");
  assert.equal(signable.nonce, "0x5");
  assert.equal(signable.gas, "0x16e360"); // 1,500,000
  assert.equal(signable.gasPrice, "0xb2d05e00"); // 3 gwei
  assert.equal(signable.from, SWAP_MAINNET.executor);
  assert.equal(signable.to, SWAP_MAINNET.router);
  assert.equal(signable.data, "0x12");
});
