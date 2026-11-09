// 共用外壳：按官方 fstswap.github.io 运行时 DOM 渲染（Header/HeaderLinks/Polling/Popups/SwitchLocaleLink/Modal），
// 模板来自 swap-official-tpl.mjs（官方 DOM 快照），样式来自 swap-official.css（官方运行时样式）。
// 钱包连接逻辑沿用（注入式 / WalletConnect / Coinbase→injected→WC / Fortmatic·Portis 已停服回退）。
import { SWAP_CHAIN, connectInjected, walletConnectAccount,
  walletShort, loadSwapWalletConnect, disconnectWalletConnect } from "./swap-wallet.mjs?v=review-20261110-3";
import { swapPublicRpc, loadSwapLibrary } from "./swap-aggregator.mjs?v=mainnet-20261110-5";
import { TPL, EN } from "./swap-official-tpl.mjs?v=official-20261109";
import { jazziconHtml } from "./swap-jazzicon.mjs?v=official-20261109";
import "./swap-ui.mjs?v=review-20261110-3";

// —— 语言：与官方一致，优先 URL ?lng=，其次已保存选择，最后按浏览器语言（zh* → 简体中文，否则英文） ——
let language = "en";
function detectLanguage() {
  const q = (location.hash.split("?")[1] || "").match(/(?:^|&)lng=([\w-]+)/);
  if (q) { language = /^zh/i.test(q[1]) ? "zh" : "en"; try { localStorage.setItem("swap_language", language); } catch {} return; }
  try { const saved = localStorage.getItem("swap_language"); if (saved === "zh" || saved === "en") { language = saved; return; } } catch {}
  language = /^zh/i.test(navigator.language || "") ? "zh" : "en";
}
detectLanguage();
export const getLanguage = () => language;
export const tr = (zh, en) => language === "en" ? en : zh;
const EXTRA_EN = {
  "已提交交易": "Transaction Submitted", "关闭": "Close", "将 FIST 添加到 Metamask": "Add FIST to Metamask",
  "将 USDT 添加到 Metamask": "Add USDT to Metamask", "将 BNB 添加到 Metamask": "Add BNB to Metamask",
  "未找到结果。": "No results found.", "交易被拒绝。": "Transaction rejected.", "错误": "Error",
  "现有流动量不足以支持此交易。": "Insufficient liquidity for this trade.",
  "确认供应": "Confirm Supply", "您将收到": "You will receive", "流动池代币": "Pool Tokens",
  "批准中": "Approving", "已批准": "Approved",
};
/// 官方中文文案 → 当前语言（英文取官方 en-US 文案）。
export const T = (zh) => language === "en" ? (EN[zh] ?? EXTRA_EN[zh] ?? zh) : zh;
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/// 把模板内官方中文文案替换为当前语言（文本节点 + placeholder/aria-label/title）。
export function localize(el) {
  if (language !== "en" || !el) return el;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue, t = raw.trim(); if (!t || !/[\u4e00-\u9fff（）：]/.test(t)) continue;
    let out = EN[t] ?? EXTRA_EN[t];
    if (out == null) {
      let m;
      if ((m = t.match(/^余额：(.*)$/))) out = "Balance: " + m[1];
      else if ((m = t.match(/^将 (.+) 兑换为 (.+)$/))) out = "Swapping " + m[1] + " for " + m[2];
      else if ((m = t.match(/^(.+) 每 (.+)$/))) out = m[1] + " per " + m[2];
      else if ((m = t.match(/^批准 (.+)$/))) out = "Approve " + m[1];
      else if ((m = t.match(/^允许 Fstswap 调用您的 (.+)$/))) out = "Allow the Fstswap Protocol to use your " + m[1];
      else if ((m = t.match(/^(.+)余额不足$/))) out = "Insufficient " + m[1].trim() + " balance";
    }
    if (out != null) node.nodeValue = raw.replace(t, out);
  }
  el.querySelectorAll?.("[placeholder],[aria-label],[title]").forEach((e) => {
    for (const k of ["placeholder", "aria-label", "title"]) { const v = e.getAttribute(k); if (v && (EN[v] || EXTRA_EN[v])) e.setAttribute(k, EN[v] || EXTRA_EN[v]); }
  });
  return el;
}

// —— 模板工具 ——
const tplCache = new Map();
/// 返回官方模板 key 的一个新 DOM 克隆（已按当前语言本地化）。
export function tpl(key) {
  if (!tplCache.has(key)) { const t = document.createElement("template"); t.innerHTML = TPL[key]; tplCache.set(key, t); }
  return localize(tplCache.get(key).content.firstElementChild.cloneNode(true));
}
/// 从模板 key 中按选择器取一个子树克隆。
export function part(key, selector) {
  const el = tpl(key); const found = selector ? el.querySelector(selector) : el;
  return found ? found.cloneNode(true) : null;
}
export function html(markup) { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstElementChild; }

export const DEFAULT_ANALYSIS = { a: "0x55d398326f99059ff775485246999027b3197955", b: "0xc9882def23bc42d53895b8361d0b1edc7570bc6a" };
export function navItems() {
  return [
    { key: "analysis", id: "swap-nav-home", label: tr("首页", "Home"), href: `#/analysis/${DEFAULT_ANALYSIS.a}/${DEFAULT_ANALYSIS.b}` },
    { key: "swap", id: "swap-nav-link", label: tr("兑换", "Swap"), href: "#/swap" },
    { key: "pool", id: "pool-nav-link", label: tr("流动池", "Pool"), href: "#/pool" },
    { key: "my", id: "swap-nav-my", label: tr("我的", "My"), href: "#/my" },
  ];
}
export function currentRoute() {
  detectLanguage();
  const hash = location.hash || "#/swap";
  const name = hash.replace(/^#\//, "").split("/")[0].split("?")[0] || "swap";
  return ["analysis", "swap", "pool", "add", "remove", "my"].includes(name) ? name : "swap";
}
export function hashParts() { return (location.hash || "").replace(/^#\//, "").split("?")[0].split("/"); }
export function analysisPairFromHash() {
  const parts = hashParts();
  if (parts[0] !== "analysis") return { a: DEFAULT_ANALYSIS.a, b: DEFAULT_ANALYSIS.b };
  return { a: (parts[1] || DEFAULT_ANALYSIS.a).toLowerCase(), b: (parts[2] || DEFAULT_ANALYSIS.b).toLowerCase() };
}

// —— 全站共享钱包状态 ——
const walletState = {
  wallet: null, wcProvider: null, bnb: null,
  listeners: new Set(),
  get account() { return walletState.wallet?.account || null; },
  get provider() { return walletState.wallet?.provider || null; },
  subscribe(fn) { walletState.listeners.add(fn); if (walletState.wallet) { try { fn(walletState.wallet); } catch {} } return () => walletState.listeners.delete(fn); },
  notify() { walletState.listeners.forEach((fn) => { try { fn(walletState.wallet); } catch {} }); },
};
export const useWallet = () => walletState;

export function checksum(address) { try { return globalThis.ethers?.getAddress(address) || address; } catch { return address; } }
export function shortAddress(address) { const a = checksum(address); return a ? a.slice(0, 6) + "..." + a.slice(38) : ""; }
/// 官方 toSignificant(n)：有效数字向下截断，去掉多余 0。
export function significant(value, decimals, digits = 4) {
  if (value == null) return "";
  const text = typeof value === "bigint" ? (globalThis.ethers ? globalThis.ethers.formatUnits(value, decimals) : String(value)) : String(value);
  const num = Number(text); if (!Number.isFinite(num) || num === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(num))); const scale = 10 ** (digits - 1 - exp);
  const cut = Math.floor(num * scale + 1e-9) / scale;
  const places = Math.max(0, digits - 1 - exp);
  return cut.toFixed(Math.min(places, 18)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

// —— Header ——
function headerEl(route) {
  const active = route === "add" || route === "remove" ? "pool" : route;
  const el = tpl(walletState.account ? "header_on" : "header_off");
  const brand = el.querySelector(".APMAQ");
  if (brand) { brand.textContent = "FstSwap"; brand.title = "FstSwap"; }
  const logo = el.querySelector(".dmxuPu img");
  if (logo) logo.alt = "FstSwap";
  el.querySelectorAll("a[id]").forEach((a) => {
    const item = navItems().find((n) => n.id === a.id); if (!item) return;
    a.classList.toggle("ACTIVE", item.key === active);
    if (item.key === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (walletState.account) {
    const bal = el.querySelector(".falNtq");
    if (bal) { if (walletState.bnb == null) bal.remove(); else bal.textContent = significant(walletState.bnb, 18, 3) + " BNB"; }
    const btn = el.querySelector("#web3-status-connected");
    btn.querySelector("p").textContent = shortAddress(walletState.account);
    btn.querySelector(".hDfiCk").innerHTML = jazziconHtml(checksum(walletState.account), 16);
  }
  return el;
}
let frameRoute = "swap";
export function renderHeader() {
  const holder = document.querySelector("#root .ibtXyT");
  if (!holder) return;
  const next = headerEl(frameRoute); holder.replaceWith(next); bindHeaderButtons(next);
}
function bindHeaderButtons(el) {
  el.querySelector("#connect-wallet")?.addEventListener("click", () => openWalletModal());
  el.querySelector("#web3-status-connected")?.addEventListener("click", () => openAccountModal());
}
export function bindHeaderScroll() { /* 官方 HeaderFrame 滚动背景由样式类控制；外壳固定在顶部（移动端底栏） */ }

// —— 页面框架：AppWrapper > HeaderWrapper + BodyWrapper(Popups/Polling/page/SwitchLocaleLink/Marginer) ——
export function mountFrame(root, route, mainEl) {
  frameRoute = route;
  root.innerHTML = "";
  const app = html('<div class="sc-9dn3oc-0 dPzCpt"></div>');
  const header = headerEl(route); app.append(header);
  const body = html('<div class="sc-9dn3oc-1 joauzn"></div>');
  body.append(html('<div class="sc-16waliw-2 sc-t0vzvf-2 dcfoEc fCHlNA"></div>'));
  body.append(html('<div height="0" class="sc-t0vzvf-0 hVoVdg"><div class="sc-t0vzvf-1 hTtbdE"></div></div>'));
  body.append(pollingEl());
  if (mainEl) body.append(mainEl);
  body.append(footerEl(route));
  body.append(html('<div class="sc-9dn3oc-3 fIPKBG"></div>'));
  app.append(body); root.append(app);
  bindHeaderButtons(header);
  startPolling();
  return body;
}
function footerEl() {
  const path = (location.hash || "#/swap").split("?")[0];
  const el = html('<div class="sc-132ya8j-0 gBijIa sc-1dchz9g-0 gCVcKz css-x9zcw6"></div>');
  el.append(document.createTextNode(tr("Fstswap可用：", "Fstswap available in: ")));
  const a = html('<a class="sc-hia0it-4 caOwQu"></a>');
  a.href = path + (language === "en" ? "?lng=zh-CN" : "?lng=en-US");
  a.textContent = language === "en" ? "简体中文" : "English";
  el.append(a); return el;
}
export const localeHtml = () => "";
export function bindLocale() {}
export const topbarHtml = () => "";
export const dockHtml = () => "";

// —— Polling（区块高度） ——
let lastBlock = null, pollTimer = null;
function pollingEl() {
  const el = tpl("polling");
  if (lastBlock) { el.href = "https://bscscan.com/block/" + lastBlock; el.querySelector(".gXlyCc").textContent = String(lastBlock); }
  else { el.href = ""; el.querySelector(".gXlyCc").textContent = ""; }
  return el;
}
function startPolling() {
  if (pollTimer) return;
  const tick = async () => {
    try {
      const n = Number(BigInt(await swapPublicRpc()({ method: "eth_blockNumber" })));
      if (n) {
        lastBlock = n;
        document.querySelectorAll("#root .joauzn > a.fQylAf").forEach((a) => { a.href = "https://bscscan.com/block/" + n; a.querySelector(".gXlyCc").textContent = String(n); });
        if (walletState.account) refreshNativeBalance();
      }
    } catch {}
  };
  tick(); pollTimer = setInterval(tick, 6000);
}
export async function refreshNativeBalance() {
  if (!walletState.wallet) return;
  try {
    const raw = await walletState.wallet.provider.request({ method: "eth_getBalance", params: [walletState.account, "latest"] });
    const next = BigInt(raw); if (next !== walletState.bnb) { walletState.bnb = next; renderHeader(); }
  } catch {}
}

// —— Popups（官方 PopupItem：右上角/移动端顶部，带进度条，25s 自动消失） ——
const CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#27AE60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
const ALERT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FD4040" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
export function popup({ summary, hash, success = true, ms = 25000 }) {
  const make = (key, sel) => {
    const src = part(key, sel); if (!src) return null;
    const item = src.querySelector(".cCnyGV"); if (!item) return null;
    item.querySelector(".jLCYhp, .css-1a92al5").textContent = summary;
    const link = item.querySelector("a.fQylAf");
    if (hash) { link.href = "https://bscscan.com/tx/" + hash; link.textContent = tr("View on Explorer", "View on Explorer"); } else link.remove();
    const icon = item.querySelector('div[style*="padding-right"]'); if (icon) icon.innerHTML = success ? CHECK_SVG : ALERT_SVG;
    const bar = item.querySelector(".dOaoNK"); const start = Date.now();
    const close = () => { item.remove(); syncPopupHeights(); };
    item.querySelector("svg")?.addEventListener("click", close);
    const step = () => { const left = Math.max(0, 1 - (Date.now() - start) / ms); if (bar) bar.style.width = (left * 100).toFixed(3) + "%"; if (left <= 0) close(); else if (item.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    return item;
  };
  const desk = document.querySelector("#root .fCHlNA"); const mob = document.querySelector("#root .joauzn > div[height] .hTtbdE");
  const d = make("popups_desktop"); const m = make("popups_mobile");
  if (desk && d) desk.prepend(d); if (mob && m) mob.prepend(m);
  syncPopupHeights();
}
function syncPopupHeights() {
  const wrap = document.querySelector("#root .joauzn > div[height]"); if (!wrap) return;
  const has = wrap.querySelector(".cCnyGV");
  wrap.setAttribute("height", has ? "fit-content" : "0"); wrap.className = "sc-t0vzvf-0 " + (has ? "bBbVcB" : "hVoVdg");
}

// —— Modal（官方 reach-dialog 结构，挂到 body 的 reach-portal） ——
let portal = null;
export function openModal(overlayEl, { onClose } = {}) {
  closeModal();
  portal = document.createElement("reach-portal");
  const lock = html('<div data-focus-lock-disabled="false"><div></div></div>');
  lock.firstElementChild.append(overlayEl); portal.append(lock); document.body.append(portal);
  document.body.classList.add("agg-scroll-lock");
  overlayEl.addEventListener("mousedown", (e) => { if (e.target === overlayEl) { closeModal(); onClose?.(); } });
  const esc = (e) => { if (e.key === "Escape") { closeModal(); onClose?.(); } };
  document.addEventListener("keydown", esc); portal._esc = esc;
  return overlayEl;
}
export function closeModal() {
  if (!portal) return;
  document.removeEventListener("keydown", portal._esc); portal.remove(); portal = null;
  document.body.classList.remove("agg-scroll-lock");
}
export function modalOpen() { return Boolean(portal); }

// —— 钱包连接 ——
export function walletChrome() { walletState.subscribe(() => renderHeader()); }
export async function connectWallet() {
  const wallet = await connectInjected();
  walletState.wallet = wallet; walletState.bnb = null;
  try { await loadSwapLibrary(); } catch {}
  walletState.notify(); renderHeader(); refreshNativeBalance();
  wallet.provider.on?.("accountsChanged", (accounts) => {
    if (!accounts?.length) { disconnectWallet(); return; }
    walletState.wallet = { ...walletState.wallet, account: accounts[0] }; walletState.bnb = null; walletState.notify(); renderHeader(); refreshNativeBalance();
  });
  wallet.provider.on?.("chainChanged", () => { walletState.bnb = null; walletState.notify(); renderHeader(); });
  return wallet;
}
export async function connectWalletScan(qrHost) {
  let provider = await loadSwapWalletConnect();
  const done = async (account) => { provider.on?.("chainChanged", () => { walletState.bnb = null; walletState.notify(); renderHeader(); }); provider.on?.("accountsChanged", (accounts) => { if (!accounts?.length) { disconnectWallet(); return; } walletState.wallet = { ...walletState.wallet, account: accounts[0] }; walletState.bnb = null; walletState.notify(); renderHeader(); }); walletState.wallet = { provider, account, kind: "walletconnect" }; walletState.wcProvider = provider; walletState.bnb = null; walletState.notify(); renderHeader(); refreshNativeBalance(); return walletState.wallet; };
  const existing = await walletConnectAccount(provider); if (existing) return done(existing);
  await disconnectWalletConnect(provider); provider = await loadSwapWalletConnect();
  if (qrHost) {
    const { toCanvas } = await import("./assets/vendor/walletconnect/qrcode-1.5.4.js");
    provider.on("display_uri", (event) => {
      const uri = typeof event === "string" ? event : event?.uri;
      if (!uri || !qrHost.isConnected) return;
      const c = document.createElement("canvas"); qrHost.replaceChildren(c);
      toCanvas(c, uri, { width: 240, margin: 1 }).catch(() => { qrHost.textContent = tr("二维码加载失败，请重试", "QR code failed to load; please retry"); });
    });
  }
  await provider.connect({ optionalNamespaces: { eip155: { chains: [`eip155:${SWAP_CHAIN.chainId}`],
    methods: ["eth_sendTransaction", "personal_sign"], events: ["accountsChanged", "chainChanged"] } } });
  const account = await walletConnectAccount(provider);
  if (!account) throw Object.assign(new Error(tr("配对未完成", "Pairing incomplete")), { code: "WC_PENDING" });
  return done(account);
}
export async function disconnectWallet() {
  if (walletState.wcProvider) await disconnectWalletConnect(walletState.wcProvider);
  walletState.wallet = null; walletState.wcProvider = null; walletState.bnb = null;
  walletState.notify(); renderHeader();
}

/// 官方 WalletModal（选项列表）；无注入钱包时 MetaMask 项显示 Install Metamask（与官方一致）。
export function openWalletModal() {
  const overlay = tpl("wallet_modal");
  const hasInjected = Boolean(globalThis.ethereum || globalThis.okxwallet || globalThis.binance);
  const mm = overlay.querySelector("#connect-METAMASK");
  if (!hasInjected && mm) mm.querySelector(".gpyNbR").textContent = "Install Metamask";
  openModal(overlay);
  overlay.querySelector(".hIWQgn")?.addEventListener("click", closeModal);
  const run = (fn) => { closeModal(); fn().catch((err) => popup({ summary: err?.message || tr("连接失败", "Connection failed"), success: false })); };
  mm?.addEventListener("click", () => {
    if (!hasInjected) { window.open("https://metamask.io/", "_blank", "noopener"); return; }
    run(() => connectWallet());
  });
  overlay.querySelector("#connect-WALLET_CONNECT")?.addEventListener("click", () => {
    // 官方 PendingView 位置展示二维码
    const opts = overlay.querySelector(".fvKtIt"); const qr = html('<div style="display:flex;justify-content:center;padding:1rem;background:#fff;border-radius:12px;min-height:240px;align-items:center;color:#000;">…</div>');
    opts.replaceChildren(qr);
    connectWalletScan(qr).then(() => closeModal()).catch((err) => { closeModal(); popup({ summary: err?.message || "WalletConnect", success: false }); });
  });
  overlay.querySelector("#connect-WALLET_LINK")?.addEventListener("click", () => run(() => connectWallet().catch(() => connectWalletScan())));
  const retired = (name) => run(async () => { popup({ summary: name + tr(" 已停止服务，改用浏览器钱包 / WalletConnect", " is retired; using browser wallet / WalletConnect instead"), success: false, ms: 6000 }); return connectWallet().catch(() => connectWalletScan()); });
  overlay.querySelector("#connect-FORTMATIC")?.addEventListener("click", () => retired("Fortmatic"));
  overlay.querySelector("#connect-Portis")?.addEventListener("click", () => retired("Portis"));
}

/// 官方 AccountDetails（账户弹窗）。
export function openAccountModal() {
  if (!walletState.account) return openWalletModal();
  const overlay = tpl("account_modal");
  const account = checksum(walletState.account);
  overlay.querySelector(".hAstkF").textContent = tr("已与 ", "Connected with ") + (walletState.wallet?.kind === "walletconnect" ? "WalletConnect" : "MetaMask") + tr(" 连接", "");
  const row = overlay.querySelector("#web3-account-identifier-row");
  row.querySelector(".hDfiCk").innerHTML = jazziconHtml(account, 16);
  row.querySelector("p").textContent = " " + shortAddress(account);
  overlay.querySelectorAll('a[href*="bscscan.com/address/"]').forEach((a) => { a.href = "https://bscscan.com/address/" + account; });
  const copy = row.querySelector("button");
  copy?.addEventListener("click", () => {
    navigator.clipboard?.writeText(account).catch(() => {});
    const label = copy.querySelector('span[style*="margin-left"]'); const old = label.textContent; label.textContent = tr("已复制", "Copied");
    setTimeout(() => { label.textContent = old; }, 1000);
  });
  // 官方仅 WalletConnect 等会话型连接显示断开
  if (walletState.wallet?.kind === "walletconnect") {
    const head = overlay.querySelector(".hAstkF").parentElement;
    const btn = html('<button class="sc-hia0it-3 sc-1t935po-0 jzypqH fsoAiG" style="font-size:.825rem;">' + tr("断开连接", "Disconnect") + "</button>");
    btn.addEventListener("click", () => { closeModal(); disconnectWallet(); });
    head.lastElementChild.replaceWith(btn);
  }
  openModal(overlay);
  overlay.querySelector(".kdalNt")?.addEventListener("click", closeModal);
}
