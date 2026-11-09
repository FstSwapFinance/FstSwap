// v10 本地 fork 只读检查（同时预热 anvil 状态缓存）：配置、聚合报价、getAmountsOutVia、精确输出报价、交易对信息。
// 用法：node tests/v10-local-quotes.mjs   （需先 tests/v10-fork-setup.sh；只读 eth_call，不发送交易）
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
globalThis.ethers = ethers;
globalThis.FST_V10_CONFIG = JSON.parse(readFileSync(new URL("./v10-local.json", import.meta.url), "utf8"));
globalThis.FST_RPC_OVERRIDE = [process.env.WALK_RPC || "http://127.0.0.1:8545"];
const A = await import("../swap-aggregator.mjs");
const req = A.swapPublicRpc(globalThis.fetch, undefined, { timeoutMs: 180000 });
const T = A.SWAP_TOKENS, ad = A.SWAP_ADAPTERS, W = ad.fst.weth;
const out = (label, v) => console.log(label.padEnd(34), v);
out("v10 ready / router", A.swapV10Ready() + " " + A.swapActiveRouter());
const cfg = await A.readSwapConfig(req); out("config", JSON.stringify(cfg));
for (const [side, amt] of [["buy", 10n ** 15n], ["sell", 10n ** 6n]]) {
  const r = await A.quoteSwap(req, { side, amountIn: amt, feeBps: 30 }); out("quoteSwap " + side, r.estimateOut + " via " + r.first.adapter);
}
out("getAmountsOutVia USDT→FIST", (await A.v10AmountsOut(req, "fst", 10n ** 18n, [T.usdt.address, T.fist.address])).join(","));
out("getAmountsOutVia USDT→FIST→WBNB", (await A.v10AmountsOut(req, "fst", 10n ** 18n, [T.usdt.address, T.fist.address, W])).join(","));
const leg = (k, path) => ({ adapter: ad[k].adapter, path });
for (const [label, first, amountOut, mode] of [
  ["exactOut BNB→0.3 FIST", leg("fst", [W, T.fist.address]), 300000n, 0],
  ["exactOut FIST→0.0001 BNB(pcs)", leg("pancake", [T.fist.address, ad.pancake.weth]), 10n ** 14n, 1],
  ["exactOut USDT→0.2 FIST", leg("fst", [T.usdt.address, T.fist.address]), 200000n, 2],
  ["exactOut FIST→0.1 USDT", leg("fst", [T.fist.address, T.usdt.address]), 10n ** 17n, 2],
  ["exactOut USDT→0.0005 BNB", leg("fst", [T.usdt.address, T.fist.address, W]), 5n * 10n ** 14n, 1],
]) { const q = await A.v10QuoteExactOutput(req, { first, amountOut, mode }); out(label, "in " + q.amountIn + " fee " + q.fee); }
const iface = new ethers.Interface(A.SWAP_ABI);
for (const [a, b] of [[T.usdt.address, T.fist.address], [W, T.fist.address]]) {
  const data = iface.encodeFunctionData("getPairInfo", [ad.fst.adapter, a, b, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]);
  const raw = await req({ method: "eth_call", params: [{ to: A.swapActiveRouter(), data }, "latest"] });
  const r = iface.decodeFunctionResult("getPairInfo", raw); out("getPairInfo", r[0] + " r0 " + r[3] + " r1 " + r[4] + " lp " + r[6]);
}
