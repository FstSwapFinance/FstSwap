// 兑换页 —— 界面逐节点复刻官方 fstswap.github.io（DOM 模板 swap-official-tpl.mjs + 样式 swap-official.css），
// 交易逻辑：全部链上操作走聚合合约，不再直连 FstSwap 路由器（0x1B6C…）。
//  - v10（SWAP_MAINNET.routerV10 已配置）：BNB⇄FIST 多 DEX 聚合 + 通用币对 V2 多 DEX 比价 + 精确输出；
//    授权对象统一为 v10 路由器；报价走 v10 getAmountsOutVia / quoteExactOutput。
//  - v10 未配置：仅 BNB⇄FIST 走已部署的 v9（0x0b31…3FD2）；其余币对与精确输出显示「聚合合约未部署」，不回退。
import { sendWalletOnce, recoverWalletIntent } from "./swap-send.mjs?v=mainnet-20261110-12";
import {
  SWAP_MAINNET, SWAP_TOKENS, SWAP_ADAPTERS, SWAP_ABI, swapUnits, swapFormatUnits,
  swapFeePolicy, v10PlanFeeConversion, v10AmountsIn, readV10Receipt,
  v10RouteCandidates, v10BestAmountsOut, v10RouteImpact, assertQuoteSafety,
  quoteSwap, preflightSwap, swapApproveRequest, readSwapReceipt, describeRoute, readSwapConfig, swapRouteSpenders,
  loadSwapLibrary, swapPublicRpc,
  swapV10Ready, swapActiveRouter, SWAP_V10_MISSING, v10AmountsOut, v10QuoteExactOutput, v10Request, swapBuyBudget, swapSellNet,
} from "./swap-aggregator.mjs?v=mainnet-20261110-12";
import { tr, T, getLanguage, tpl, part, html, mountFrame, useWallet, openWalletModal, openModal, closeModal,
  popup, significant, refreshNativeBalance } from "./swap-shell.mjs?v=mainnet-20261110-12";
import { formatAmountInput, limitAmountDecimals } from "./swap-amount.mjs";
import { applyTokenLogo } from "./swap-token-logo.mjs";
import { refreshDefaultList, openManageView, onTokensChanged, activeTokenEntries, findActiveToken, readToken, isAddress, searchImportRow } from "./swap-manage.mjs?v=mainnet-20261110-12";

import { createApprovalTracker, waitForApprovalReceipt } from "./swap-approval.mjs";
import { readPoolPolicy } from "./swap-liquidity.mjs?v=mainnet-20261110-12";

const approvals = createApprovalTracker();
const BPS = 10000n;
const HISTORY_KEY = "swap_history_v1";
const SETTINGS_KEY = "swap_settings_v2";
const FST_WBNB = SWAP_ADAPTERS.fst.weth;
export const TOKENS = {
  bnb: { key: "bnb", symbol: "BNB", name: "BSC", decimals: 18, address: null, id: "BNB", item: "token-item-ETHER" },
  usdt: { key: "usdt", symbol: "USDT", name: "Tether USD", decimals: 18, address: SWAP_TOKENS.usdt.address, id: SWAP_TOKENS.usdt.address, item: "token-item-" + SWAP_TOKENS.usdt.address },
  fist: { key: "fist", symbol: "FIST", name: "FstSwap", decimals: 6, address: SWAP_TOKENS.fist.address, id: SWAP_TOKENS.fist.address, item: "token-item-" + SWAP_TOKENS.fist.address },
};
let ORDER = ["bnb", "usdt", "fist"];
// 代币注册表跟随「管理代币列表」（官方 useAllTokens = 激活列表 + 用户添加）；USDT / FIST 来自默认 FSTSWAP 列表。
export function syncTokenRegistry() {
  const keys = ["bnb"];
  for (const t of activeTokenEntries()) {
    const a = t.address.toLowerCase();
    let k = Object.keys(TOKENS).find((x) => TOKENS[x].address && TOKENS[x].address.toLowerCase() === a);
    if (!k) { k = a; TOKENS[k] = { key: k, symbol: t.symbol, name: t.name, decimals: Number(t.decimals), address: t.address, id: t.address, item: "token-item-" + t.address }; }
    Object.assign(TOKENS[k], {name:t.name,symbol:t.symbol,decimals:t.decimals,logoURI:t.logoURI,userAdded:Boolean(t.userAdded)});
    if (!keys.includes(k)) keys.push(k);
  }
  ORDER = keys;
}
syncTokenRegistry();
onTokensChanged(syncTokenRegistry);
// FstSwap FIST/WBNB(Fst) 交易对：v9 模式下价格影响的中间价参照（读池储备，不调用 FstSwap 路由器）
const FST_FIST_WBNB_PAIR = "0x796acbA6556f70A3c5756A0d8Fd0a10251c21050";
const PAIR_ABI = ["function getReserves() view returns (uint112, uint112, uint32)", "function token0() view returns (address)"];
const ZERO = "0x0000000000000000000000000000000000000000";
const NO_LEG = { adapter: ZERO, path: [] };
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];

/// 官方 CurrencyAmount.toSignificant（ROUND_DOWN，精确十进制）。
export function sigDown(value, decimals, digits) {
  if (value == null) return "-";
  if (value === 0n) return "0";
  const s = value.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, ""), frac = s.slice(s.length - decimals);
  const all = (int === "0" ? "" : int) + frac; const lead = int === "0" ? frac.search(/[1-9]/) : 0;
  if (int !== "0" && int.length >= digits) return int.slice(0, digits) + "0".repeat(int.length - digits);
  const keepFrac = int === "0" ? lead + digits : digits - int.length;
  const out = int + "." + frac.slice(0, keepFrac);
  return out.replace(/\.?0+$/, "") || "0";
}
/// 官方 Price.toSignificant（ROUND_HALF_UP）。
export function sigPrice(num, digits = 4) {
  if (!Number.isFinite(num) || num <= 0) return "0";
  return String(Number(num.toPrecision(digits)));
}
const fmtTokens = (amount, token) => sigDown(amount, token.decimals, 6);

function readSettings() {
  try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); return { slippageBps: 50, slippageAuto: !("slippageBps" in saved), deadlineMinutes: 30, expert: false, singleHop: false, ...saved }; }
  catch { return { slippageBps: 50, slippageAuto: true, deadlineMinutes: 30, expert: false, singleHop: false }; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }
function saveHistory(entry) {
  try { const list = [entry, ...JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").filter((i) => i.hash !== entry.hash)].slice(0, 20); localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {}
}

// 页面级状态（跨路由保留选择，和官方 redux 一致）
const page = { inKey: null, outKey: null, connectedDefaults: false };

export async function mountSwapView(root) {
  const wallet = useWallet();
  const request = swapPublicRpc();
  // Short, abortable reads for wallet actions; market/chart reads keep their own retry policy.
  const transactionRead = payload => swapPublicRpc(globalThis.fetch, AbortSignal.timeout(6000), { attempts: 2, timeoutMs: 2000 })(payload);
  const settings = readSettings();
  const state = {
    amount: "", amountOut: "", independent: "in", quote: null, quoteError: "", balances: {}, balanceErrors: {}, balanceEpoch: 0, allowance: null, config: null,
    showInverted: false, settingsOpen: false, seq: 0,
  };
  try { await loadSwapLibrary(); } catch {}
  const ethers = globalThis.ethers;

  // —— 骨架：官方 main（AppBody）+ SwapHeader + #swap-page ——
  const main = tpl("swap_empty");
  main.classList.add("fst-swap-card");
  mountFrame(root, "swap", main);
  const $ = (s) => main.querySelector(s);
  const settingsWrap = $(".eWRqBu");
  const swapPage = $("#swap-page");
  const card = swapPage.firstElementChild; // AutoColumn gap
  const panelsCol = card.firstElementChild; // <div> 输入 / 箭头 / 输出
  let tradeRow = card.children[1];        // 价格行容器（空时 justify-content:center）
  let bottom = card.children[2];            // 按钮区

  const token = (k) => (k ? TOKENS[k] : null);
  const inT = () => token(page.inKey), outT = () => token(page.outKey);
  const isAggPair = () => [page.inKey, page.outKey].sort().join("/") === "bnb/fist";
  const side = () => (page.inKey === "bnb" ? "buy" : "sell");
  const routeSymbols = () => {
    if (!inT() || !outT()) return [];
    const firstPath = state.quote?.first?.path;
    const p = Array.isArray(firstPath) ? [...firstPath, ...(state.quote?.second?.path?.slice(1) || [])] : null;
    if (!Array.isArray(p)) return [inT().symbol, outT().symbol];
    return p.map((a, n) => n === 0 ? inT().symbol : n === p.length - 1 ? outT().symbol
      : Object.values(TOKENS).find(t => t.address?.toLowerCase() === a.toLowerCase())?.symbol
        || (Object.values(SWAP_ADAPTERS).some(d => d.weth.toLowerCase() === a.toLowerCase()) ? "WBNB" : a.slice(0, 6) + "…"));
  };

  // —— 币种输入面板（官方 CurrencyInputPanel） ——
  function panel(id, tk, value, { showMax }) {
    const src = tk ? part("swap_quoted", "#" + id) : part("swap_empty", "#" + id);
    const btn = src.querySelector(".open-currency-select-button");
    if (tk) {
      const logoBox = btn.querySelector(".iWJdVe");
      logoBox.querySelector(".token-symbol-container").textContent = tk.symbol;
      const replacement = tk.key === "bnb" ? part("swap_quoted", "#swap-currency-input .iWJdVe > img") : part("swap_quoted", "#swap-currency-output .iWJdVe > svg");
      const logo = logoBox.firstElementChild;
      if (replacement && logo && !logo.classList.contains("token-symbol-container")) { logo.replaceWith(replacement); applyTokenLogo(replacement, tk); }
    }
    const input = src.querySelector("input.token-amount-input");
    input.value = limitAmountDecimals(value); input.setAttribute("value", input.value); input.title = value || "";
    if (id === "swap-currency-output") input.readOnly = false; // 精确输出（v10）：可在输出框输入
    const fiat = src.querySelector(".fNKPVt > div");
    if (fiat) {
      const left = fiat.firstElementChild;
      if (tk) {
        left.classList.add("fst-balance-row");
        const bal = state.balances[tk.key];
        const balText = left.querySelector(".css-djrxae");
        if (balText) {
          const value = !wallet.account ? "—" : state.balanceErrors[tk.key] ? tr("读取失败", "Unavailable") : bal == null ? tr("读取中…", "Loading…") : formatBalance(bal, tk) + " " + tk.symbol;
          balText.textContent = tr("余额：", "Balance: ") + value;
          balText.style.cursor = "default";
          balText.title = !wallet.account ? tr("连接钱包后查看余额", "Connect a wallet to view your balance") : "";
        }
        const max = left.querySelector("button.cfnxzr");
        if (max && !showMax) max.remove();
        if (max && showMax) {
          max.type = "button";
          max.disabled = !wallet.account || bal == null || Boolean(state.balanceErrors[tk.key]) || bal === 0n;
          max.addEventListener("click", () => setMax());
        }
      } else { left.replaceWith(document.createElement("span")); }
    }
    btn.addEventListener("click", () => openTokenModal(id === "swap-currency-input" ? "in" : "out"));
    if (id === "swap-currency-input") input.addEventListener("input", onAmountInput);
    else input.addEventListener("input", onAmountOutInput);
    return src;
  }
  function formatBalance(bal, tk) {
    if (bal === 0n) return "0";
    const scale = 10n ** BigInt(tk.decimals);
    if (bal * 100000n < scale) return "<0.00001";
    return sigDown(bal, tk.decimals, 9);
  }

  function renderPanels() {
    const exactOut = state.independent === "out";
    const outVal = exactOut ? state.amountOut : state.quote ? formatAmountInput(state.quote.out, outT().decimals) : "";
    const inVal = exactOut ? (state.quote ? formatAmountInput(state.quote.amountIn, inT().decimals) : "") : state.amount;
    const arrow = part("swap_quoted", ".hDVbXn");
    arrow.style.cursor = "pointer";
    arrow.addEventListener("click", flip);
    const showMax = Boolean(inT());
    const inEl = panel("swap-currency-input", inT(), inVal, { showMax });
    const outEl = panel("swap-currency-output", outT(), outVal, { showMax: false });
    panelsCol.replaceChildren(inEl, arrow, outEl);
    const input = (exactOut ? outEl : inEl).querySelector("input");
    if (document.activeElement?.classList?.contains("token-amount-input") || state.refocus) {
      state.refocus = false; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  // —— 价格行 + 详情（官方 TradePrice + AdvancedSwapDetails） ——
  function renderTrade() {
    const q = state.quote;
    const existingDetails = card.querySelector(":scope > .cKJcLm");
    existingDetails?.remove();
    if (!q) {
      const empty = part("swap_empty", "#swap-page > div > div:nth-child(2)");
      tradeRow.replaceWith(empty); tradeRow = empty; return;
    }
    const row = part("swap_quoted", "#swap-page > div > div:nth-child(2)");
    const priceBtn = row.querySelector("button.kePVKR");
    const text = priceText(q);
    priceBtn.title = text + " "; priceBtn.querySelector(".css-1ieyfqs").textContent = text;
    priceBtn.addEventListener("click", () => { state.showInverted = !state.showInverted; renderTrade(); });
    tradeRow.replaceWith(row); tradeRow = row;
    const details = detailsEl(q);
    row.after(details);
  }
  function priceText(q) {
    const a = q.amountIn, b = q.out, ti = inT(), to = outT();
    const inNum = Number(swapFormatUnits(a, ti.decimals)), outNum = Number(swapFormatUnits(b, to.decimals));
    // 官方默认 showInverted=false：显示 “1 输出 = x 输入”
    return state.showInverted ? "1 " + ti.symbol + " = " + sigPrice(outNum / inNum) + " " + to.symbol
      : "1 " + to.symbol + " = " + sigPrice(inNum / outNum) + " " + ti.symbol;
  }
  function detailsEl(q) {
    const el = part("swap_quoted", "#swap-page .cKJcLm");
    const rows = el.querySelectorAll(":scope > div");
    const val = (i) => rows[i]?.querySelector(":scope > .css-16sxy43");
    rows[0].firstElementChild.textContent = tr("平台手续费", "Platform fee");
    val(0).textContent = sigDown(q.lpFee, (q.feeAsset || inT()).decimals, 4) + " " + (q.feeAsset || inT()).symbol;
    // 途径：官方 SwapRoute（代币 › 代币）；聚合器的实际 DEX 路线放到 title
    const routeBox = val(1).querySelector(".css-q0g5a7");
    const tokenTpl = routeBox.querySelector(".css-1rojlue"), chevron = routeBox.querySelector("svg");
    const syms = routeSymbols(); routeBox.replaceChildren();
    syms.forEach((s, i) => { if (i) routeBox.append(chevron.cloneNode(true)); const t = tokenTpl.cloneNode(true); t.querySelector(".css-5ds0tb").textContent = s; routeBox.append(t); });
    if (q.route) val(1).title = describeRoute(q.route, getLanguage());
    const impact = val(2).querySelector(".hHwHpX"); impact.textContent = formatImpact(q.impact);
    if (q.exactOut) {
      val(3).textContent = fmtTokens(q.maxIn, inT()) + " " + inT().symbol;
      const label = rows[3]?.querySelector(":scope > div:first-child div, :scope > div:first-child");
      if (label && label.firstChild?.nodeType === 3) label.firstChild.nodeValue = tr("最多卖出", "Maximum sold");
    } else val(3).textContent = fmtTokens(minOut(q), outT()) + " " + outT().symbol;
    val(4).textContent = (settings.slippageBps / 100).toFixed(2) + "%";
    return el;
  }
  const formatImpact = (v) => (v == null ? "-" : v < 0.0001 && v > 0 ? "<0.01%" : (Math.max(0, v) * 100).toFixed(2) + "%");
  const minOut = (q) => q.out * (BPS - BigInt(settings.slippageBps)) / BPS;

  // —— 按钮区（官方三态：连接钱包 / 输入数额·余额不足 / 授权+兑换） ——
  function renderBottom() {
    let next;
    const q = state.quote;
    const approving = approvals.pending(approvalIdentity());
    if (!wallet.account) {
      next = part("swap_empty", "#swap-page > div > div:nth-child(3)");
      next.querySelector("button").addEventListener("click", () => openWalletModal());
    } else {
      const needApprove = q && needsApproval();
      next = part(needApprove ? "swap_approve" : (q ? "swap_quoted" : "swap_connected"), "#swap-page > div > div:nth-child(" + (q ? 4 : 3) + ")");
      const swapBtn = next.querySelector("#swap-button");
      const label = swapBtn.querySelector(".css-1yxyz72") || swapBtn;
      const err = inputError();
      if (err) { label.textContent = err; swapBtn.disabled = true; swapBtn.className = part("swap_connected", "#swap-button").className; }
      else if (inT()?.key !== "bnb" && state.allowance == null) { label.textContent = tr("刷新授权状态", "Refresh approval"); swapBtn.disabled = false; }
      else if (needApprove) { swapBtn.disabled = true; }
      else { label.textContent = T("兑换"); swapBtn.disabled = false; }
      if (!swapBtn.disabled) swapBtn.addEventListener("click", async()=>{
        if(inT()?.key!=="bnb"&&state.allowance==null){swapBtn.disabled=true;await refreshAllowance();renderBottom();return;}
        openConfirm();
      });
      if (needApprove) {
        const approveBtn = next.querySelector("button:not(#swap-button)");
        const span = approveBtn.querySelector(":scope > div > span");
        const icon = span.querySelector("svg");
        span.replaceChildren(...(icon ? [icon] : []), document.createTextNode(approving ? tr("批准中", "Approving") : tr("允许 Fstswap 调用您的 ", "Allow the Fstswap Protocol to use your ") + inT().symbol));
        applyTokenLogo(icon, inT());
        approveBtn.disabled = approving;
        if (!approving) approveBtn.addEventListener("click", approve);
      }
    }
    bottom.replaceWith(next); bottom = next;
    renderPoolLink();
  }
  function renderPoolLink() {
    card.querySelector(":scope > .dAunsx")?.remove();
    if (!wallet.account || !inT() || !outT()) return;
    const link = part("swap_connected", "#swap-page .dAunsx");
    link.querySelector("a").href = "#/analysis/" + inT().id + "/" + outT().id;
    bottom.after(link);
  }
  function inputError() {
    if (!inT() || !outT()) return T("选择代币");
    const typed = state.independent === "out" ? state.amountOut : state.amount;
    if (!typed || !(Number(typed) > 0)) return T("输入数额");
    if (state.quoteError === SWAP_V10_MISSING.code) return tr(SWAP_V10_MISSING.zh, SWAP_V10_MISSING.en);
    if (state.quoteError === "NO_ROUTE") return T("现有流动量不足以支持此交易。");
    if (state.quoteError === "POOL_LIQUIDITY") return tr("没有符合流动性要求的池子，请稍后重试", "No pool meets the liquidity requirements");
    if (state.quoteError === "PRICE_IMPACT_TOO_HIGH") return tr("价格影响与滑点超过 15%，请减少金额或滑点", "Price impact and slippage exceed 15%; reduce amount or slippage");
    if (state.quoteError === "UNSAFE_QUOTE") return tr("兑换价格或流动性异常，已停止兑换", "Unsafe price or liquidity; swap unavailable");
    if (!state.quote) return T("输入数额");
    const bal = state.balances[page.inKey];
    if (bal != null && bal < (state.quote.maxIn ?? state.quote.amountIn)) return tr(inT().symbol + " 余额不足", "Insufficient " + inT().symbol + " balance");
    return "";
  }
  function needsApproval() {
    if (!inT() || inT().key === "bnb" || !state.quote) return false;
    return state.allowance != null && state.allowance < (state.quote.maxIn ?? state.quote.amountIn);
  }

  function render() { renderPanels(); renderTrade(); renderBottom(); }

  // —— 设置弹层（官方 SettingsTab + TransactionSettings） ——
  function renderSettings() {
    const fresh = part(state.settingsOpen ? "swap_settings" : "swap_empty", ".eWRqBu");
    const btn = fresh.querySelector("#open-settings-dialog-button");
    btn.addEventListener("click", (e) => { e.stopPropagation(); state.settingsOpen = !state.settingsOpen; renderSettings(); });
    const fly = fresh.querySelector(".llqzho");
    if (fly) {
      fly.addEventListener("click", (e) => e.stopPropagation());
      const groups = fly.querySelectorAll(".bPPnFe");
      const slipBtns = groups[0].querySelectorAll(".jmNfaf")[0].querySelectorAll("button");
      const presets = [10, 20, 50, 100];
      slipBtns.forEach((b, i) => {
        b.className = b.className.replace(/\b(fpFSKc|jLxtdz)\b/, !settings.slippageAuto && settings.slippageBps === presets[i] ? "jLxtdz" : "fpFSKc");
        b.addEventListener("click", () => { settings.slippageBps = presets[i]; settings.slippageAuto = false; state.customSlip = ""; saveSettings(settings); state.quote=null; renderSettings(); renderTrade(); scheduleQuote(0); });
      });
      // 官方 OptionCustom：用户自定义（非 auto）时高亮（lagkxn），输入框显示 toFixed(2)
      const slipInput = groups[0].querySelector("input"); const custom = slipInput.closest("button, .hQBzuZ, .lagkxn");
      if (custom) custom.className = custom.className.replace(/\b(hQBzuZ|lagkxn)\b/, settings.slippageAuto ? "hQBzuZ" : "lagkxn");
      slipInput.value = state.customSlip || (settings.slippageAuto ? "" : (settings.slippageBps / 100).toFixed(2)); slipInput.setAttribute("placeholder", (settings.slippageBps / 100).toFixed(2));
      slipInput.addEventListener("input", () => {
        state.customSlip = slipInput.value;
        if (slipInput.value === "") { settings.slippageAuto = true; settings.slippageBps = 50; saveSettings(settings); state.quote=null; renderTrade(); scheduleQuote(0); return; }
        const v = Math.floor(Number(slipInput.value) * 100);
        if (Number.isSafeInteger(v) && v >= 0 && v <= 5000) { settings.slippageBps = v; settings.slippageAuto = false; saveSettings(settings); state.quote=null; renderTrade(); scheduleQuote(0);
          slipBtns.forEach((b, i) => { b.className = b.className.replace(/\b(fpFSKc|jLxtdz)\b/, v === presets[i] ? "jLxtdz" : "fpFSKc"); });
          if (custom) custom.className = custom.className.replace(/\b(hQBzuZ|lagkxn)\b/, "lagkxn"); }
      });
      slipInput.addEventListener("blur", () => { state.customSlip = ""; });
      const dlBtns = groups[1].querySelectorAll(".jmNfaf")[0].querySelectorAll("button"); const dls = [10, 20, 30];
      dlBtns.forEach((b, i) => {
        b.className = b.className.replace(/\b(fpFSKc|jLxtdz)\b/, settings.deadlineMinutes === dls[i] ? "jLxtdz" : "fpFSKc");
        b.addEventListener("click", () => { settings.deadlineMinutes = dls[i]; saveSettings(settings); renderSettings(); });
      });
      const dlInput = groups[1].querySelector("input"); dlInput.setAttribute("placeholder", String(settings.deadlineMinutes));
      dlInput.addEventListener("input", () => { const v = Number(dlInput.value); if (Number.isSafeInteger(v) && v >= 1 && v <= 180) { settings.deadlineMinutes = v; saveSettings(settings); } });
      const toggle = (id, key, onChange) => {
        const t = fly.querySelector("#" + id); const [on, off] = t.querySelectorAll("span");
        on.className = on.className.replace(/\b(iRRrwD|ksfRJa)\b/, settings[key] ? "ksfRJa" : "iRRrwD");
        off.className = off.className.replace(/\b(iRRrwD|ksfRJa)\b/, settings[key] ? "iRRrwD" : "ksfRJa");
        t.addEventListener("click", () => { settings[key] = !settings[key]; saveSettings(settings); renderSettings(); onChange?.(); });
      };
      toggle("toggle-expert-mode-button", "expert");
      toggle("toggle-disable-multihop-button", "singleHop", () => scheduleQuote(0));
    }
    settingsWrap.replaceChildren(...fresh.childNodes);
  }
  document.addEventListener("click", () => { if (state.settingsOpen && main.isConnected) { state.settingsOpen = false; renderSettings(); } });

  // —— 代币选择弹窗（官方 CurrencySearchModal） ——
  function openTokenModal(field) {
    const overlay = tpl("token_modal");
    const listHost = overlay.querySelector('div[style*="flex: 1 1 0%"]');
    const scroller = listHost.querySelector('div[style*="overflow: auto"]');
    const inner = scroller.firstElementChild;
    const rowTpl = {}; inner.querySelectorAll(":scope > div").forEach((r) => { const k = ["bnb", "usdt", "fist"].find((key) => r.className.toLowerCase().includes(TOKENS[key].item.toLowerCase())); if (k) rowTpl[k] = r.cloneNode(true); });
    const emptyView = part("token_search_empty", 'div[style*="padding: 20px"]');
    const search = overlay.querySelector("#token-search-input");
    const selected = field === "in" ? page.inKey : page.outKey, other = field === "in" ? page.outKey : page.inKey;
    const genericTpl = rowTpl.usdt || rowTpl.fist;
    // 列表 / 用户添加代币的行：官方 CurrencyRow（图标加载失败 → 斜杠圆圈；用户添加的名称后缀「• 由用户添加」）
    const rowFor = (k) => {
      const t = TOKENS[k]; const r = (rowTpl[k] || genericTpl).cloneNode(true);
      if (!rowTpl[k]) { r.className = r.className.replace(/token-item-\S+/, t.item); const sym = r.querySelector(".css-8mokm4"); sym.textContent = t.symbol; sym.title = t.name; }
      const nm = r.querySelector(".css-165qfk5"); if (nm && t.address) nm.textContent = t.name + (t.userAdded ? tr(" • 由用户添加", " • Added by user") : "");
      applyTokenLogo(r.querySelector(":scope > svg, :scope > img"), t);
      return r;
    };
    // 官方 useTokenComparator：BNB 置顶，其余按余额（原始数量）降序，再按符号字母序；未连接钱包保持列表顺序
    const sortKeys = (keys) => {
      if (!wallet.account) return keys;
      const rest = keys.filter((k) => k !== "bnb").sort((a, b) => {
        const A = state.balances[a], B = state.balances[b]; let c = 0;
        if (A != null && B != null) c = A > B ? -1 : A === B ? 0 : 1; else if (A != null && A > 0n) c = -1; else if (B != null && B > 0n) c = 1;
        if (c) return c; return TOKENS[a].symbol.toLowerCase() < TOKENS[b].symbol.toLowerCase() ? -1 : 1;
      });
      return keys.includes("bnb") ? ["bnb", ...rest] : rest;
    };
    // Token metadata always comes from BSC, even when the wallet is on another chain.
    const readRpc = swapPublicRpc();
    const dialog = overlay.querySelector("[data-reach-dialog-content]");
    const searchCls = dialog.className, searchNodes = [...dialog.childNodes];
    let manager = null, searchSeq = 0;
    const backToSearch = () => { manager?.dispose(); searchSeq++; dialog.className = searchCls; dialog.replaceChildren(...searchNodes); search.value = ""; draw(); search.focus(); }; // 官方：CurrencySearch 重新挂载，搜索词清空
    const pickImported = (t) => { syncTokenRegistry(); const k = ORDER.find((x) => TOKENS[x].address && TOKENS[x].address.toLowerCase() === t.address.toLowerCase()); closeModal(); if (k) selectToken(field, k); };
    const manage = (opts = {}) => { searchSeq++; manager?.dispose(); manager = openManageView({ content: dialog, onBack: backToSearch, onClose: closeModal, onSelectToken: pickImported, request: readRpc, ...opts }); };
    // 「管理代币列表」：原先未绑定任何事件（按钮点不开的原因），现在切到官方 Manage 视图
    overlay.querySelector(".list-token-manage-button")?.addEventListener("click", () => manage());
    const draw = () => {
      if (!dialog.contains(search)) return;
      const q = search.value.trim().toLowerCase(); const seq = ++searchSeq;
      const keys = sortKeys(ORDER.filter((k) => !q || TOKENS[k].symbol.toLowerCase().includes(q) || TOKENS[k].name.toLowerCase().includes(q) || (TOKENS[k].address || "").toLowerCase() === q));
      const container = overlay.querySelector('div[style*="flex: 1 1 0%"]') || overlay.querySelector('div[style*="padding: 20px"]');
      if (!keys.length) {
        container.replaceWith(emptyView.cloneNode(true));
        // 官方 CurrencySearch：粘贴未在激活列表中的合约地址 → 显示导入行，点「导入」进入导入代币页
        if (isAddress(q)) readToken(readRpc, q).then((t) => {
          if (!t || seq !== searchSeq || !overlay.isConnected || !dialog.contains(search) || findActiveToken(t.address)) return;
          const box = overlay.querySelector('div[style*="padding: 20px"]'); if (!box) return;
          const col = document.createElement("div"); col.className = box.className; col.setAttribute("style", "padding: 20px 0px; height: 100%;");
          col.append(searchImportRow(t, () => manage({ initial: "importToken", importToken: t }))); box.replaceWith(col);
        }).catch(() => {});
        return;
      }
      const list = listHost; if (container !== list) container.replaceWith(list);
      inner.replaceChildren(); inner.style.height = keys.length * 56 + "px";
      keys.forEach((k, i) => {
        const r = rowFor(k); const base = r.className.replace(/\b(hkWdsr|hhKaCX|LPcFh)\b/, "").trim();
        r.className = base + " " + (k === selected ? "hhKaCX" : k === other ? "LPcFh" : "hkWdsr");
        if (k === selected) r.setAttribute("disabled", ""); else r.removeAttribute("disabled");
        r.style.top = i * 56 + "px";
        const balBox = r.querySelector(".hpHOqm");
        const bal = state.balances[k];
        if (balBox) { if (wallet.account && bal != null) { balBox.textContent = sigDown(bal, TOKENS[k].decimals, 4); balBox.title = swapFormatUnits(bal, TOKENS[k].decimals); } else balBox.parentElement.replaceChildren(); }
        if (k !== selected) r.addEventListener("click", () => { closeModal(); selectToken(field, k); });
        inner.append(r);
      });
    };
    search.addEventListener("input", draw);
    overlay.querySelector(".jmNfaf > svg")?.addEventListener("click", closeModal);
    openModal(overlay);
    const h = listHost.getBoundingClientRect().height; if (h > 0) scroller.style.height = Math.floor(h) + "px";
    const trig = listHost.querySelector(".expand-trigger > div"); if (trig) { trig.style.width = Math.floor(listHost.getBoundingClientRect().width + 1) + "px"; trig.style.height = Math.floor(h + 1) + "px"; }
    draw(); search.focus();
    loadAllBalances().then(() => { if (overlay.isConnected) draw(); });
  }
  function selectToken(field, key) {
    if (field === "in") { if (page.outKey === key) page.outKey = page.inKey; page.inKey = key; }
    else { if (page.inKey === key) page.inKey = page.outKey; page.outKey = key; }
    state.quote = null; state.allowance = null; render(); refreshBalances(); scheduleQuote(0);
  }
  function flip() {
    [page.inKey, page.outKey] = [page.outKey, page.inKey];
    if (state.independent === "out") { state.amount = state.amountOut; state.amountOut = ""; state.independent = "in"; }
    else state.amount = state.quote ? formatAmountInput(state.quote.out, (inT() || TOKENS.bnb).decimals) : limitAmountDecimals(state.amount);
    state.quote = null; state.allowance = null; render(); refreshBalances(); scheduleQuote(0);
  }

  // —— 余额（BSC 公共只读 RPC）/ 授权（钱包 provider） ——
  const walletCall = (method, params) => wallet.provider.request({ method, params });
  async function balanceOf(k, account) {
    const t = TOKENS[k];
    if (!t.address) return BigInt(await request({ method: "eth_getBalance", params: [account, "latest"] }));
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData("balanceOf", [account]);
    return BigInt(await request({ method: "eth_call", params: [{ to: t.address, data }, "latest"] }));
  }
  async function loadBalances(keys) {
    const account = wallet.account, epoch = state.balanceEpoch;
    if (!account) return;
    await Promise.all([...new Set(keys)].map(async (k) => {
      try {
        const bal = await balanceOf(k, account);
        if (wallet.account !== account || state.balanceEpoch !== epoch) return;
        state.balances[k] = bal; delete state.balanceErrors[k];
      } catch {
        if (wallet.account !== account || state.balanceEpoch !== epoch) return;
        delete state.balances[k]; state.balanceErrors[k] = true;
      }
    }));
  }
  async function loadAllBalances() {
    await loadBalances(ORDER);
  }
  async function refreshBalances() {
    if (!wallet.account) return;
    const keys = [page.inKey, page.outKey].filter(Boolean);
    await loadBalances(keys);
    if (!main.isConnected) return;
    renderPanels(); renderBottom();
    await refreshAllowance();
    if (main.isConnected) renderBottom();
  }
  // 授权对象：v10 → 统一授权 v10 路由器；v9（仅 BNB⇄FIST 卖出）→ 首段适配器（v9 由适配器 transferFrom）；否则无（未部署）
  function spender() {
    if (swapV10Ready()) return swapActiveRouter();
    return isAggPair() && state.quote?.route ? swapRouteSpenders(state.quote.route)[0] : null;
  }
  function approvalIdentity() { return { account: wallet.account, token: inT()?.address, spender: spender() }; }
  async function refreshAllowance(blockTag="latest") {
    state.allowance = null;
    if (!wallet.account || !inT() || inT().key === "bnb" || !state.quote) return;
    const sp = spender(); if (!sp) return;
    const account=wallet.account,token=inT().address,quote=state.quote;
    try {
      const data = new ethers.Interface(ERC20_ABI).encodeFunctionData("allowance", [account, sp]);
      const allowance=BigInt(await transactionRead({method:"eth_call",params:[{ to:token, data }, blockTag]}));
      if(wallet.account===account&&inT()?.address===token&&state.quote===quote&&spender()===sp)state.allowance=allowance;
    } catch { /* Unknown allowance is not the same as insufficient allowance. */ }
  }

  // —— 报价 ——
  let quoteTimer = null;
  function scheduleQuote(ms = 300) { clearTimeout(quoteTimer); quoteTimer = setTimeout(refreshQuote, ms); }
  function onAmountInput(e) {
    const v = limitAmountDecimals(e.target.value.replace(/,/g, "."));
    if (v !== "" && !/^\d*\.?\d*$/.test(v)) { e.target.value = state.amount; return; }
    e.target.value = v; state.amount = v; state.independent = "in"; state.amountOut = ""; state.quote = null; state.quoteError = ""; state.refocus = true;
    renderTrade(); renderBottom();
    const out = main.querySelector("#swap-currency-output input"); if (out) out.value = "";
    scheduleQuote();
  }
  // 精确输出：在输出框输入（官方 Field.OUTPUT）。仅 v10 支持；未部署时提示「聚合合约未部署」。
  function onAmountOutInput(e) {
    const v = limitAmountDecimals(e.target.value.replace(/,/g, "."));
    if (v !== "" && !/^\d*\.?\d*$/.test(v)) { e.target.value = state.amountOut; return; }
    e.target.value = v; state.amountOut = v; state.independent = "out"; state.quote = null; state.quoteError = ""; state.refocus = true;
    renderTrade(); renderBottom();
    const inp = main.querySelector("#swap-currency-input input"); if (inp) inp.value = "";
    scheduleQuote();
  }
  function setMax() {
    const bal = state.balances[page.inKey]; if (bal == null || !inT()) return;
    const MIN_BNB = 10n ** 16n; // 官方 maxAmountSpend：原生币预留 0.01
    const max = inT().key === "bnb" ? (bal > MIN_BNB ? bal - MIN_BNB : 0n) : bal;
    state.amount = swapFormatUnits(max, inT().decimals); state.independent = "in"; state.amountOut = ""; state.quote = null; render(); scheduleQuote(0);
  }
  const missing = () => Object.assign(new Error(SWAP_V10_MISSING.zh), { code: SWAP_V10_MISSING.code });
  // FstSwap 报价：v10 经聚合路由 getAmountsOutVia(FstSwap 适配器)；不直连 FstSwap 路由器
  async function fstAmounts(amountIn, path) {
    if (!swapV10Ready()) throw missing();
    return v10AmountsOut(request, "fst", amountIn, path);
  }
  // 中间价参照（价格影响）：v10 → 小额 getAmountsOutVia；v9 → FstSwap FIST/WBNB 池储备（只读交易对，不调用路由器）
  async function midOut(tiny, path) {
    if (swapV10Ready()) return (await fstAmounts(tiny, path)).at(-1);
    const iface = new ethers.Interface(PAIR_ABI);
    const [r0raw, t0raw] = await Promise.all([
      request({ method: "eth_call", params: [{ to: FST_FIST_WBNB_PAIR, data: iface.encodeFunctionData("getReserves", []) }, "latest"] }),
      request({ method: "eth_call", params: [{ to: FST_FIST_WBNB_PAIR, data: iface.encodeFunctionData("token0", []) }, "latest"] }),
    ]);
    const [r0, r1] = iface.decodeFunctionResult("getReserves", r0raw);
    const t0 = iface.decodeFunctionResult("token0", t0raw)[0];
    const inIs0 = t0.toLowerCase() === path[0].toLowerCase();
    const [rin, rout] = inIs0 ? [BigInt(r0), BigInt(r1)] : [BigInt(r1), BigInt(r0)];
    return tiny * rout * 9975n / (rin * 10000n);
  }
  const impactOf = (amountIn, out, tiny, ref) => Math.max(0, 1 - (Number(out) / Number(amountIn)) / (Number(ref) / Number(tiny)));
  const feeBpsNow = () => state.config?.platformFeeBps ?? 30;
  // 精确输入与精确输出使用同一份已启用 DEX / 中间币候选。
  function exactOutCandidates(ti, to) {
    return v10RouteCandidates(ti.address, to.address, { singleHop: settings.singleHop, config: state.config });
  }
  async function refreshQuote() {
    const seq = ++state.seq;
    const ti = inT(), to = outT();
    const exactOut = state.independent === "out";
    const typed = exactOut ? state.amountOut : state.amount;
    if (!ti || !to || !typed || !(Number(typed) > 0)) { state.quote = null; render(); return; }
    let amount; try { amount = swapUnits(typed, (exactOut ? to : ti).decimals); } catch { state.quote = null; render(); return; }
    try {
      let q;
      if (swapV10Ready()) state.config = await readSwapConfig(request);
      const poolPolicy = await readPoolPolicy(request, { tokenIn: ti.address, tokenOut: to.address, config: state.config });
      const feeBps = feeBpsNow();
      const policy = swapFeePolicy(ti.address, to.address, state.config?.defaultFeeToken);
      const feeAsset = Object.values(TOKENS).find(t => (t.address || ZERO).toLowerCase() === policy.token.toLowerCase()) || TOKENS.usdt;
      if (exactOut) {
        // —— 精确输出：quoteExactOutput（与成交同算法），maxIn = amountIn ×（1 + 滑点） ——
        if (!swapV10Ready()) throw missing();
        const mode = ti.key === "bnb" ? 0 : to.key === "bnb" ? 1 : 2;
        const quotes = await Promise.all(exactOutCandidates(ti, to).filter(c => poolPolicy.allows(c.first, c.second)).map(async (c) => {
          try {
            let plan = null;
            if (policy.mode === "convert") {
              const budget = await v10AmountsIn(request, c.first, c.second ? await v10AmountsIn(request, c.second, amount) : amount);
              const total = (budget * BPS + BPS - BigInt(feeBps) - 1n) / (BPS - BigInt(feeBps));
              plan = await v10PlanFeeConversion(request, { input: ti.address, feeBudget: total * BigInt(feeBps) / BPS, config: state.config, slippageBps: settings.slippageBps, mainLegs: [c.first, c.second].filter(Boolean) });
            }
            return { ...c, conversion: plan?.conversion, ...(await v10QuoteExactOutput(request, { first: c.first, second: c.second, amountOut: amount, mode, conversion: plan?.conversion })) };
          } catch { return null; }
        }));
        const best = quotes.filter(Boolean).sort((a, b) => (a.amountIn < b.amountIn ? -1 : a.amountIn > b.amountIn ? 1 : 0))[0];
        if (!best || best.amountIn <= 0n) throw Object.assign(new Error("no route"), { code: "NO_ROUTE" });
        const maxIn = best.amountIn * (BPS + BigInt(settings.slippageBps)) / BPS;
        q = { kind: "v10exact", exactOut: true, mode, first: best.first, second: best.second, adapterKey: best.key, amountIn: best.amountIn, maxIn, out: amount,
          lpFee: best.fee, feeAsset, conversion: best.conversion, impact: null };
        q.impact = await v10RouteImpact(request, [best.first, best.second].filter(Boolean), best.amountIn, amount);
      } else if (isAggPair()) {
        const amountIn = amount;
        const route = await quoteSwap(request, { side: side(), amountIn, feeBps, poolPolicy });
        q = { kind: "agg", route, amountIn, out: route.estimateOut, lpFee: route.platformFee, feeAsset: swapV10Ready() ? feeAsset : TOKENS.bnb };
        if (swapV10Ready()) {
          q.impact = await v10RouteImpact(request, [route.first, route.second].filter(Boolean), route.swapBudget, q.out);
        } else try {
          const path = side() === "buy" ? [FST_WBNB, SWAP_TOKENS.fist.address] : [SWAP_TOKENS.fist.address, FST_WBNB];
          const tiny = 10n ** BigInt(Math.max(0, ti.decimals - 4));
          q.impact = impactOf(amountIn, q.out, tiny, await midOut(tiny, path));
        } catch { q.impact = null; }
      } else {
        // —— 通用币对：一次批量比较所有已启用的 V2 DEX（含平台费） ——
        if (!swapV10Ready()) throw missing();
        const amountIn = amount;
        let swapIn, method;
        if (ti.key === "bnb") { swapIn = swapBuyBudget(amountIn, feeBps).budget; method = "swapBnbToToken"; }
        else if (to.key === "bnb") { swapIn = policy.mode === "input" ? amountIn - amountIn * BigInt(feeBps) / BPS : amountIn; method = "swapTokenToBnb"; }
        else { swapIn = policy.mode === "output" ? amountIn : amountIn - amountIn * BigInt(feeBps) / BPS; method = "swapTokenToToken"; }
        let best = await v10BestAmountsOut(request, { tokenIn: ti.address, tokenOut: to.address, amountIn: swapIn,
          singleHop: settings.singleHop, config: state.config, poolPolicy });
        let feePlan;
        if (policy.mode === "convert") {
          let lastError;
          for (const candidate of best.candidates) {
            try {
              feePlan = await v10PlanFeeConversion(request, { input: ti.address, feeBudget: amountIn * BigInt(feeBps) / BPS,
                config: state.config, slippageBps: settings.slippageBps, mainLegs: [candidate.first, candidate.second].filter(Boolean) });
              best = candidate; break;
            } catch (err) { if (err?.code !== "NO_FEE_ROUTE") throw err; lastError = err; }
          }
          if (!feePlan) throw lastError;
        }
        const gross = best.out, path = best.first.path;
        const out = policy.mode === "output" ? swapSellNet(gross, feeBps).net : gross;
        const impact = await v10RouteImpact(request, [best.first, best.second].filter(Boolean), swapIn, gross);
        q = { kind: "v10", method, path, amountIn, out, impact, feeAsset, adapterKey: best.key,
          lpFee: (policy.mode === "output" ? gross : amountIn) * BigInt(feeBps) / BPS,
          first: best.first, second: best.second };
        if (policy.mode === "convert") {
          q.method = "swapTokenToTokenWithFee"; q.conversion = feePlan.conversion; q.lpFee = feePlan.fee;
        }
      }
      assertQuoteSafety({ tokenIn: ti.address, tokenOut: to.address, amountIn: q.maxIn || q.amountIn,
        amountOut: q.exactOut ? q.out : minOut(q), impact: q.impact, quotedAmountIn: q.amountIn, quotedAmountOut: q.out });
      q.poolCheckedAt = poolPolicy.checkedAt;
      poolPolicy.assertValue(q.maxIn || q.amountIn, q.exactOut ? q.out : minOut(q));
      if (seq !== state.seq) return;
      state.quote = q; state.quoteError = "";
      await refreshAllowance();
      if (seq !== state.seq) return;
      render();
    } catch (err) {
      if (seq !== state.seq) return;
      state.quote = null;
      state.quoteError = err?.code === SWAP_V10_MISSING.code ? SWAP_V10_MISSING.code
        : err?.code === "NO_ROUTE" || /revert|INSUFFICIENT/i.test(err?.message || "") ? "NO_ROUTE" : (err?.code || "SWAP_RPC");
      render();
      if (!["NO_ROUTE", "POOL_LIQUIDITY", "UNSAFE_QUOTE", "PRICE_IMPACT_TOO_HIGH", SWAP_V10_MISSING.code].includes(state.quoteError)) scheduleQuote(8000);
    }
  }

  async function sendTx(tx, gasLimit, gasPrice, beforeSubmit) {
    return sendWalletOnce({provider:wallet.provider,read:transactionRead,transaction:tx,gasLimit,gasPrice,beforeSubmit});
  }
  async function waitReceipt(hash, account, onReceipt) {
    return waitForApprovalReceipt({read:transactionRead,recover:recoverWalletIntent,hash,account,onReceipt});
  }
  async function approve() {
    if (!state.quote || !wallet.account || !inT()?.address) return;
    const sp = spender(); if (!sp) return;
    const job = approvals.begin({...approvalIdentity(),symbol:inT().symbol});
    if (!job) return;
    let hash, refreshed=false;
    try {
      const req = swapApproveRequest(ethers.Interface, { account: job.account, token: job.token, spender: job.spender });
      const [est, price] = await Promise.allSettled([transactionRead({ method: "eth_estimateGas", params: [req] }), transactionRead({ method: "eth_gasPrice" })]);
      // Selection changed before the wallet opened: leave the new token alone.
      if(wallet.account!==job.account || inT()?.address!==job.token || spender()!==job.spender) return;
      const gasLimit = est.status === "fulfilled" ? BigInt(est.value) * 15n / 10n : 100000n;
      const gasPrice = price.status === "fulfilled" ? BigInt(price.value) : undefined;
      ({ hash } = await sendTx(req, gasLimit, gasPrice, () => main.isConnected && wallet.account===job.account && inT()?.address===job.token && spender()===job.spender));
      popup({ summary: "Approve " + job.symbol, hash });
      await waitReceipt(hash, job.account, async receipt => {
        if(!main.isConnected || wallet.account!==job.account || inT()?.address!==job.token || spender()!==job.spender)return;
        // Refresh against the mined block concurrently with background transaction checks.
        await refreshAllowance(receipt.blockNumber);refreshed=state.allowance!=null;renderBottom();
      });
    } catch (err) {
      if (Number(err?.code) !== 4001 && err?.code !== 'REQUEST_CHANGED') popup({ summary: err?.message || tr("授权失败", "Approval failed"), hash:hash||err?.pendingIntent?.hash, success: false });
    } finally {
      if(!refreshed && wallet.account===job.account && inT()?.address===job.token) state.allowance=null;
      approvals.end(job);
      if(main.isConnected && !refreshed){await refreshAllowance();renderBottom();}
    }
  }

  // —— 确认 / 等待 / 已提交 / 错误 弹窗（官方 ConfirmSwapModal + TransactionConfirmationModal） ——
  function swapSummary(q, digits = 6) { return [sigDown(q.amountIn, inT().decimals, digits), inT().symbol, sigDown(q.out, outT().decimals, digits), outT().symbol]; }
  function tokenLogo(tk, fromKey, sel) { return tk.key === "bnb" ? part("confirm_modal", '.hmwZZp') : part("confirm_modal", ".hWvOwN .eVErNz > svg"); }
  function openConfirm() {
    const q = state.quote; if (!q) return;
    const confirmation = {account:wallet.account,inKey:page.inKey,outKey:page.outKey,slippage:settings.slippageBps};
    const overlay = tpl("confirm_modal");
    const [ain, sin, aout, sout] = swapSummary(q);
    const boxes = overlay.querySelectorAll(".exvWjX");
    const fill = (box, tk, amount) => {
      const left = box.querySelectorAll(".jmNfaf")[1].children[0]; const logo = left.firstElementChild;
      const replacement=tokenLogo(tk); logo.replaceWith(replacement); applyTokenLogo(replacement,tk); left.querySelector(".css-10ob8xa").textContent = tk.symbol;
      box.querySelector(".kHiJLl").textContent = amount;
    };
    fill(boxes[0], inT(), ain); fill(boxes[1], outT(), aout);
    const priceBtn = overlay.querySelector("button.kePVKR"); const pt = priceText(q); priceBtn.title = pt + " "; priceBtn.querySelector(".css-1ieyfqs").textContent = pt;
    const oldDetails = boxes[2]; const nd = detailsEl(q); nd.className = oldDetails.className; nd.setAttribute("style", oldDetails.getAttribute("style")); oldDetails.replaceWith(nd);
    const note = overlay.querySelector(".css-aegmdr"); const b = note.querySelector("b"); b.textContent = fmtTokens(minOut(q), outT()) + " " + outT().symbol;
    note.childNodes.forEach((n) => { if (n.nodeType === 3 && /至少/.test(n.nodeValue)) n.nodeValue = T("输出数额仅为估值。您将收到至少") + " "; });
    overlay.querySelector(".jmNfaf > svg")?.addEventListener("click", closeModal);
    const confirmBtn = overlay.querySelector("#confirm-swap-or-send");
    confirmBtn?.addEventListener("click", () => {
      if(state.quote!==q || wallet.account!==confirmation.account || page.inKey!==confirmation.inKey || page.outKey!==confirmation.outKey || settings.slippageBps!==confirmation.slippage){errorModal(tr("报价、账户或设置已改变，请重新确认", "Quote, account or settings changed; review again"));return;}
      executeSwap(q);
    });
    openModal(overlay);
  }
  function pendingModal(text) {
    const overlay = tpl("pending_modal");
    overlay.querySelector(".css-hzsvkq").textContent = text;
    overlay.querySelector(".jmNfaf > svg")?.addEventListener("click", closeModal);
    openModal(overlay);
  }
  function submittedModal(hash) {
    const overlay = tpl("submitted_modal");
    overlay.querySelector('a[href*="/tx/"]').href = "https://bscscan.com/tx/" + hash;
    const add = overlay.querySelector("button.gbLYuj");
    if (outT().key === "bnb") add?.remove();
    else if (add) {
      add.querySelector(".iWJdVe").firstChild.nodeValue = tr("将 " + outT().symbol + " 添加到 Metamask", "Add " + outT().symbol + " to Metamask");
      add.addEventListener("click", () => wallet.provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: outT().address, symbol: outT().symbol, decimals: outT().decimals } } }).catch(() => {}));
    }
    overlay.querySelectorAll(".jmNfaf > svg, button.dwqBbh").forEach((el) => el.addEventListener("click", closeModal));
    openModal(overlay);
    setTimeout(() => { if (overlay.isConnected) closeModal(); }, 1200);
  }
  function errorModal(message, intent) {
    const overlay = tpl("submitted_modal");
    const body = overlay.querySelector(".kkrlOG"); const iconBox = overlay.querySelector(".jXsGAI");
    iconBox.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#FD4040" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke-width:1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    const title = body.querySelector(".css-1p6fq9y"); title.textContent = message; title.style.color = "#FD4040"; title.style.fontSize = "16px"; title.style.textAlign = "center"; title.style.width = "85%";
    body.querySelector("a")?.remove(); body.querySelector("button.gbLYuj")?.remove();
    const header = overlay.querySelector(".jmNfaf > div"); if (header) header.textContent = T("错误");
    const close = body.querySelector("button.dwqBbh"); close.querySelector("div").textContent = tr("关闭", "Dismiss");
    overlay.querySelectorAll(".jmNfaf > svg, button.dwqBbh").forEach((el) => el.addEventListener("click", closeModal));
    if(intent?.hash){
      const link=document.createElement("a");link.href="https://bscscan.com/tx/"+intent.hash;
      link.target="_blank";link.rel="noopener";link.textContent=tr("查看交易", "View transaction");body.append(link);
    }
    openModal(overlay);
  }
  async function showApprovalIfNeeded(q) {
    if(inT()?.key==="bnb")return false;
    const account=wallet.account;
    await refreshAllowance();
    if(wallet.account!==account||state.quote!==q){closeModal();return true;}
    if(!needsApproval())return false;
    closeModal();renderBottom();return true;
  }
  async function executeSwap(q) {
    const [ain, sin, aout, sout] = swapSummary(q);
    pendingModal(tr("将 " + ain + " " + sin + " 兑换为 " + aout + " " + sout, "Swapping " + ain + " " + sin + " for " + aout + " " + sout));
    const deadline = Math.floor(Date.now() / 1000) + settings.deadlineMinutes * 60;
    const min = minOut(q);
    const submittedAccount = wallet.account;
    const submittedTokens = { tokenIn: inT().address, tokenOut: outT().address };
    let expectedRequest;
    try {
      assertQuoteSafety({ ...submittedTokens, amountIn: q.maxIn || q.amountIn, amountOut: q.exactOut ? q.out : min, impact: q.impact, quotedAmountIn: q.amountIn, quotedAmountOut: q.out });
      if(await showApprovalIfNeeded(q))return;
      if(inT()?.key!=="bnb"&&state.allowance==null)throw new Error(tr("暂时无法读取授权额度，请稍后重试", "Cannot read approval; please try again"));
      const freshPolicy = await readPoolPolicy(request, { ...submittedTokens, config: await readSwapConfig(request) });
      const quotedRoute = q.route || q;
      freshPolicy.assert(quotedRoute.first, quotedRoute.second);
      freshPolicy.assertValue(q.maxIn || q.amountIn, q.exactOut ? q.out : min);
      if (state.quote !== q || wallet.account !== submittedAccount) { closeModal(); return; }
      let hash, preflight = null;
      if (q.kind === "agg") {
        preflight = await preflightSwap(wallet.provider.request.bind(wallet.provider), { account: wallet.account, route: q.route, amountIn: q.amountIn, minOut: min, deadline, allowance: side() === "sell" ? state.allowance : null });
        if (preflight.needsApproval) { closeModal(); renderBottom(); return; }
        if (swapV10Ready() && preflight.simulated === null) throw new Error(tr("链上仿真失败，请刷新报价", "Simulation failed; refresh the quote"));
        if (preflight.simulated !== null && preflight.simulated < min) throw new Error(tr("链上仿真低于最少到账，请刷新报价后重试", "Simulation below minimum received; refresh and retry"));
        const sent = await sendTx(preflight.transaction, preflight.gasLimit, preflight.gasPrice, () => freshPolicy.assertFresh());
        hash = sent.hash; expectedRequest = sent.transaction;
      } else {
        // v10 聚合路由（不直连 FstSwap 路由器）；未部署时 v10Request 抛「聚合合约未部署」
        let tx;
        if (q.kind === "v10exact") {
          const method = q.conversion ? "swapTokenForExactTokenWithFee" : ["swapBnbForExactToken", "swapTokenForExactBnb", "swapTokenForExactToken"][q.mode];
          const args = q.mode === 0 ? [q.first, q.second || NO_LEG, q.out, deadline, wallet.account] : [q.first, q.second || NO_LEG, q.out, q.maxIn, deadline, wallet.account];
          if (q.conversion) args.push(q.conversion);
          tx = v10Request(ethers.Interface, { account: wallet.account, method, args, value: q.mode === 0 ? q.maxIn : 0n });
        } else if (q.kind === "v10") {
          const args = q.method === "swapBnbToToken" ? [q.first, q.second || NO_LEG, min, deadline, wallet.account] : [q.first, q.second || NO_LEG, q.amountIn, min, deadline, wallet.account];
          if (q.conversion) args.push(q.conversion);
          tx = v10Request(ethers.Interface, { account: wallet.account, method: q.method, args, value: q.method === "swapBnbToToken" ? q.amountIn : 0n });
        } else throw missing();
        const simulated = await wallet.provider.request({ method: "eth_call", params: [tx, "latest"] });
        const simulationInterface = new ethers.Interface(SWAP_ABI);
        const simulatedMethod = simulationInterface.parseTransaction({ data: tx.data }).name;
        const simulatedAmount = simulationInterface.decodeFunctionResult(simulatedMethod, simulated)[0];
        if (q.exactOut ? simulatedAmount > q.maxIn : simulatedAmount < min) throw new Error(tr("链上仿真未满足报价约束", "Simulation violates quote limits"));
        expectedRequest = tx;
        const light = swapPublicRpc(globalThis.fetch, undefined, { attempts: 2, timeoutMs: 8000 });
        const [est, price] = await Promise.allSettled([light({ method: "eth_estimateGas", params: [tx] }), light({ method: "eth_gasPrice" })]);
        const sent = await sendTx(tx, est.status === "fulfilled" ? BigInt(est.value) * 13n / 10n : 900000n, price.status === "fulfilled" ? BigInt(price.value) : 3000000000n, () => freshPolicy.assertFresh());
        hash = sent.hash; expectedRequest = sent.transaction;
      }
      const [a3, , b3] = swapSummary(q, 3);
      const summary = "Swap " + a3 + " " + sin + " for " + b3 + " " + sout;
      submittedModal(hash); popup({ summary, hash });
      saveHistory({ hash, summary, time: Date.now() });
      state.amount = ""; state.amountOut = ""; state.independent = "in"; state.quote = null; render();
      waitReceipt(hash, submittedAccount).then(async () => {
        if (swapV10Ready()) {
          await readV10Receipt(request, hash, { account: submittedAccount, expectedRequest, ...submittedTokens,
            minOut: q.exactOut ? q.out : min, maxIn: q.maxIn || q.amountIn, feeToken: q.feeAsset.address || ZERO, expectedFee: q.lpFee, minFeeOut: q.conversion && q.lpFee > 0n ? q.conversion.minOut : 0n });
        } else if (q.kind === "agg") {
          await readSwapReceipt(request, hash, { account: submittedAccount, route: q.route, minOut: min, expectedRequest });
        }
        refreshBalances(); refreshNativeBalance();
      }).catch((err) => popup({ summary: summary + " — " + (err?.message || ""), hash, success: false }));
    } catch (err) {
      if(!["UNSAFE_QUOTE","PRICE_IMPACT_TOO_HIGH","POOL_LIQUIDITY"].includes(err?.code)&&!err?.pendingIntent&&Number(err?.code)!==4001&&state.quote===q&&await showApprovalIfNeeded(q))return;
      if (err?.pendingIntent) errorModal(err.message, err.pendingIntent);
      else if (Number(err?.code) === 4001) errorModal(T("交易被拒绝。"));
      else errorModal(err?.message || tr("交易失败", "Transaction failed"));
    }
  }

  // 每次进入兑换页立即选择 USDT → FIST；明确的 URL 币对优先，连接钱包不覆盖用户选择。
  page.inKey = null; page.outKey = null; page.connectedDefaults = false;
  const applyDefaults = () => {
    const q = new URLSearchParams((location.hash.split("?")[1] || ""));
    const keyOf = (v) => { const x = String(v || "").toLowerCase(); return x === "bnb" || x === "eth" ? "bnb" : ORDER.find((k) => TOKENS[k].address && TOKENS[k].address.toLowerCase() === x) || null; };
    let a = keyOf(q.get("inputCurrency")), b = keyOf(q.get("outputCurrency"));
    if (!a && !b) { a = "usdt"; b = "fist"; } else if (a === b) b = null;
    page.inKey = a; page.outKey = b; page.connectedDefaults = true;
  };
  function restoreSubmittedTransaction() {
    const account=wallet.account;if(!account)return;
    recoverWalletIntent({read:transactionRead,account}).then(result=>{
      if(result&&wallet.account===account&&main.isConnected)refreshBalances();
    }).catch(()=>{});
  }
  applyDefaults();
  wallet.subscribe(() => {
    if (!main.isConnected) return;
    if (wallet.account && !page.connectedDefaults) applyDefaults();
    state.quote = null; ++state.seq; ++state.balanceEpoch; closeModal(); state.balances = {}; state.balanceErrors = {}; render(); refreshBalances(); restoreSubmittedTransaction(); scheduleQuote(0);
  });

  onTokensChanged(() => { if (main.isConnected) { state.quote=null; ++state.seq; render(); } });
  approvals.subscribe(()=>{if(!main.isConnected)return false;renderBottom();});
  renderSettings(); render();
  refreshDefaultList();
  if (wallet.account) { refreshBalances(); restoreSubmittedTransaction(); }
  try { state.config = await readSwapConfig(request); } catch { state.config = null; }
  if (state.amount) scheduleQuote(0);
}

export async function initSwapApp() { const root = document.getElementById("root"); if (root) await mountSwapView(root); }
