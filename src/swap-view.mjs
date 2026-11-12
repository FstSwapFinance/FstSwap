import { createReceiptReadScope } from './swap-receipt-read.mjs?v=mainnet-20261112-40';
import { createIdleRead } from './swap-idle-read.mjs?v=mainnet-20261112-40';
import { swapRpcWork } from './swap-rpc-work.mjs?v=mainnet-20261112-40';
import { recheckSwapQuote, createSubmissionReadContext, prepareSwapSubmission, prepareGasOptions } from './swap-preflight.mjs?v=mainnet-20261112-40';
import { resolveFeeAsset } from './swap-fee-assets.mjs?v=mainnet-20261112-40';
import { createQuoteRefresh } from './swap-quote-refresh.mjs?v=mainnet-20261112-40';
import { createAllowanceReader } from './swap-allowance.mjs?v=mainnet-20261112-40';
import { createSubmissionWarmup } from './swap-submission-warmup.mjs?v=mainnet-20261112-40';
import { createWalletTiming, timeWalletPhase, walletTimingFailure } from './swap-wallet-timing.mjs?v=mainnet-20261112-40';
import { swapService, validateServiceQuote } from './swap-service-client.mjs?v=mainnet-20261112-40';
import { readWalletBalances, invalidateWalletBalances } from './swap-balances.mjs?v=mainnet-20261112-40';
import { quoteFstSwap, recheckFstQuote, fstRequest, FST_ABI } from "./swap-fstswap.mjs?v=mainnet-20261112-40";
// 兑换页 —— 界面逐节点复刻官方 fstswap.github.io（DOM 模板 swap-official-tpl.mjs + 样式 swap-official.css），
// 交易逻辑：全部链上操作走聚合合约，不再直连 FstSwap 路由器（0x1B6C…）。
//  - v10（SWAP_MAINNET.routerV10 已配置）：BNB⇄FIST 多 DEX 聚合 + 通用币对 V2 多 DEX 比价；
//    授权对象统一为 v10 路由器；报价走 v10 getAmountsOutVia。
//  - v10 未配置：仅 BNB⇄FIST 走已部署的 v9（0x0b31…3FD2）；其余币对显示「聚合合约未部署」，不回退。
import { sendWalletOnce, recoverWalletIntent } from "./swap-send.mjs?v=mainnet-20261112-40";
import {
  SWAP_MAINNET, SWAP_TOKENS, SWAP_ADAPTERS, SWAP_ABI, swapUnits, swapFormatUnits,
  swapFeePolicy, v10PlanFeeConversion, readV10Receipt,
  v10BestAmountsOut, v10RouteImpact, assertQuoteSafety,
  quoteSwap, preflightSwap, swapApproveRequest, readSwapReceipt, describeRoute, readSwapConfig, swapRouteSpenders,
  loadSwapLibrary, swapPublicRpc,
  swapV10Ready, swapActiveRouter, SWAP_V10_MISSING, v10AmountsOut, v10Request, swapBuyBudget, swapSellNet,
} from "./swap-aggregator.mjs?v=mainnet-20261112-40";
import { tr, T, getLanguage, tpl, part, html, mountFrame, useWallet, openWalletModal, openModal, closeModal,
  popup, significant, refreshNativeBalance } from "./swap-shell.mjs?v=mainnet-20261112-40";
import { formatAmountInput, limitAmountDecimals } from "./swap-amount.mjs";
import { applyTokenLogo } from "./swap-token-logo.mjs";
import { refreshDefaultList, openManageView, onTokensChanged, activeTokenEntries, findActiveToken, readToken, isAddress, searchImportRow } from "./swap-manage.mjs?v=mainnet-20261112-40";

import { createApprovalTracker, waitForApprovalReceipt } from "./swap-approval.mjs";
import { readPoolPolicy } from "./swap-liquidity.mjs?v=mainnet-20261112-40";
import { createQuoteContext } from "./swap-quote-context.mjs?v=mainnet-20261112-40";

const approvals = createApprovalTracker();
const sharedQuoteContext = createQuoteContext(swapPublicRpc());
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
export const tokenKeys = () => [...ORDER];
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

export function openTokenPicker({ selected, other, balances = {}, onPick, loadBalances }) {
  syncTokenRegistry();
  const wallet = useWallet();
  const overlay = tpl("token_modal");
  const listHost = overlay.querySelector('div[style*="flex: 1 1 0%"]');
  const scroller = listHost.querySelector('div[style*="overflow: auto"]');
  const inner = scroller.firstElementChild;
  const rowTpl = {}; inner.querySelectorAll(":scope > div").forEach((r) => { const k = ["bnb", "usdt", "fist"].find((key) => r.className.toLowerCase().includes(TOKENS[key].item.toLowerCase())); if (k) rowTpl[k] = r.cloneNode(true); });
  // The captured virtual-list wrapper has height:0 and a fixed 519px child.
  // This list renders every row, so let normal flow determine its scroll height.
  listHost.classList.add("fst-token-results");
  inner.removeAttribute("style");
  listHost.replaceChildren(inner);
  const emptyView = html('<div class="fst-token-results" style="padding: 20px;"></div>');
  emptyView.textContent = tr("未找到结果。", "No results found.");
  const search = overlay.querySelector("#token-search-input");
  const common = html('<div class="fst-common-tokens" role="group"></div>');
  common.setAttribute("aria-label", tr("常用代币", "Common tokens"));
  search.parentElement.after(common);
  const genericTpl = rowTpl.usdt || rowTpl.fist;
  // 列表 / 用户添加代币的行：官方 CurrencyRow（图标加载失败 → 斜杠圆圈；用户添加的名称后缀「• 由用户添加」）
  const rowFor = (k) => {
    const t = TOKENS[k]; const r = (rowTpl[k] || genericTpl).cloneNode(true);
    if (!rowTpl[k]) { r.className = r.className.replace(/token-item-\S+/, t.item); const sym = r.querySelector(".css-8mokm4"); sym.textContent = t.symbol; sym.title = t.name; }
    const nm = r.querySelector(".css-165qfk5"); if (nm && t.address) nm.textContent = t.name + (t.userAdded ? tr(" • 由用户添加", " • Added by user") : "");
    applyTokenLogo(r.querySelector(":scope > svg, :scope > img"), t, {loading: 'lazy'});
    return r;
  };
  // 官方 useTokenComparator：BNB 置顶，其余按余额（原始数量）降序，再按符号字母序；未连接钱包保持列表顺序
  const sortKeys = (keys) => {
    if (!wallet.account) return keys;
    const rest = keys.filter((k) => k !== "bnb").sort((a, b) => {
      const A = balances[a], B = balances[b]; let c = 0;
      if (A != null && B != null) c = A > B ? -1 : A === B ? 0 : 1; else if (A != null && A > 0n) c = -1; else if (B != null && B > 0n) c = 1;
      if (c) return c; return TOKENS[a].symbol.toLowerCase() < TOKENS[b].symbol.toLowerCase() ? -1 : 1;
    });
    return keys.includes("bnb") ? ["bnb", ...rest] : rest;
  };
  // Token metadata always comes from BSC, even when the wallet is on another chain.
  const readRpc = swapPublicRpc();
  const balanceRequest = swapPublicRpc(globalThis.fetch, undefined, { lane: "balance" });
  const dialog = overlay.querySelector("[data-reach-dialog-content]");
  dialog.classList.add("fst-token-dialog");
  const searchCls = dialog.className;
  let searchNodes;
  let manager = null, searchSeq = 0;
  let unsubscribe = () => {}, stopWallet = () => {};
  const viewport = globalThis.visualViewport;
  const dismissKeyboard = html('<button type="button" class="fst-keyboard-dismiss"></button>');
  dismissKeyboard.textContent = tr('收起键盘', 'Hide keyboard');
  dismissKeyboard.addEventListener('click', () => search.blur()); search.parentElement.after(dismissKeyboard);
  searchNodes = [...dialog.childNodes];
  let baselineHeight = viewport?.height || globalThis.innerHeight || 0;
  const fitViewport = () => {
    const height = viewport?.height || globalThis.innerHeight || 0;
    const focused = document.activeElement === search;
    if (!focused) baselineHeight = Math.max(baselineHeight, height);
    const compact = focused && (baselineHeight - height > 120 || height < 540);
    dialog.classList.toggle('fst-keyboard-open', compact);
    dialog.style.setProperty('--fst-visible-height', height + 'px');
    if (compact) { overlay.style.height = height + 'px'; overlay.style.top = (viewport?.offsetTop || 0) + 'px'; }
    else { overlay.style.removeProperty('height'); overlay.style.removeProperty('top'); }
  };
  viewport?.addEventListener('resize', fitViewport); viewport?.addEventListener('scroll', fitViewport);
  globalThis.addEventListener?.('resize', fitViewport);
  search.addEventListener('focus', fitViewport); search.addEventListener('blur', fitViewport);
  const cleanup = () => { unsubscribe(); stopWallet(); manager?.dispose(); viewport?.removeEventListener('resize', fitViewport); viewport?.removeEventListener('scroll', fitViewport); globalThis.removeEventListener?.('resize', fitViewport); };
  const closePicker = () => closeModal();
  const backToSearch = () => { manager?.dispose(); searchSeq++; dialog.className = searchCls; dialog.replaceChildren(...searchNodes); search.value = ""; draw(); search.blur(); fitViewport(); }; // 官方：CurrencySearch 重新挂载，搜索词清空
  const pickImported = (t) => { syncTokenRegistry(); const k = ORDER.find((x) => TOKENS[x].address && TOKENS[x].address.toLowerCase() === t.address.toLowerCase()); closePicker(); if (k) onPick(k); };
  const manage = (opts = {}) => { searchSeq++; manager?.dispose(); manager = openManageView({ content: dialog, onBack: backToSearch, onClose: closePicker, onSelectToken: pickImported, request: readRpc, ...opts }); };
  // 「管理代币列表」：原先未绑定任何事件（按钮点不开的原因），现在切到官方 Manage 视图
  overlay.querySelector(".list-token-manage-button")?.addEventListener("click", () => manage());
  const draw = () => {
    if (!dialog.contains(search)) return;
    common.replaceChildren();
    const commonIds = [SWAP_TOKENS.fist.address, SWAP_TOKENS.usdt.address, null, "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"];
    for (const address of commonIds) {
      const key = address == null ? "bnb" : ORDER.find(k => TOKENS[k].address?.toLowerCase() === address.toLowerCase());
      if (!key) continue; // Respect disabled lists; never substitute a same-symbol token.
      const button = html('<button type="button" class="fst-common-token"></button>');
      const icon = rowFor(key).querySelector(":scope > svg, :scope > img");
      if (icon) button.append(icon);
      const label = document.createElement("span"); label.textContent = TOKENS[key].symbol; button.append(label);
      button.disabled = key === selected;
      button.setAttribute("aria-label", tr("选择 ", "Select ") + TOKENS[key].symbol);
      button.addEventListener("click", () => { closePicker(); onPick(key); });
      common.append(button);
    }
    const q = search.value.trim().toLowerCase(); const seq = ++searchSeq;
    const keys = sortKeys(ORDER.filter((k) => !q || TOKENS[k].symbol.toLowerCase().includes(q) || TOKENS[k].name.toLowerCase().includes(q) || (TOKENS[k].address || "").toLowerCase() === q));
    const container = overlay.querySelector('.fst-token-results');
    if (!keys.length) {
      container.replaceWith(emptyView.cloneNode(true));
      // 官方 CurrencySearch：粘贴未在激活列表中的合约地址 → 显示导入行，点「导入」进入导入代币页
      if (isAddress(q)) readToken(readRpc, q).then((t) => {
        if (!t || seq !== searchSeq || !overlay.isConnected || !dialog.contains(search) || findActiveToken(t.address)) return;
        const box = overlay.querySelector('.fst-token-results'); if (!box) return;
        const col = document.createElement("div"); col.className = box.className; col.setAttribute("style", "padding: 20px 0px;");
        col.append(searchImportRow(t, () => manage({ initial: "importToken", importToken: t }))); box.replaceWith(col);
      }).catch(() => {});
      return;
    }
    const list = listHost; if (container !== list) container.replaceWith(list);
    inner.replaceChildren();
    keys.forEach((k, i) => {
      const r = rowFor(k); const base = r.className.replace(/\b(hkWdsr|hhKaCX|LPcFh)\b/, "").trim();
      r.className = base + " " + (k === selected ? "hhKaCX" : k === other ? "LPcFh" : "hkWdsr");
      if (k === selected) r.setAttribute("disabled", ""); else r.removeAttribute("disabled");
      r.removeAttribute("style");
      r.setAttribute("role", "button"); r.tabIndex = k === selected ? -1 : 0;
      r.setAttribute("aria-disabled", String(k === selected));
      const balBox = r.querySelector(".hpHOqm");
      const bal = balances[k];
      if (balBox) { if (wallet.account && bal != null) { balBox.textContent = sigDown(bal, TOKENS[k].decimals, 4); balBox.title = swapFormatUnits(bal, TOKENS[k].decimals); } else balBox.parentElement.replaceChildren(); }
      if (k !== selected) {
        r.addEventListener("click", () => { closePicker(); onPick(k); });
        r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.click(); } });
      }
      inner.append(r);
    });
  };
  search.addEventListener("input", draw);
  overlay.querySelector(".jmNfaf > svg")?.addEventListener("click", closePicker);
  openModal(overlay, { onClose: cleanup });
  draw(); fitViewport();
  const refreshBalances = async () => {
    if (loadBalances) return loadBalances();
    const account = wallet.account;
    if (!account) return;
    const result = await readWalletBalances(balanceRequest, account, ORDER.map(k => TOKENS[k]));
    if (wallet.account !== account || !overlay.isConnected) return;
    Object.assign(balances, result.balances);
    for (const k of result.failed) delete balances[k];
  };
  refreshBalances().then(() => { if (overlay.isConnected) draw(); }).catch(() => {});
  unsubscribe = onTokensChanged(() => {
    if (!overlay.isConnected) { cleanup(); return; }
    syncTokenRegistry(); draw();
  });
  const openedAccount = wallet.account;
  stopWallet = wallet.subscribe(() => {
    if (!overlay.isConnected) { cleanup(); return; }
    if (wallet.account !== openedAccount) closePicker();
  });
  refreshDefaultList();
}

export async function mountSwapView(root) {
  const wallet = useWallet();
  const request = swapPublicRpc();
  const balanceRequest = swapPublicRpc(globalThis.fetch, undefined, { lane: "balance" });
  const quoteContext = sharedQuoteContext;
  // Short, abortable reads for wallet actions; market/chart reads keep their own retry policy.
  const transactionRead = (payload,{signal}={}) => swapPublicRpc(globalThis.fetch, signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000), { priority:"foreground", attempts: 2, timeoutMs: 2000 })(payload);
  const settings = readSettings();
  const state = {
    amount: "", quote: null, quoteError: "", quoteErrorReason: "", balances: {}, balanceErrors: {}, balanceEpoch: 0, allowance: null, config: null,
    showInverted: false, settingsOpen: false, seq: 0,
  };
  // —— 骨架：官方 main（AppBody）+ SwapHeader + #swap-page ——
  // Keep the server-rendered default form while the transaction library loads.
  // Replacing it with the empty selector template would flash a second loading UI.
  const main = root.querySelector('main[data-fst-initial]')?.cloneNode(true) || tpl("swap_empty");
  main.removeAttribute('data-fst-initial');
  main.classList.add("fst-swap-card");
  mountFrame(root, "swap", main);
  main.inert = true;
  await loadSwapLibrary();
  if (!main.isConnected) return;
  main.inert = false;
  const ethers = globalThis.ethers;
  const allowanceReader = createAllowanceReader((payload,{signal,fresh}={}) => swapPublicRpc(globalThis.fetch,signal,{priority:fresh?"foreground":"background",attempts:2,timeoutMs:2000})(payload));
  let activeSubmissionContext = null;
  let activeWalletController = null;
  const submissionWarmup=createSubmissionWarmup();
  const walletTiming=createWalletTiming();
  let submissionWarmTimer=null,walletSubmissionEpoch=0,activeBalanceReads=0;
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
    if (state.quote?.kind === "fstswap") {
      const addresses = [state.quote.tokenIn, ...state.quote.stages.map(stage => stage.tokenOut)];
      return addresses.map(address => Object.values(TOKENS).find(t => (t.address || ZERO).toLowerCase() === address.toLowerCase())?.symbol || address.slice(0, 6) + "…");
    }
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
    if (id === "swap-currency-output") input.readOnly = true;
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
    return src;
  }
  function formatBalance(bal, tk) {
    if (bal === 0n) return "0";
    const scale = 10n ** BigInt(tk.decimals);
    if (bal * 100000n < scale) return "<0.00001";
    return sigDown(bal, tk.decimals, 9);
  }

  function renderPanels() {
    const outVal = state.quote ? formatAmountInput(state.quote.out, outT().decimals) : "";
    const inVal = state.amount;
    const refocus = state.refocus || document.activeElement === main.querySelector("#swap-currency-input input");
    const arrow = part("swap_quoted", ".hDVbXn");
    arrow.style.cursor = "pointer";
    arrow.addEventListener("click", flip);
    const showMax = Boolean(inT());
    const inEl = panel("swap-currency-input", inT(), inVal, { showMax });
    const outEl = panel("swap-currency-output", outT(), outVal, { showMax: false });
    panelsCol.replaceChildren(inEl, arrow, outEl);
    const input = inEl.querySelector("input");
    if (refocus) {
      state.refocus = false; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  // —— 价格行 + 详情（官方 TradePrice + AdvancedSwapDetails） ——
  function renderTrade() {
    // Unit price is display-only: it never populates state.quote or enables a swap.
    const preview = !state.amount && state.preview?.serviceExpiresAt > Date.now() ? state.preview : null;
    const q = state.quote || preview;
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
    if (state.quote) row.after(detailsEl(q));
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
    rows[0].remove();
    // 途径：官方 SwapRoute（代币 › 代币）；聚合器的实际 DEX 路线放到 title
    const routeBox = val(1).querySelector(".css-q0g5a7");
    const tokenTpl = routeBox.querySelector(".css-1rojlue"), chevron = routeBox.querySelector("svg");
    const syms = routeSymbols(); routeBox.replaceChildren();
    syms.forEach((s, i) => { if (i) routeBox.append(chevron.cloneNode(true)); const t = tokenTpl.cloneNode(true); t.querySelector(".css-5ds0tb").textContent = s; routeBox.append(t); });
    if (q.route) val(1).title = describeRoute(q.route, getLanguage());
    const impact = val(2).querySelector(".hHwHpX"); impact.textContent = formatImpact(q.impact);
    val(3).textContent = fmtTokens(minOut(q), outT()) + " " + outT().symbol;
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
      if (!swapBtn.disabled) swapBtn.addEventListener("click", ()=>handleSwapClick(swapBtn));
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
    if (!inT() || !outT()) return;
    const link = part("swap_connected", "#swap-page .dAunsx");
    link.querySelector("a").href = "#/analysis/" + inT().id + "/" + outT().id;
    bottom.after(link);
  }
  function inputError() {
    if (!inT() || !outT()) return T("选择代币");
    const typed = state.amount;
    if (!typed || !(Number(typed) > 0)) return T("输入数额");
    if (state.quoteError === SWAP_V10_MISSING.code) return tr(SWAP_V10_MISSING.zh, SWAP_V10_MISSING.en);
    if (state.quoteError === "NO_ROUTE") return settings.singleHop ? tr("没有符合要求的直达池，可关闭禁用多跳", "No eligible direct pool; enable multihop") : tr("没有符合流动性要求的交易路线", "No route meets the liquidity requirements");
    if (state.quoteError === "POOL_LIQUIDITY") {
      if (state.quoteErrorReason === "oracle") return tr("价格数据暂不可用，正在重试", "Price data unavailable; retrying");
      if (state.quoteErrorReason === "data") return tr("池子数据读取失败，正在重试", "Pool data unavailable; retrying");
      if (state.quoteErrorReason === "stale") return tr("链上数据已过期，正在重新报价", "Chain data expired; refreshing quote");
      if (state.quoteErrorReason === "price") return tr("成交下限偏离参考价超过 2%，请减少金额或滑点", "Minimum value deviates over 2%; reduce amount or slippage");
      return tr("没有符合流动性要求的池子", "No pool meets the liquidity requirements");
    }
    if (state.quoteError === "PRICE_IMPACT_TOO_HIGH") return tr("价格影响与滑点超过 15%，请减少金额或滑点", "Price impact and slippage exceed 15%; reduce amount or slippage");
    if (state.quoteError === "UNSAFE_QUOTE") return tr("兑换价格或流动性异常，已停止兑换", "Unsafe price or liquidity; swap unavailable");
    if (state.quoteError === "NO_FEE_ROUTE") return tr("没有可用的手续费兑换路线", "No eligible fee conversion route");
    if (state.quoteError === "AMOUNT_PRECISION") return tr("输入金额超出代币精度", "Amount exceeds token precision");
    if (state.quoteError) return tr("报价暂不可用，正在重试", "Quote unavailable; retrying");
    if (!state.quote) return tr("正在获取报价…", "Fetching quote…");
    if (state.quote.serviceExpiresAt && Date.now() >= state.quote.serviceExpiresAt) return tr("正在更新报价…", "Refreshing quote…");
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
        b.addEventListener("click", () => { settings.deadlineMinutes = dls[i]; saveSettings(settings); cancelSubmissionWarm(); renderSettings(); queueSubmissionWarm(); });
      });
      const dlInput = groups[1].querySelector("input"); dlInput.setAttribute("placeholder", String(settings.deadlineMinutes));
      dlInput.addEventListener("input", () => { const v = Number(dlInput.value); if (Number.isSafeInteger(v) && v >= 1 && v <= 180) { settings.deadlineMinutes = v; saveSettings(settings); cancelSubmissionWarm(); queueSubmissionWarm(); } });
      const toggle = (id, key, onChange) => {
        const t = fly.querySelector("#" + id); const [on, off] = t.querySelectorAll("span");
        on.className = on.className.replace(/\b(iRRrwD|ksfRJa)\b/, settings[key] ? "ksfRJa" : "iRRrwD");
        off.className = off.className.replace(/\b(iRRrwD|ksfRJa)\b/, settings[key] ? "iRRrwD" : "ksfRJa");
        t.addEventListener("click", () => { settings[key] = !settings[key]; saveSettings(settings); cancelSubmissionWarm(); renderSettings(); onChange?.(); queueSubmissionWarm(); });
      };
      toggle("toggle-expert-mode-button", "expert");
      toggle("toggle-disable-multihop-button", "singleHop", () => {
        state.quote = null; renderTrade(); renderBottom(); scheduleQuote(0);
      });
    }
    settingsWrap.replaceChildren(...fresh.childNodes);
  }
  const closeSettings = () => { if (state.settingsOpen && main.isConnected) { state.settingsOpen = false; renderSettings(); } };
  document.addEventListener("click", closeSettings);

  // —— 代币选择弹窗（官方 CurrencySearchModal） ——
  function openTokenModal(field) {
    return openTokenPicker({ selected: field === "in" ? page.inKey : page.outKey,
      other: field === "in" ? page.outKey : page.inKey, balances: state.balances,
      onPick: key => selectToken(field, key), loadBalances: loadAllBalances });
  }
  function selectToken(field, key) {
    if (field === "in") { if (page.outKey === key) page.outKey = page.inKey; page.inKey = key; }
    else { if (page.inKey === key) page.inKey = page.outKey; page.outKey = key; }
    stopPairPrice();
    state.quote = null; state.allowance = null; render(); refreshBalances(false); prewarmQuote(); refreshPairPrice(); scheduleQuote(0);
  }
  function flip() {
    [page.inKey, page.outKey] = [page.outKey, page.inKey];
    state.amount = state.quote ? formatAmountInput(state.quote.out, (inT() || TOKENS.bnb).decimals) : limitAmountDecimals(state.amount);
    stopPairPrice();
    state.quote = null; state.allowance = null; render(); refreshBalances(false); prewarmQuote(); refreshPairPrice(); scheduleQuote(0);
  }

  // —— 余额（BSC 公共只读 RPC）/ 授权（钱包 provider） ——
  let balanceRequestId = 0;
  const balanceRequests = new Map();
  async function loadBalances(keys, fresh = false, {signal} = {}) {
    const account = wallet.account, epoch = state.balanceEpoch;
    if (!account) return;
    const wanted = [...new Set(keys)].filter(k => TOKENS[k]);
    const id = ++balanceRequestId;
    wanted.forEach(k => balanceRequests.set(k, id));
    let result;
    const read = signal ? swapPublicRpc(globalThis.fetch, signal, {lane:"balance"}) : balanceRequest;
    if(submissionWarmup.pending())cancelSubmissionWarm();activeBalanceReads++;
    try { result = await readWalletBalances(read, account, wanted.map(k => TOKENS[k]), {fresh,signal}); }
    catch { if (signal?.aborted) return; result = {balances:{}, failed:wanted}; }
    finally { activeBalanceReads--;if(wanted.some(key=>key===page.inKey||key===page.outKey))queueSubmissionWarm(); }
    if (signal?.aborted || wallet.account !== account || state.balanceEpoch !== epoch) return;
    for (const k of wanted) {
      if (balanceRequests.get(k) !== id) continue;
      if (result.balances[k] != null) { state.balances[k] = result.balances[k]; delete state.balanceErrors[k]; }
      else { delete state.balances[k]; state.balanceErrors[k] = true; }
    }
  }
  async function loadAllBalances() {
    otherBalances.pause();
    await loadBalances(ORDER);
  }
  async function refreshBalances(fresh = true) {
    if (!wallet.account) return;
    otherBalances.pause();
    const keys = [page.inKey, page.outKey].filter(Boolean);
    // A slow holdings read must not delay the independent allowance check.
    await Promise.allSettled([
      loadBalances(keys, fresh).then(() => { if (main.isConnected) { renderPanels(); renderBottom(); } }),
      refreshAllowance("latest", {fresh}).then(() => { if (main.isConnected) renderBottom(); }),
    ]);
    if (main.isConnected) otherBalances.schedule();
  }
  // 授权对象：v10 → 统一授权 v10 路由器；v9（仅 BNB⇄FIST 卖出）→ 首段适配器（v9 由适配器 transferFrom）；否则无（未部署）
  function spender() {
    if (swapV10Ready()) return swapActiveRouter();
    return isAggPair() && state.quote?.route ? swapRouteSpenders(state.quote.route)[0] : null;
  }
  function approvalIdentity() { return { account: wallet.account, token: inT()?.address, spender: spender() }; }
  let allowanceRequestId=0;
  async function refreshAllowance(blockTag="latest", {fresh=true, signal}={}) {
    const requestId=++allowanceRequestId;
    if (!wallet.account || !inT() || inT().key === "bnb") { state.allowance=null; return; }
    const sp = spender(); if (!sp) return;
    const account=wallet.account,token=inT().address;
    const identity=[account,token,sp].map(x=>String(x).toLowerCase()).join(":");
    if(state.allowanceIdentity!==identity){state.allowance=null;state.allowanceIdentity=identity;}
    if(fresh)state.allowance=null;
    try {
      const allowance=await allowanceReader.read({chainId:56,account,token,spender:sp},{fresh,blockTag,signal});
      if(requestId===allowanceRequestId && !signal?.aborted && wallet.account===account && inT()?.address===token && spender()===sp)state.allowance=allowance;
    } catch(error) { if(error?.name==='AbortError')return; /* Unknown allowance is never treated as sufficient. */ }
    finally { if(!signal?.aborted)queueSubmissionWarm(); }
  }

  function prewarmQuote() {
    if (swapService.available?.()) return;
    if (main.isConnected && inT() && outT()) quoteContext.get(inT().address, outT().address).catch(() => {});
  }
  let previewController = null, previewExpiryTimer = null;
  function stopPairPrice() {
    previewController?.abort(); previewController = null;
    clearTimeout(previewExpiryTimer); previewExpiryTimer = null; state.preview = null;
  }
  async function refreshPairPrice({reuse=false} = {}) {
    if (reuse && (previewController || state.preview?.serviceExpiresAt > Date.now())) return;
    stopPairPrice();
    if (state.amount || state.transactionBusy || !main.isConnected || document.hidden || navigator.onLine === false || !swapService.available?.()) return;
    const ti = inT(), to = outT(); if (!ti || !to) return;
    const tokenIn = ti.address, tokenOut = to.address;
    const controller = new AbortController(); previewController = controller;
    try {
      const remote = await swapService.quote({tokenIn, tokenOut, amountIn:10n ** BigInt(ti.decimals),
        slippageBps:settings.slippageBps, singleHop:settings.singleHop},
        {router:swapActiveRouter(), adapters:SWAP_ADAPTERS, signal:controller.signal});
      if (!remote || controller.signal.aborted || previewController !== controller || !main.isConnected || state.amount || inT()?.address !== tokenIn || outT()?.address !== tokenOut || remote.expiresAt <= Date.now()) return;
      const preview = {...remote.quote, serviceExpiresAt:remote.expiresAt};
      state.preview = preview; renderTrade();
      previewExpiryTimer = setTimeout(() => {
        if (state.preview === preview) { state.preview = null; if (main.isConnected) renderTrade(); }
      }, Math.max(0, remote.expiresAt - Date.now()));
    } catch { /* Speculative reads never delay input or open an error modal. */ }
    finally { if (previewController === controller) previewController = null; }
  }
  // —— 报价 ——
  let quoteExpiryTimer=null,lastTypedAt=0;
  const quoteFlow=createQuoteRefresh({run:options=>refreshQuote(options),
    ready:()=>main.isConnected && !document.hidden && navigator.onLine!==false && !!inT() && !!outT() && Number(state.amount)>0,
    blocked:()=>!!state.transactionBusy || Boolean(approvals.pending(approvalIdentity()))});
  const otherBalances = createIdleRead({
    ready:() => main.isConnected && Boolean(wallet.account) && !document.hidden && navigator.onLine !== false,
    blocked:() => Boolean(previewController) || state.transactionBusy || quoteFlow.running() || submissionWarmup.pending() || Boolean(approvals.pending(approvalIdentity())),
    run:({signal}) => loadBalances(ORDER.filter(key => key !== page.inKey && key !== page.outKey), false, {signal}),
  });
  function resumeIdleReads() {
    if (!main.isConnected) return;
    if (document.hidden || navigator.onLine === false) { otherBalances.pause(); stopPairPrice(); cancelSubmissionWarm(); return; }
    otherBalances.schedule();
    if (!state.amount && !state.transactionBusy && !approvals.pending(approvalIdentity())) refreshPairPrice({reuse:true});
  }
  document.addEventListener('visibilitychange', resumeIdleReads);
  globalThis.addEventListener('online', resumeIdleReads);
  globalThis.addEventListener('pageshow', resumeIdleReads);
  function scheduleQuote(ms=180) { cancelSubmissionWarm();activeWalletController?.abort(); activeSubmissionContext?.dispose(); otherBalances.pause(); ++state.seq;quoteFlow.schedule(ms); }
  function onAmountInput(e) {
    const hadQuote=!!state.quote,now=Date.now();
    const v = limitAmountDecimals(e.target.value.replace(/,/g, "."));
    if (v !== "" && !/^\d*\.?\d*$/.test(v)) { e.target.value = state.amount; return; }
    stopPairPrice(); otherBalances.pause();
    e.target.value = v; state.amount = v;  state.quote = null; state.quoteError = ""; state.refocus = true;
    renderTrade(); renderBottom();
    prewarmQuote();
    const out = main.querySelector("#swap-currency-output input"); if (out) out.value = "";
    scheduleQuote(hadQuote || now-lastTypedAt<400 ? 100 : 0);lastTypedAt=now;
    if (!Number(v)) { refreshPairPrice(); otherBalances.schedule(); }
  }
  function setMax() {
    stopPairPrice();
    const bal = state.balances[page.inKey]; if (bal == null || !inT()) return;
    const MIN_BNB = 10n ** 16n; // 官方 maxAmountSpend：原生币预留 0.01
    const max = inT().key === "bnb" ? (bal > MIN_BNB ? bal - MIN_BNB : 0n) : bal;
    state.amount = swapFormatUnits(max, inT().decimals);  state.quote = null; render(); scheduleQuote(0);
  }
  const missing = () => Object.assign(new Error(SWAP_V10_MISSING.zh), { code: SWAP_V10_MISSING.code });
  // FstSwap 报价：v10 经聚合路由 getAmountsOutVia(FstSwap 适配器)；不直连 FstSwap 路由器
  async function fstAmounts(amountIn, path, read = request) {
    if (!swapV10Ready()) throw missing();
    return v10AmountsOut(read, "fst", amountIn, path);
  }
  // 中间价参照（价格影响）：v10 → 小额 getAmountsOutVia；v9 → FstSwap FIST/WBNB 池储备（只读交易对，不调用路由器）
  async function midOut(tiny, path, read = request) {
    if (swapV10Ready()) return (await fstAmounts(tiny, path, read)).at(-1);
    const iface = new ethers.Interface(PAIR_ABI);
    const [r0raw, t0raw] = await Promise.all([
      read({ method: "eth_call", params: [{ to: FST_FIST_WBNB_PAIR, data: iface.encodeFunctionData("getReserves", []) }, "latest"] }),
      read({ method: "eth_call", params: [{ to: FST_FIST_WBNB_PAIR, data: iface.encodeFunctionData("token0", []) }, "latest"] }),
    ]);
    const [r0, r1] = iface.decodeFunctionResult("getReserves", r0raw);
    const t0 = iface.decodeFunctionResult("token0", t0raw)[0];
    const inIs0 = t0.toLowerCase() === path[0].toLowerCase();
    const [rin, rout] = inIs0 ? [BigInt(r0), BigInt(r1)] : [BigInt(r1), BigInt(r0)];
    return tiny * rout * 9975n / (rin * 10000n);
  }
  const impactOf = (amountIn, out, tiny, ref) => Math.max(0, 1 - (Number(out) / Number(amountIn)) / (Number(ref) / Number(tiny)));
  const feeBpsNow = () => state.config?.platformFeeBps ?? 30;
  // 根据支付数量比较已启用 DEX 和中间币候选。
  async function refreshQuote({background=false,signal}={}) {
    cancelSubmissionWarm();
    const seq = ++state.seq;
    const assertCurrent=()=>{if(signal?.aborted||seq!==state.seq||!main.isConnected)throw new DOMException('Quote read canceled','AbortError');};
    // Configuration remains shared. Cancel only this consumer, never another
    // quote's configuration read or its existing four-second cache lifetime.
    const consume=work=>new Promise((resolve,reject)=>{
      let done=false;
      const finish=(fn,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',onAbort);fn(value);};
      const onAbort=()=>finish(reject,new DOMException('Quote read canceled','AbortError'));
      signal?.addEventListener('abort',onAbort,{once:true});
      Promise.resolve(work).then(value=>{try{assertCurrent();finish(resolve,value);}catch(error){finish(reject,error);}},error=>finish(reject,error));
      if(signal?.aborted)onAbort();
    });
    if(state.quote?.serviceExpiresAt && state.quote.serviceExpiresAt<=Date.now())state.quote=null;
    const ti = inT(), to = outT();
    const typed = state.amount;
    if (!ti || !to || !typed || !(Number(typed) > 0)) { state.quote = null; render(); otherBalances.schedule(); return; }
    state.quoteError = ""; state.quoteErrorReason = "";
    let amount; try { amount = swapUnits(typed, ti.decimals); } catch { state.quote = null; state.quoteError = "AMOUNT_PRECISION"; render(); otherBalances.schedule(); return; }
    const inputKey=JSON.stringify([ti.address||ZERO,to.address||ZERO,amount.toString(),settings.slippageBps,settings.singleHop]);
    const retained=background && state.quoteKey===inputKey && state.quote?.serviceExpiresAt>Date.now() ? state.quote : null;
    const allowanceRead=refreshAllowance("latest",{fresh:false,signal});
    renderBottom();
    try {
      let q, poolPolicy;
      assertCurrent();
      const remote = await swapService.quote({ tokenIn: ti.address, tokenOut: to.address, amountIn: amount,
        slippageBps: settings.slippageBps, singleHop: settings.singleHop }, { router: swapActiveRouter(), adapters: SWAP_ADAPTERS, signal, fresh:background });
      assertCurrent();
      if (remote) {
        state.config = remote.config; q = remote.quote;
        q.serviceMeta = {...remote}; delete q.serviceMeta.quote; q.serviceExpiresAt = remote.expiresAt;
        q.feeAsset = resolveFeeAsset(q.feeToken,TOKENS);
      } else {
      const scopedRead=swapPublicRpc(globalThis.fetch,signal);
      const localRead=async payload=>{assertCurrent();const value=await scopedRead(payload);assertCurrent();return value;};
      const config = await consume(quoteContext.config());
      assertCurrent();
      state.config = config;
      if(!['2.0.0','2.1.0'].includes(config.version)){
        poolPolicy=await readPoolPolicy(localRead,{tokenIn:ti.address,tokenOut:to.address,config,v3Mode:config.version==='1.11'?'legacy':'all'});
        assertCurrent();
      }
      const feeBps = feeBpsNow();
      const policy = swapFeePolicy(ti.address, to.address, state.config?.defaultFeeToken);
      const feeAsset = Object.values(TOKENS).find(t => (t.address || ZERO).toLowerCase() === policy.token.toLowerCase()) || TOKENS.usdt;
      if (["2.0.0","2.1.0"].includes(state.config?.version)) {
        q = await quoteFstSwap(localRead, { tokenIn: ti.address, tokenOut: to.address, amountIn: amount, config: state.config, slippageBps: settings.slippageBps, singleHop: settings.singleHop });
        assertCurrent();
        q.feeAsset = resolveFeeAsset(q.feeToken,TOKENS);
      } else if (isAggPair()) {
        const amountIn = amount;
        const route = await quoteSwap(localRead, { side: side(), amountIn, feeBps, poolPolicy, singleHop: settings.singleHop });
        assertCurrent();
        q = { kind: "agg", route, amountIn, out: route.estimateOut, lpFee: route.platformFee, feeAsset: swapV10Ready() ? feeAsset : TOKENS.bnb };
        if (swapV10Ready()) {
          q.impact = await v10RouteImpact(localRead, [route.first, route.second].filter(Boolean), route.swapBudget, q.out);
        } else try {
          const path = side() === "buy" ? [FST_WBNB, SWAP_TOKENS.fist.address] : [SWAP_TOKENS.fist.address, FST_WBNB];
          const tiny = 10n ** BigInt(Math.max(0, ti.decimals - 4));
          q.impact = impactOf(amountIn, q.out, tiny, await midOut(tiny, path, localRead));
        } catch { q.impact = null; }
      } else {
        // —— 通用币对：一次批量比较所有已启用的 V2 DEX（含平台费） ——
        if (!swapV10Ready()) throw missing();
        const amountIn = amount;
        let swapIn, method;
        if (ti.key === "bnb") { swapIn = swapBuyBudget(amountIn, feeBps).budget; method = "swapBnbToToken"; }
        else if (to.key === "bnb") { swapIn = policy.mode === "input" ? amountIn - amountIn * BigInt(feeBps) / BPS : amountIn; method = "swapTokenToBnb"; }
        else { swapIn = policy.mode === "output" ? amountIn : amountIn - amountIn * BigInt(feeBps) / BPS; method = "swapTokenToToken"; }
        let best = await v10BestAmountsOut(localRead, { tokenIn: ti.address, tokenOut: to.address, amountIn: swapIn,
          singleHop: settings.singleHop, config: state.config, poolPolicy });
        assertCurrent();
        let feePlan;
        if (policy.mode === "convert") {
          let lastError;
          for (const candidate of best.candidates) {
            try {
              feePlan = await v10PlanFeeConversion(localRead, { input: ti.address, feeBudget: amountIn * BigInt(feeBps) / BPS,
                config: state.config, slippageBps: settings.slippageBps, mainLegs: [candidate.first, candidate.second].filter(Boolean) });
              assertCurrent();
              best = candidate; break;
            } catch (err) { if (err?.code !== "NO_FEE_ROUTE") throw err; lastError = err; }
          }
          if (!feePlan) throw lastError;
        }
        const gross = best.out, path = best.first.path;
        const out = policy.mode === "output" ? swapSellNet(gross, feeBps).net : gross;
        const impact = await v10RouteImpact(localRead, [best.first, best.second].filter(Boolean), swapIn, gross);
        assertCurrent();
        q = { kind: "v10", method, path, amountIn, out, impact, feeAsset, adapterKey: best.key,
          lpFee: (policy.mode === "output" ? gross : amountIn) * BigInt(feeBps) / BPS,
          first: best.first, second: best.second };
        if (policy.mode === "convert") {
          q.method = "swapTokenToTokenWithFee"; q.conversion = feePlan.conversion; q.lpFee = feePlan.fee;
        }
      }
      }
      assertCurrent();
      assertQuoteSafety({ tokenIn: ti.address, tokenOut: to.address, amountIn: q.maxIn || q.amountIn,
        amountOut: minOut(q), impact: q.impact, quotedAmountIn: q.amountIn, quotedAmountOut: q.out });
      q.poolCheckedAt = poolPolicy?.checkedAt ?? q.poolCheckedAt ?? Date.now();
      poolPolicy?.assertFresh();
      poolPolicy?.assertValue(q.maxIn || q.amountIn, minOut(q));
      if (seq !== state.seq || !main.isConnected) return;
      if(signal?.aborted || background && state.transactionBusy)return;
      q.serviceExpiresAt ??= q.poolCheckedAt+15000;
      state.quote = q;state.quoteKey=inputKey;state.quoteError = "";
      clearTimeout(quoteExpiryTimer);
      quoteExpiryTimer=setTimeout(()=>{
        if(main.isConnected && state.quote===q && !state.transactionBusy) {state.quote=null;render();if(!quoteFlow.running?.())scheduleQuote(0);}
      },Math.max(0,q.serviceExpiresAt-Date.now()));
      // Read-only output and preloaded approval state render independently.
      render();
      await allowanceRead;
      if (!swapV10Ready()) await refreshAllowance("latest",{fresh:false,signal});
      if (seq !== state.seq) return;
      render();queueSubmissionWarm();
    } catch (err) {
      if (signal?.aborted || err?.name==='AbortError' || seq !== state.seq) return;
      const hardFailure=["NO_ROUTE","NO_FEE_ROUTE","UNSAFE_QUOTE","PRICE_IMPACT_TOO_HIGH"].includes(err?.code) || err?.code==="POOL_LIQUIDITY"&&!err?.retryable;
      if(!hardFailure && retained && retained.serviceExpiresAt>Date.now() && state.quote===retained) {state.quoteError="";renderBottom();return;}
      state.quote = null;
      state.quoteError = err?.code === SWAP_V10_MISSING.code ? SWAP_V10_MISSING.code
        : err?.code === "NO_ROUTE" || /revert|INSUFFICIENT/i.test(err?.message || "") ? "NO_ROUTE" : (err?.code || "SWAP_RPC");
      state.quoteErrorReason = err?.reason || "";
      render();
      if (err?.retryable || !["NO_ROUTE", "NO_FEE_ROUTE", "POOL_LIQUIDITY", "UNSAFE_QUOTE", "PRICE_IMPACT_TOO_HIGH", SWAP_V10_MISSING.code].includes(state.quoteError)) scheduleQuote(8000);
    } finally { if (main.isConnected && !signal?.aborted) otherBalances.schedule(); }
  }

  // Public-only submission preparation. Each completed value belongs to this
  // exact page intent and is consumed once; no wallet RPC runs in this block.
  function submissionIdentity() {
    const q=state.quote,provider=wallet.provider;
    if(!q||!wallet.account||!provider)return null;
    try{return{quote:q,provider,providerRequest:provider.request,expiresAt:q.serviceExpiresAt,
      key:JSON.stringify([walletSubmissionEpoch,wallet.account,inT(),outT(),spender(),state.amount,settings,q],(_,value)=>typeof value==='bigint'?value.toString():value)};}catch{return null;}
  }
  function cancelSubmissionWarm(){clearTimeout(submissionWarmTimer);submissionWarmTimer=null;submissionWarmup.cancel();}
  function queueSubmissionWarm(){clearTimeout(submissionWarmTimer);submissionWarmTimer=setTimeout(()=>{submissionWarmTimer=null;warmPublicSubmission();},0);}
  function swapTransaction(q,deadline,account){
    if(q.kind==='fstswap')return fstRequest(ethers.Interface,{router:swapActiveRouter(),account,quote:q,deadline});
    const args=q.method==='swapBnbToToken'?[q.first,q.second||NO_LEG,minOut(q),deadline,account]:[q.first,q.second||NO_LEG,q.amountIn,minOut(q),deadline,account];
    if(q.conversion)args.push(q.conversion);
    return v10Request(ethers.Interface,{account,method:q.method,args,value:q.method==='swapBnbToToken'?q.amountIn:0n});
  }
  function sameTransaction(a,b){return['from','to','data'].every(key=>String(a[key]).toLowerCase()===String(b[key]).toLowerCase())&&BigInt(a.value??0)===BigInt(b.value??0);}
  function takeSubmissionWarm(kind){
    const identity=submissionIdentity();let result=null;
    submissionWarmup.take(identity,(value,lifetime)=>{
      if(value.kind!==kind)return false;
      const expected=kind==='approve'?swapApproveRequest(ethers.Interface,{account:wallet.account,token:inT().address,spender:spender()}):swapTransaction(state.quote,value.deadline,wallet.account);
      if(!sameTransaction(value.transaction,expected))return false;
      if(value.policy)value.policy.assertFresh();
      result={...value,cacheCompletedAt:lifetime.completedAt,cacheExpiresAt:lifetime.expiresAt};return true;
    });return result;
  }
  function warmPublicSubmission(){
    const identity=submissionIdentity(),q=state.quote;
    if(!identity||!Number.isFinite(identity.expiresAt)||identity.expiresAt<=Date.now()+1200||!main.isConnected||document.hidden||navigator.onLine===false||state.transactionBusy||activeBalanceReads||quoteFlow.running?.()||approvals.pending(approvalIdentity())||!['fstswap','v10'].includes(q.kind))return false;
    if(inT()?.key!=='bnb'&&state.allowance==null)return false;
    const kind=needsApproval()?'approve':'swap',account=wallet.account,minimum=minOut(q),deadline=Math.floor(Date.now()/1000)+settings.deadlineMinutes*60;
    if(kind==='swap'&&(q.kind!=='fstswap'||!['2.0.0','2.1.0'].includes(q.serviceMeta?.config?.version)))return false;
    let transaction;try{checkServiceQuote(q);transaction=Object.freeze(kind==='approve'?swapApproveRequest(ethers.Interface,{account,token:inT().address,spender:spender()}):swapTransaction(q,deadline,account));}catch{return false;}
    const started=submissionWarmup.start(identity,async({signal})=>{
      const startedAt=Date.now();
      const background=(payload,{signal:active=signal}={})=>swapPublicRpc(globalThis.fetch,active,{priority:'background',attempts:1,timeoutMs:2000})(payload);
      const gasOptions=async()=>{
        let estimated=false,priced=false;
        const gas=await prepareGasOptions({signal,multiplierBps:kind==='approve'?15000:13000,fallbackGasLimit:kind==='approve'?100000n:900000n,fallbackGasPrice:kind==='approve'?null:3000000000n,
          estimate:async({signal})=>{const value=await background({method:'eth_estimateGas',params:[transaction]},{signal});estimated=BigInt(value)>0n;return value;},
          gasPrice:async({signal})=>{const value=await background({method:'eth_gasPrice'},{signal});priced=BigInt(value)>0n;return value;}});
        return estimated&&priced?{...gas,gasReady:true}:{gasReady:false};
      };
      let context;
      try{
        if(kind==='approve'){const gas=await gasOptions();if(!gas.gasReady)throw Error('Speculative gas unavailable');return{kind,transaction,...gas,expiresAt:identity.expiresAt};}
        context=createSubmissionReadContext(background,{signal});const read=context.read;
        const [checked,gas]=await Promise.all([recheckSwapQuote({quote:q,readConfig:async()=>readSwapConfig(read,{block:await context.block()}),
          readPolicy:config=>recheckFstQuote(read,q,config)}),gasOptions()]);
        checked.policy.assert(q.first,q.second);checked.policy.assertValue(q.maxIn||q.amountIn,minimum);checked.policy.assertFresh();
        return{kind,transaction,deadline,block:await context.block(),policy:checked.policy,...gas,expiresAt:Math.min(identity.expiresAt,startedAt+20000)};
      }finally{context?.dispose();if(main.isConnected)otherBalances.schedule();}
    });if(started)otherBalances.pause();return started;
  }

  async function sendTx(tx, gasLimit, gasPrice, beforeSubmit, {prepare,signal,provider=wallet.provider,onTiming}={}) {
    return sendWalletOnce({provider,read:transactionRead,transaction:tx,gasLimit,gasPrice,prepare,beforeSubmit,signal,onTiming});
  }
  async function waitReceipt(hash, account, onReceipt, read = transactionRead) {
    return waitForApprovalReceipt({read,recover:recoverWalletIntent,hash,account,onReceipt});
  }
  async function approve() {
    if (!state.quote || !wallet.account || !inT()?.address) return;
    const sp = spender(); if (!sp) return;
    const timing=walletTiming.begin('approve'),wasPending=timing&&submissionWarmup.pending();
    const warm=takeSubmissionWarm('approve');
    timing?.(warm?'warm_hit':wasPending?'warm_pending':'warm_miss');
    const job = approvals.begin({...approvalIdentity(),symbol:inT().symbol});
    if (!job) {timing?.('finished');return;}
    otherBalances.pause(); stopPairPrice(); quoteFlow.pause();
    const releaseReads = swapRpcWork.enterForeground();
    const controller=new AbortController();activeWalletController?.abort();activeWalletController=controller;
    const submittedProvider=wallet.provider,quoted=state.quote,amount=state.amount,output=outT()?.address;
    const intentKey=submissionIdentity()?.key;
    const slippage=settings.slippageBps,deadline=settings.deadlineMinutes,singleHop=settings.singleHop;
    let hash, refreshed=false;
    try {
      const req = swapApproveRequest(ethers.Interface, { account: job.account, token: job.token, spender: job.spender });
      const beforeSubmit=()=>{
        const valid=main.isConnected && submissionIdentity()?.key===intentKey && wallet.provider===submittedProvider && wallet.account===job.account && inT()?.address===job.token && outT()?.address===output && spender()===job.spender && state.quote===quoted && state.amount===amount && settings.slippageBps===slippage && settings.deadlineMinutes===deadline && settings.singleHop===singleHop;
        if(valid)releaseReads();return valid;
      };
      ({ hash } = await sendTx(req,undefined,undefined,beforeSubmit,{provider:submittedProvider,signal:controller.signal,onTiming:timing,
        prepare:({signal})=>timeWalletPhase(timing,'public_gas',()=>warm&&Date.now()>=warm.cacheCompletedAt&&Date.now()<warm.cacheExpiresAt?Promise.resolve({gasLimit:warm.gasLimit,gasPrice:warm.gasPrice}):prepareGasOptions({signal,multiplierBps:15000,fallbackGasLimit:100000n,fallbackGasPrice:null,
          estimate:({signal})=>transactionRead({method:"eth_estimateGas",params:[req]},{signal}),
          gasPrice:({signal})=>transactionRead({method:"eth_gasPrice"},{signal}),
        })),
      }));
      popup({ summary: "Approve " + job.symbol, hash });
      await waitReceipt(hash, job.account, async receipt => {
        if(!main.isConnected || wallet.account!==job.account || inT()?.address!==job.token || spender()!==job.spender)return;
        // Refresh against the mined block concurrently with background transaction checks.
        await refreshAllowance(receipt.blockNumber);refreshed=state.allowance!=null;renderBottom();
      });
    } catch (err) {
      walletTimingFailure(timing,err);
      if (err?.name!=='AbortError' && Number(err?.code) !== 4001 && err?.code !== 'REQUEST_CHANGED') popup({ summary: err?.message || tr("授权失败", "Approval failed"), hash:hash||err?.pendingIntent?.hash, success: false });
    } finally {
      timing?.('finished');
      controller.abort();if(activeWalletController===controller)activeWalletController=null;
      try {
        if(!refreshed && wallet.account===job.account && inT()?.address===job.token) state.allowance=null;
        approvals.end(job);
        if(main.isConnected && !refreshed){await refreshAllowance();renderBottom();}
      } finally { releaseReads(); }
      if(main.isConnected) { otherBalances.schedule(); if (state.amount) scheduleQuote(0); }
    }
  }

  // —— 确认 / 等待 / 已提交 / 错误状态；支付确认由钱包直接显示 ——
  function swapSummary(q, digits = 6) { return [sigDown(q.amountIn, inT().decimals, digits), inT().symbol, sigDown(q.out, outT().decimals, digits), outT().symbol]; }
  function refreshExpiredServiceQuote(q) {
    if (!q?.serviceExpiresAt || Date.now() < q.serviceExpiresAt) return false;
    if (state.quote === q) { state.quote = null; render(); scheduleQuote(0); }
    closeModal(); return true;
  }
  function checkServiceQuote(q) {
    if (!q.serviceMeta) return;
    const input = { chainId:56, tokenIn:(inT().address || ZERO).toLowerCase(), tokenOut:(outT().address || ZERO).toLowerCase(),
      amountIn:swapUnits(state.amount, inT().decimals).toString(), slippageBps:settings.slippageBps, singleHop:settings.singleHop };
    try { validateServiceQuote({...q.serviceMeta, quote:q}, input, {router:swapActiveRouter(), adapters:SWAP_ADAPTERS, expectedVersion:state.config?.version}); }
    catch { throw Object.assign(new Error(tr("报价已失效，请重新获取", "Quote is no longer valid; refresh it")), {code:"UNSAFE_QUOTE"}); }
  }
  async function handleSwapClick(button) {
    const timing=walletTiming.begin('swap');
    if(inT()?.key!=="bnb"&&state.allowance==null){
      timing?.('allowance_refresh_only');button.disabled=true;
      try{await timeWalletPhase(timing,'public_allowance',()=>refreshAllowance());timing?.('approval_refreshed');renderBottom();}
      finally{timing?.('finished');}
      return;
    }
    return startSwap(timing);
  }
  function startSwap(timing) {
    const q = state.quote;
    if (state.transactionBusy || !wallet.account || !q || refreshExpiredServiceQuote(q)) {timing?.('finished');return;}
    if (inputError() || needsApproval()) { renderBottom();timing?.('finished');return; }
    quoteFlow.pause();
    return executeSwap(q,timing);
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
  async function showApprovalIfNeeded(q,{signal}={}) {
    if(inT()?.key==="bnb")return false;
    const account=wallet.account;
    await refreshAllowance("latest",{signal});
    if(signal?.aborted)throw new DOMException('Submission read canceled','AbortError');
    if(wallet.account!==account||state.quote!==q){closeModal();return true;}
    if(!needsApproval())return false;
    closeModal();renderBottom();return true;
  }
  async function executeSwap(q,onTiming) {
    if (state.transactionBusy || !wallet.account || !q || state.quote !== q) {onTiming?.('finished');return;}
    if (refreshExpiredServiceQuote(q)) {onTiming?.('finished');return;}
    if (q.exactOut || q.kind === "v10exact") { state.quote = null; closeModal(); renderBottom(); scheduleQuote(0);onTiming?.('finished');return; }
    const timing=onTiming??walletTiming.begin('swap'),wasPending=timing&&submissionWarmup.pending();
    const warm=takeSubmissionWarm('swap');
    timing?.(warm?'warm_hit':wasPending?'warm_pending':'warm_miss');
    const [ain, sin, aout, sout] = swapSummary(q);
    const [a3, , b3] = swapSummary(q, 3);
    pendingModal(tr("将 " + ain + " " + sin + " 兑换为 " + aout + " " + sout, "Swapping " + ain + " " + sin + " for " + aout + " " + sout));
    const deadline = warm?.deadline??Math.floor(Date.now() / 1000) + settings.deadlineMinutes * 60;
    const min = minOut(q);
    const submittedAccount = wallet.account;
    const submittedProvider=wallet.provider,submittedAmount=state.amount,submittedSingleHop=settings.singleHop;
    const intentKey=submissionIdentity()?.key;
    const submittedTokens = { tokenIn: inT().address, tokenOut: outT().address };
    const submittedSlippage = settings.slippageBps, submittedDeadline = settings.deadlineMinutes;
    let expectedRequest;
    state.transactionBusy=true;quoteFlow.pause();otherBalances.pause();stopPairPrice();
    const releaseReads = swapRpcWork.enterForeground();
    const controller=new AbortController();activeWalletController?.abort();activeWalletController=controller;
    let submissionContext;
    try {
      checkServiceQuote(q);
      assertQuoteSafety({ ...submittedTokens, amountIn: q.maxIn || q.amountIn, amountOut: min, impact: q.impact, quotedAmountIn: q.amountIn, quotedAmountOut: q.out });
      let freshPolicy,prepared,preparedTx,prepareSubmission;
      if(q.kind === "fstswap" || q.kind === "v10") {
        preparedTx=warm?.transaction??swapTransaction(q,deadline,submittedAccount);
        prepareSubmission=async({signal})=>{
          submissionContext=createSubmissionReadContext((payload,{signal})=>swapPublicRpc(globalThis.fetch,signal,{priority:"foreground",attempts:2,timeoutMs:6000})(payload),{signal});
          activeSubmissionContext=submissionContext;
          const read=submissionContext.read;
          const warmValid=(async()=>{
            if(!warm||Date.now()<warm.cacheCompletedAt||Date.now()>=warm.cacheExpiresAt)return false;
            try{const canonical=await timeWalletPhase(timing,'warm_canonical',()=>read({method:'eth_getBlockByNumber',params:[warm.block.number,false]}));if(canonical?.hash!==warm.block.hash)return false;warm.policy.assertFresh();return Date.now()<warm.cacheExpiresAt;}catch(error){if(submissionContext.signal.aborted)throw error;return false;}
          })();
          const freshGas=({signal})=>prepareGasOptions({signal,estimate:({signal})=>swapPublicRpc(globalThis.fetch,signal,{priority:'foreground',attempts:2,timeoutMs:8000})({method:'eth_estimateGas',params:[preparedTx]}),gasPrice:({signal})=>swapPublicRpc(globalThis.fetch,signal,{priority:'foreground',attempts:2,timeoutMs:8000})({method:'eth_gasPrice'})});
          prepared=await prepareSwapSubmission({minimum:min,signal:submissionContext.signal,
            check:()=>recheckSwapQuote({quote:q,readConfig:()=>timeWalletPhase(timing,'public_config',async()=>readSwapConfig(read,{block:await submissionContext.block()})),
              readPolicy:currentConfig=>timeWalletPhase(timing,'public_policy',async()=>await warmValid?warm.policy:q.kind === "fstswap"?recheckFstQuote(read,q,currentConfig):readPoolPolicy(read,{...submittedTokens,config:currentConfig}))}),
            gasOptions:options=>timeWalletPhase(timing,'public_gas',async()=>!warm?.gasReady?freshGas(options):await warmValid?{gasLimit:warm.gasLimit,gasPrice:warm.gasPrice}:freshGas(options)),
            allowance:({signal})=>timeWalletPhase(timing,'public_allowance',()=>showApprovalIfNeeded(q,{signal})),
            simulate:()=>timeWalletPhase(timing,'wallet_simulation',async()=>{
              const raw=await submittedProvider.request({method:"eth_call",params:[preparedTx,"latest"]});
              const codec=new ethers.Interface(q.kind === "fstswap"?FST_ABI:SWAP_ABI);
              return codec.decodeFunctionResult(codec.parseTransaction({data:preparedTx.data}).name,raw)[0];
            }),
            estimate:({signal})=>swapPublicRpc(globalThis.fetch,signal,{priority:"foreground",attempts:2,timeoutMs:8000})({method:"eth_estimateGas",params:[preparedTx]}),
            gasPrice:({signal})=>swapPublicRpc(globalThis.fetch,signal,{priority:"foreground",attempts:2,timeoutMs:8000})({method:"eth_gasPrice"}),
          });
          if(prepared.needsApproval)return prepared;
          freshPolicy=prepared.policy;
          if(inT()?.key!=="bnb"&&state.allowance==null)throw new Error(tr("暂时无法读取授权额度，请稍后重试", "Cannot read approval; please try again"));
          freshPolicy.assert(q.first,q.second);freshPolicy.assertValue(q.maxIn || q.amountIn,min);
          return prepared;
        };
      }else {
        if(await showApprovalIfNeeded(q))return;
        ({policy:freshPolicy}=await recheckSwapQuote({quote:q,readConfig:()=>readSwapConfig(transactionRead),
          readPolicy:currentConfig=>readPoolPolicy(transactionRead,{...submittedTokens,config:currentConfig})}));
      }
      if(!prepareSubmission&&inT()?.key!=="bnb"&&state.allowance==null)throw new Error(tr("暂时无法读取授权额度，请稍后重试", "Cannot read approval; please try again"));
      const beforeSubmit = () => {
        if (!main.isConnected || submissionIdentity()?.key!==intentKey || state.quote !== q || wallet.provider!==submittedProvider || wallet.account !== submittedAccount || state.amount!==submittedAmount || settings.singleHop!==submittedSingleHop || inT()?.address !== submittedTokens.tokenIn || outT()?.address !== submittedTokens.tokenOut || settings.slippageBps !== submittedSlippage || settings.deadlineMinutes !== submittedDeadline) return false;
        if (refreshExpiredServiceQuote(q)) throw Object.assign(new Error(tr("报价已失效，请重新获取", "Quote is no longer valid; refresh it")),{code:"UNSAFE_QUOTE"});
        checkServiceQuote(q); freshPolicy.assertFresh(); releaseReads(); return true;
      };
      const quotedRoute = q.route || q;
      if(!prepareSubmission){freshPolicy.assert(quotedRoute.first, quotedRoute.second);freshPolicy.assertValue(q.maxIn || q.amountIn, min);}
      if (state.quote !== q || wallet.account !== submittedAccount) { closeModal(); return; }
      let hash, preflight = null;
      if (q.kind === "agg") {
        preflight = await preflightSwap(submittedProvider.request.bind(submittedProvider), { account: wallet.account, route: q.route, amountIn: q.amountIn, minOut: min, deadline, allowance: side() === "sell" ? state.allowance : null });
        if (preflight.needsApproval) { closeModal(); renderBottom(); return; }
        if (swapV10Ready() && preflight.simulated === null) throw new Error(tr("链上仿真失败，请刷新报价", "Simulation failed; refresh the quote"));
        if (preflight.simulated !== null && preflight.simulated < min) throw new Error(tr("链上仿真低于最少到账，请刷新报价后重试", "Simulation below minimum received; refresh and retry"));
        const sent = await sendTx(preflight.transaction, preflight.gasLimit, preflight.gasPrice, beforeSubmit,{provider:submittedProvider,signal:controller.signal,onTiming:timing});
        hash = sent.hash; expectedRequest = sent.transaction;
      } else {
        if(!prepareSubmission||!preparedTx)throw missing();
        const sent = await sendTx(preparedTx,undefined,undefined,beforeSubmit,{provider:submittedProvider,signal:controller.signal,prepare:prepareSubmission,onTiming:timing});
        if(sent.needsApproval)return;
        hash = sent.hash; expectedRequest = sent.transaction;
      }
      const summary = "Swap " + a3 + " " + sin + " for " + b3 + " " + sout;
      submittedModal(hash); popup({ summary, hash });
      saveHistory({ hash, summary, time: Date.now() });
      state.amount = "";  state.quote = null; render();
      const receiptReads=createReceiptReadScope(transactionRead,{hash});
      waitReceipt(hash, submittedAccount, undefined, receiptReads.read).then(async () => {
        if (swapV10Ready()) {
          await readV10Receipt(receiptReads.read, hash, { account: submittedAccount, expectedRequest, ...submittedTokens,
            minOut: min, maxIn: q.maxIn || q.amountIn, feeToken: q.feeToken ?? q.feeAsset.address ?? ZERO, expectedFee: q.lpFee, minFeeOut: q.conversion && q.lpFee > 0n ? q.conversion.minOut : 0n });
        } else if (q.kind === "agg") {
          await readSwapReceipt(receiptReads.read, hash, { account: submittedAccount, route: q.route, minOut: min, expectedRequest });
        }
        refreshBalances(); refreshNativeBalance();
      }).catch((err) => popup({ summary: summary + " — " + (err?.message || ""), hash, success: false })).finally(()=>receiptReads.dispose());
    } catch (err) {
      walletTimingFailure(timing,err);
      if(err?.name === "AbortError"){closeModal();return;}
      if(!["UNSAFE_QUOTE","PRICE_IMPACT_TOO_HIGH","POOL_LIQUIDITY"].includes(err?.code)&&!err?.pendingIntent&&Number(err?.code)!==4001&&state.quote===q&&await showApprovalIfNeeded(q))return;
      if (err?.pendingIntent) errorModal(err.message, err.pendingIntent);
      else if (Number(err?.code) === 4001) errorModal(T("交易被拒绝。"));
      else errorModal(err?.message || tr("交易失败", "Transaction failed"));
    } finally {
      timing?.('finished');
      controller.abort();if(activeWalletController===controller)activeWalletController=null;
      submissionContext?.dispose();if(activeSubmissionContext===submissionContext)activeSubmissionContext=null;
      releaseReads();state.transactionBusy=false;if(main.isConnected && state.amount)scheduleQuote(0);
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
  // subscribe() immediately emits the current wallet; startup below already handles it.
  let initialWalletNotification = true;
  const stopWallet=wallet.subscribe(() => {
    if (initialWalletNotification) return;
    if (!main.isConnected) return;
    walletSubmissionEpoch++;cancelSubmissionWarm();
    otherBalances.pause();
    if (wallet.account && !page.connectedDefaults) applyDefaults();
    invalidateWalletBalances();allowanceReader.invalidate();state.allowance=null;state.allowanceIdentity=null;
    state.quote = null; ++state.seq; ++state.balanceEpoch; closeModal(); state.balances = {}; state.balanceErrors = {}; render(); refreshBalances(false); restoreSubmittedTransaction(); scheduleQuote(0); refreshPairPrice({reuse:true});
  });

  initialWalletNotification = false;
  const stopTokens=onTokensChanged(() => { if (main.isConnected) { state.quote=null; state.allowance=null; render(); scheduleQuote(0); } });
  const stopApprovals = approvals.subscribe(()=>{if(!main.isConnected)return false;renderBottom();});
  globalThis.addEventListener('hashchange',()=>{cancelSubmissionWarm();stopWallet();stopTokens();stopApprovals();document.removeEventListener('click',closeSettings);document.removeEventListener('visibilitychange',resumeIdleReads);globalThis.removeEventListener('online',resumeIdleReads);globalThis.removeEventListener('pageshow',resumeIdleReads);clearTimeout(quoteExpiryTimer);quoteFlow.dispose();otherBalances.dispose();activeWalletController?.abort();activeSubmissionContext?.dispose();stopPairPrice();allowanceReader.invalidate();},{once:true});
  renderSettings(); render();
  refreshDefaultList();
  if (wallet.account) { refreshBalances(false); restoreSubmittedTransaction(); }
  prewarmQuote(); refreshPairPrice();
  if (!swapService.available?.()) {
    try { state.config = await quoteContext.config(); } catch { state.config = null; }
  }
  if (state.amount) scheduleQuote(0);
}

export async function initSwapApp() { const root = document.getElementById("root"); if (root) await mountSwapView(root); }
