// UI 走查（E2E）：注入模拟 EIP-1193 钱包（BSC 0x38），读请求转发到真实 BSC RPC，
// 发送交易/签名一律拦截记录、绝不广播。对官方版与我们的版本跑同一脚本，逐步截图 + 记录 DOM 文本。
// 用法：node tests/ui-walkthrough.mjs <official|ours> [desktop|mobile|both]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const TARGET = process.argv[2] || "official";
const LOCALE = process.env.WALK_LOCALE || "zh-CN";
const TAG = TARGET + (LOCALE === "zh-CN" ? "" : "-" + LOCALE);
const VIEWS = (process.argv[3] || "both") === "both" ? ["desktop", "mobile"] : [process.argv[3]];
const BASE = TARGET === "official" ? (process.env.OFFICIAL_URL || "http://127.0.0.1:8125/?v=1") : (process.env.OURS_URL || "http://127.0.0.1:8124/");
const READ_RPC = process.env.WALK_RPC || "https://bsc-rpc.publicnode.com";
// 只读演示地址（公开地址，仅用于读余额；不持有私钥，所有写操作被拦截）
const ACCOUNT = (process.env.WALK_ACCOUNT || "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3").toLowerCase();
const TX_MODE = process.env.WALK_TX_MODE || "success"; // success | reject
const BLOCKED = new Set(["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign",
  "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "eth_signTransaction"]);
mkdirSync("shots", { recursive: true }); mkdirSync("tests/walk-out/css", { recursive: true });

async function rpc(method, params) {
  const res = await fetch(READ_RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] }), signal: AbortSignal.timeout(Number(process.env.WALK_RPC_TIMEOUT || 15000)) });
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data });
  return json.result;
}
let sampleHash = null;
async function realTxHash() { // 取一个真实已上链的交易哈希，让“交易成功”提示能被正常轮询到
  if (sampleHash) return sampleHash;
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  sampleHash = block.transactions[0]; return sampleHash;
}

// —— v10 本地 fork 验证（可选）——
// WALK_V10_CONFIG=<json 文件>：注入 globalThis.FST_V10_CONFIG（v10 路由器 + 适配器）与 FST_RPC_OVERRIDE=[WALK_RPC]，
// 让前端所有读请求与交易目标都指向本地 anvil fork。
// WALK_LOCAL_EXEC=1：拦截到的 eth_sendTransaction 在本地 anvil 上执行（仅当 WALK_RPC 为 127.0.0.1/localhost，绝不发往真实链）。
const V10_CONFIG = process.env.WALK_V10_CONFIG ? JSON.parse(readFileSync(process.env.WALK_V10_CONFIG, "utf8")) : null;
const IS_LOCAL_RPC = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(READ_RPC);
const LOCAL_EXEC = process.env.WALK_LOCAL_EXEC === "1" && IS_LOCAL_RPC;
if (process.env.WALK_LOCAL_EXEC === "1" && !IS_LOCAL_RPC) throw new Error("WALK_LOCAL_EXEC 仅允许本地 anvil RPC");
const recorded = [];
const INIT = (account) => {
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch {} });
  let connected = false;
  const provider = {
    isMetaMask: true, chainId: "0x38", networkVersion: "56", selectedAddress: null, _walkMock: true,
    isConnected: () => true,
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return provider; },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
    removeAllListeners() { for (const k in listeners) delete listeners[k]; return provider; },
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts": connected = true; provider.selectedAddress = account; emit("connect", { chainId: "0x38" }); emit("accountsChanged", [account]); return [account];
        case "eth_accounts": return connected ? [account] : [];
        case "eth_chainId": return "0x38";
        case "net_version": return "56";
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_watchAsset": return null;
        case "wallet_requestPermissions": case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
        default: return window.__walkRpc(method, params || []).then((r) => { if (r && r.__err) throw Object.assign(new Error(r.message), { code: r.code, data: r.data }); return r; });
      }
    },
    send(a, b) { if (typeof a === "string") return provider.request({ method: a, params: b }); return provider.sendAsync(a, b); },
    sendAsync(payload, cb) { provider.request(payload).then((result) => cb(null, { id: payload.id, jsonrpc: "2.0", result }), (e) => cb(e)); },
    enable() { return provider.request({ method: "eth_requestAccounts" }); },
  };
  window.ethereum = provider;
  window.dispatchEvent(new Event("ethereum#initialized"));
};

const browser = await chromium.launch();
const report = { target: TARGET, base: BASE, account: ACCOUNT, steps: [], transactions: recorded };
for (const view of VIEWS) {
  const ctx = await browser.newContext(view === "mobile"
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: LOCALE, colorScheme: "dark" }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: LOCALE, colorScheme: "dark" });
  await ctx.exposeBinding("__walkRpc", async (_src, method, params) => {
    if (BLOCKED.has(method)) {
      const entry = { view, method, params, at: new Date().toISOString() };
      recorded.push(entry);
      await new Promise((r) => setTimeout(r, Number(process.env.WALK_SEND_DELAY || 3000))); // 留出“等待确认”弹窗截图时间
      if (TX_MODE === "reject" || method !== "eth_sendTransaction") return { __err: 1, code: 4001, message: "User rejected the request. (walkthrough mock – never broadcast)" };
      if (LOCAL_EXEC) { // 本地 anvil fork 执行（anvil 解锁账户），返回本地交易哈希
        try { const hash = await rpc("eth_sendTransaction", params); entry.localHash = hash;
          const rc = await rpc("eth_getTransactionReceipt", [hash]); entry.localStatus = rc?.status; entry.gasUsed = rc?.gasUsed; return hash; }
        catch (e) { entry.localError = e.message; return { __err: 1, code: -32603, message: e.message }; }
      }
      return realTxHash();
    }
    try { return await rpc(method, params); } catch (e) { return { __err: 1, code: e.code ?? -32603, message: e.message, data: e.data }; }
  });
  if (V10_CONFIG) await ctx.addInitScript(([cfg, rpcUrl]) => { globalThis.FST_V10_CONFIG = cfg; globalThis.FST_RPC_OVERRIDE = [rpcUrl]; }, [V10_CONFIG, READ_RPC]);
  await ctx.addInitScript(INIT, ACCOUNT);
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  let n = 0;
  const snap = async (name, ok = true, note = "") => {
    n += 1;
    const file = `shots/walk-${TAG}-${view}-${String(n).padStart(2, "0")}-${name}.png`;
    await page.waitForTimeout(700);
    await page.screenshot({ path: file });
    const text = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 3000)).catch(() => "");
    if (process.env.WALK_DUMP) {
      const html = await page.evaluate(() => document.body.outerHTML).catch(() => "");
      writeFileSync(`tests/walk-out/${TAG}-${view}-${String(n).padStart(2, "0")}-${name}.html`, html);
      {
        const css = await page.evaluate(() => [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n/* ---- */\n")).catch(() => "");
        writeFileSync(`tests/walk-out/css/${TAG}-${view}-${String(n).padStart(2, "0")}.css`, css);
      }
    }
    report.steps.push({ view, n, name, ok, note, file, url: page.url(), text });
    console.log(`[${view}] ${n} ${name} ${ok ? "ok" : "MISS"} ${note}`);
    if (process.env.WALK_STOP && n >= Number(process.env.WALK_STOP)) { await browser.close(); process.exit(0); } // 调试：只跑前 N 步
  };
  // 依次尝试多个定位器，点击第一个可见的
  const tap = async (cands) => {
    for (const c of cands) {
      const loc = typeof c === "string" ? page.locator(c) : c;
      const cnt = await loc.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) { const el = loc.nth(i); if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 4000 }).catch(() => {}); return true; } }
    }
    return false;
  };
  const go = async (hash, wait = 4000) => { await page.goto(BASE + hash, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(wait); };
  const txt = (re) => page.getByText(re);
  const esc = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); await tap(['[data-reach-dialog-overlay]', '.agg-modal__backdrop', '.modal-backdrop']).catch(() => {}); };

  await go("#/swap", 6000); await snap("swap-disconnected");
  let ok = await tap([txt(/^连接钱包$|^Connect Wallet$/).first(), "#connect-wallet", "#aggWalletBtn"]);
  await snap("wallet-modal", ok);
  ok = await tap([txt(/MetaMask/).first(), txt(/浏览器钱包|Injected/).first()]);
  await page.waitForTimeout(2500); await snap("wallet-connected", ok);
  ok = await tap(["#web3-status-connected", txt(/0x[0-9a-fA-F]{4}.*[0-9a-fA-F]{4}/).first(), "#aggWalletBtn"]);
  await snap("account-modal", ok);
  await esc(); await snap("account-closed");
  // 代币选择：输入 BNB，输出 FIST（两边站点都支持的交易对）
  const pickToken = async (query, itemSel, label) => {
    const search = page.locator("#token-search-input").first();
    const vis = await search.isVisible().catch(() => false);
    if (vis && query) { await search.fill(query); await page.waitForTimeout(800); }
    await snap("token-search-" + label, vis);
    const picked = await tap([page.locator(itemSel).first()]);
    return picked;
  };
  ok = await tap([page.locator("#swap-currency-input .open-currency-select-button").first()]);
  await snap("token-modal", ok);
  ok = await pickToken("", '[class*="token-item-ETHER"]', "bnb");
  await snap("token-selected-in", ok);
  const outNow = await page.locator("#swap-currency-output .token-symbol-container").first().innerText().catch(() => "");
  if (/FIST/.test(outNow)) { ok = true; await snap("token-search-fist", true, "output already FIST"); }
  else {
    ok = await tap([page.locator("#swap-currency-output .open-currency-select-button").first()]);
    ok = ok && await pickToken("", '[class*="token-item-0xC9882"], [class*="token-item-0xc9882"]', "fist");
  }
  if (await page.locator("#token-search-input").isVisible().catch(() => false)) await esc();
  await snap("token-selected-out", ok);
  const amount = page.locator("#swap-currency-input input.token-amount-input").first();
  ok = await amount.isVisible().catch(() => false);
  if (ok) { await amount.fill(""); await amount.type("0.001"); }
  // 报价为异步（聚合器多 DEX 询价），等待报价结果出现（最多 25s）再截图
  const waitQuote = async () => { await page.waitForFunction(() => { const v = document.querySelector("#swap-currency-output input"); return v && v.value && Number(v.value) > 0; }, null, { timeout: 25000 }).catch(() => {}); await page.waitForTimeout(1500); };
  await page.waitForTimeout(1000); await waitQuote(); await snap("amount-quote", ok);
  ok = await tap(["#open-settings-dialog-button"]);
  await snap("settings", ok);
  const slip = page.locator("#open-settings-dialog-button").locator("xpath=../..").locator("input").first();
  const slipOk = await slip.isVisible().catch(() => false);
  if (slipOk) { await slip.fill("1"); }
  await snap("settings-slippage-1", slipOk);
  await tap(["#open-settings-dialog-button"]); await page.waitForTimeout(400);
  ok = await tap(["#swap-button"]);
  await snap("swap-confirm-dialog", ok);
  ok = await tap(["#confirm-swap-or-send"]);
  await page.waitForTimeout(300); await snap("swap-pending", ok);
  await page.waitForTimeout(4000); await snap("swap-submitted", ok);
  await page.waitForTimeout(8000); await snap("swap-toast", true);
  await esc(); await tap([txt(/^关闭$|^Close$/).first()]); await esc();
  // 反向：FIST -> BNB，触发授权流程
  ok = await tap([page.locator("#swap-currency-input + div").first()]);
  await page.waitForTimeout(800);
  const amt2 = page.locator("#swap-currency-input input.token-amount-input").first();
  if (await amt2.isVisible().catch(() => false)) { await amt2.fill(""); await amt2.type("1"); }
  await page.waitForTimeout(1000); await waitQuote(); await page.waitForTimeout(1500); await snap("reverse-quote", ok);
  ok = await tap([page.locator("button").filter({ hasText: /允许 Fstswap 调用您的 FIST|^(批准|授权)\s*FIST|^Approve FIST|Allow (the )?Fstswap/ }).first()]);
  await page.waitForTimeout(3000); await snap("approve-pending", ok);
  await page.waitForTimeout(8000); await snap("approve-done", ok);
  await esc();
  // 流动池 / 添加 / 移除
  await go("#/pool", 6000); await snap("pool-list");
  ok = await tap(["#find-pool-button"]); await page.waitForTimeout(2500); await snap("pool-import", ok);
  await go("#/pool", 4000);
  ok = await tap([txt(/^创建币对$|^Create a pair$/).first()]);
  await page.waitForTimeout(5000); await snap("add-liquidity", ok);
  const addIn = page.locator("input.token-amount-input").first();
  if (await addIn.isVisible().catch(() => false)) { await addIn.type("1"); }
  await page.waitForTimeout(4000); await snap("add-liquidity-amount");
  ok = await tap([page.locator("button").filter({ hasText: /^(批准|授权)\s*USDT|^Approve USDT/ }).first()]);
  await page.waitForTimeout(3000); await snap("add-liquidity-approve", ok);
  ok = await tap([txt(/^供应$|^Supply$|^提供$/).first()]);
  await snap("add-liquidity-confirm", ok); await esc();
  await go("#/remove/v2/0x55d398326f99059ff775485246999027b3197955/0xc9882def23bc42d53895b8361d0b1edc7570bc6a", 6000);
  await snap("remove-liquidity");
  ok = await tap([txt(/^50%$/).first()]); await snap("remove-50", ok);
  if (V10_CONFIG && view === "desktop") {
    // —— v10 额外流程：代币⇄代币、精确输出、流动性（授权 → 供应 → 去除），全部经 v10 聚合路由 ——
    const FIST_ID = "0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A", USDT_ID = "0x55d398326f99059fF775485246999027B3197955";
    const typeIn = async (sel, v) => { const el = page.locator(sel).first(); if (!(await el.isVisible().catch(() => false))) return false; await el.fill(""); await el.type(v); return true; };
    const waitField = async (sel) => { await page.waitForFunction((s) => { const v = document.querySelector(s); return v && v.value && Number(v.value) > 0; }, sel, { timeout: 25000 }).catch(() => {}); await page.waitForTimeout(1200); };
    const approveSwap = async (sym) => { const hit = await tap([page.locator("button").filter({ hasText: new RegExp("允许 Fstswap 调用您的 " + sym + "|Allow (the )?Fstswap.*" + sym) }).first()]); if (hit) await page.waitForTimeout(6000); return hit; };
    const waitSubmitted = async () => { await page.waitForFunction(() => /已提交交易|Transaction Submitted|错误|Error/.test(document.body.innerText), null, { timeout: 40000 }).catch(() => {}); await page.waitForTimeout(1500); };
    const doSwap = async (name) => { let k = await tap(["#swap-button"]); await page.waitForTimeout(600); k = k && await tap(["#confirm-swap-or-send"]); await waitSubmitted(); k = k && /已提交交易|Transaction Submitted/.test(await page.evaluate(() => document.body.innerText)); await snap(name, k); await esc(); await tap([txt(/^关闭$|^Close$/).first()]); await esc(); };
    const swapCase = async (name, inId, outId, field, value) => {
      await go("#/swap?inputCurrency=" + inId + "&outputCurrency=" + outId, 5000);
      const sel = field === "out" ? "#swap-currency-output input.token-amount-input" : "#swap-currency-input input.token-amount-input";
      const typed = await typeIn(sel, value);
      await waitField(field === "out" ? "#swap-currency-input input" : "#swap-currency-output input");
      await snap(name + "-quote", typed);
      const sym = inId === "BNB" ? null : inId === FIST_ID ? "FIST" : "USDT";
      if (sym && await approveSwap(sym)) { await snap(name + "-approved", true); await waitField(field === "out" ? "#swap-currency-input input" : "#swap-currency-output input"); }
      await doSwap(name + "-sent");
    };
    await swapCase("v10-usdt-fist", USDT_ID, FIST_ID, "in", "1");
    await swapCase("v10-fist-usdt", FIST_ID, USDT_ID, "in", "0.5");
    await swapCase("v10-usdt-bnb", USDT_ID, "BNB", "in", "1");
    await swapCase("v10-bnb-usdt", "BNB", USDT_ID, "in", "0.002");
    await swapCase("v10-exactout-bnb-fist", "BNB", FIST_ID, "out", "0.3");
    await swapCase("v10-exactout-fist-bnb", FIST_ID, "BNB", "out", "0.0001");
    await swapCase("v10-exactout-usdt-fist", USDT_ID, FIST_ID, "out", "0.2");
    await swapCase("v10-exactout-fist-usdt", FIST_ID, USDT_ID, "out", "0.1");
    await swapCase("v10-exactout-usdt-bnb", USDT_ID, "BNB", "out", "0.0005");
    // 流动性：USDT-FIST 注入（授权 USDT/FIST → 供应）、去除（授权 LP → 去除）；BNB-FIST 注入 + 去除
    for (const [pairName, a, b] of [["usdt-fist", USDT_ID, FIST_ID], ["bnb-fist", "BNB", FIST_ID]]) {
      await go("#/add/v2/" + a + "/" + b, 6000);
      await typeIn("input.token-amount-input", a === "BNB" ? "0.002" : "1"); await page.waitForTimeout(4000);
      await snap("v10-add-" + pairName + "-amount");
      for (let i = 0; i < 2; i++) { const hit = await tap([page.locator("button").filter({ hasText: /^(批准|授权)\s*(USDT|FIST)|^Approve (USDT|FIST)/ }).first()]); if (!hit) break; await page.waitForTimeout(6000); }
      await snap("v10-add-" + pairName + "-approved");
      const sup = await tap([txt(/^供应$|^Supply$|^提供$/).first()]); await waitSubmitted();
      await snap("v10-add-" + pairName + "-sent", sup); await esc(); await tap([txt(/^关闭$|^Close$/).first()]); await esc();
      await go("#/remove/v2/" + (a === "BNB" ? "BNB" : a) + "/" + b, 7000);
      await tap([txt(/^50%$/).first()]); await page.waitForTimeout(800); await snap("v10-remove-" + pairName + "-50");
      const ap = await tap([page.locator("button").filter({ hasText: /^批准$|^Approve$/ }).first()]); await page.waitForTimeout(6000);
      await snap("v10-remove-" + pairName + "-approved", ap);
      await tap([txt(/^50%$/).first()]); await page.waitForTimeout(800);
      const rm = await tap([page.locator("button").filter({ hasText: /^去除$|^Remove$|^移除$/ }).first()]); await waitSubmitted();
      await snap("v10-remove-" + pairName + "-sent", rm); await esc(); await tap([txt(/^关闭$|^Close$/).first()]); await esc();
    }
  }
  // 我的 / 首页
  await go("#/my", 6000); await snap("my");
  await go("#/analysis/0x55d398326f99059ff775485246999027b3197955/0xc9882def23bc42d53895b8361d0b1edc7570bc6a", 8000); await snap("home-kline");
  ok = await tap([txt(/^1H$|^1小时$|^1h$/).first(), txt(/^4H$|^日$|^1D$/).first()]);
  await page.waitForTimeout(2500); await snap("home-kline-interval", ok);
  const canvas = page.locator("canvas").first();
  if (await canvas.isVisible().catch(() => false)) { const b = await canvas.boundingBox(); await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5); }
  await snap("home-kline-hover");
  // 语言切换
  await go("#/swap", 5000);
  ok = await tap([txt(/^English$/).first(), txt(/^简体中文$/).first(), "#aggLocale"]);
  await page.waitForTimeout(3000); await snap("lang-en", ok);
  ok = await tap([txt(/^中文|简体中文|^zh-CN$/).first(), txt(/^English$/).first(), "#aggLocale"]);
  await page.waitForTimeout(2000); await snap("lang-zh", ok);
  if (view === "mobile") {
    for (const [re, name] of [[/^首页$|^Home$/, "home"], [/^流动池$|^Pool$/, "pool"], [/^我的$|^My$/, "my"], [/^兑换$|^Swap$/, "swap"]]) {
      ok = await tap([txt(re).last()]); await page.waitForTimeout(3000); await snap("mobile-nav-" + name, ok);
    }
  }
  report.steps.push({ view, name: "page-errors", errors });
  await ctx.close();
}
await browser.close();
writeFileSync(`tests/walk-out/walk-${TAG}.json`, JSON.stringify(report, null, 2));
console.log("intercepted (never broadcast):", recorded.map((r) => r.view + ":" + r.method).join(", ") || "none");
