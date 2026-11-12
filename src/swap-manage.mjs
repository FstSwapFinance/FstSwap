// 选择代币弹窗 →「管理代币列表」（官方 CurrencySearchModal 的 Manage / ImportList / ImportToken 视图）逐节点复刻。
// DOM 来自官方快照 swap-manage-tpl.mjs（tests/capture-manage.mjs 抓取），本模块只替换动态内容并接线：
//  - 列表：列表/代币 两个标签、列表开关（开启/关闭）、齿轮弹层（版本 / 查看代币列表 / 去除代币列表）、
//    输入 URL 导入列表（https:// / ipfs://）、导入列表确认页（我已知悉 → 导入）；
//  - 代币：输入合约地址 → 已激活 / 导入行、导入代币确认页、自定义代币列表（单个删除 / 全部清除）；
//  - 返回箭头回到选择代币；关闭按钮关闭弹窗。状态本地存储（localStorage），与官方 redux-persist 一致只存在浏览器。
import { MANAGE_TPL, MANAGE_EN } from "./swap-manage-tpl.mjs?v=fstsi-v10-20261110";
import { TOKEN_CHAIN_ID, isAddress, normalizeToken, validateTokenList, restoreTokenStore, activeEntries, listSourceUrls, addCustomEntry, removeCustomEntry, removeListEntry } from "./swap-token-lists.mjs?v=manage-20261110-1";
import { tr, getLanguage } from "./swap-shell.mjs?v=mainnet-20261112-39";

import DEFAULT_LIST from "./swap-default-tokens.mjs";
import { TOKEN_LIST_SOURCE, migrateDefaultSource, preferNewerList } from "./token-catalog.mjs";
import { applyTokenLogo } from "./swap-token-logo.mjs";

const STORE_KEY = "fst_manage_lists_v1";
const CHAIN_ID = TOKEN_CHAIN_ID;
export const DEFAULT_LIST_URL = TOKEN_LIST_SOURCE;
const LOCAL_LIST_URL = new URL('../tokens.json', import.meta.url).href;

// —— 存储（列表 + 自定义代币） ——
function load() {
  let raw; try { raw = localStorage.getItem(STORE_KEY); } catch { /* Storage can be disabled. */ }
  raw = migrateDefaultSource(raw, [`${location.protocol}//${location.host}/tokens.json?v1`, LOCAL_LIST_URL+'?v1'], DEFAULT_LIST_URL, DEFAULT_LIST);
  return restoreTokenStore(raw, DEFAULT_LIST_URL, DEFAULT_LIST);
}
let store = load();
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} emit(); };
const listeners = new Set();
export const onTokensChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });
let defaultPromise;
export function refreshDefaultList() {
  return defaultPromise ??= (async () => {
    for (const source of [DEFAULT_LIST_URL, LOCAL_LIST_URL]) {
      try { const list = await fetchList(source); store.lists[DEFAULT_LIST_URL].list = preferNewerList(store.lists[DEFAULT_LIST_URL].list, list); save(); return; } catch { /* Cached/embedded snapshot keeps the page usable. */ }
    }
  })();
}

const lower = (a) => String(a || "").toLowerCase();
const checksum = (a) => { try { return globalThis.ethers.getAddress(a); } catch { return a; } };
const chainTokens = (list) => (list?.tokens || []).filter((t) => t.chainId === CHAIN_ID);
const listUrls = () => Object.keys(store.lists);

/// 当前可选代币（激活列表 + 用户添加），按地址去重；列表优先（与官方一致）。
export function activeTokenEntries() {
  return activeEntries(store).map(t => ({ ...t, address: checksum(t.address) }));
}
/// 地址在激活列表或自定义里的信息（无则 null）。
export function findActiveToken(address) { return activeTokenEntries().find((t) => lower(t.address) === lower(address)) || null; }
export function addCustomToken(token) {
  addCustomEntry(store, { ...token, address: checksum(token.address) });
  save();
}

// —— 列表抓取（官方 getTokenList：uriToHttp + 校验 tokens 数组） ——
const canonicalSource = (url) => {
  const value = String(url || "").trim();
  return /^https?:/i.test(value) ? (listSourceUrls(value)[0] || value) : value;
};
async function fetchList(url, signal) {
  const urls = listSourceUrls(url);
  if (!urls.length) throw new Error("invalid");
  let lastErr;
  for (const u of urls) {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try {
      const res = await fetch(u, { signal: controller.signal, cache: "no-cache" });
      if (!res.ok) throw new Error("http " + res.status);
      return validateTokenList(await res.json());
    } catch (e) { lastErr = e; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  throw lastErr || new Error("fetch failed");
}

// —— 链上读代币信息（导入代币） ——
const ERC20 = ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"];
const ERC20_B32 = ["function name() view returns (bytes32)", "function symbol() view returns (bytes32)"];
async function readToken(request, address) {
  const { Interface, decodeBytes32String } = globalThis.ethers;
  const i = new Interface(ERC20), b = new Interface(ERC20_B32);
  const call = (fn) => request({ method: "eth_call", params: [{ to: address, data: i.encodeFunctionData(fn, []) }, "latest"] });
  const [n, s, d] = await Promise.all([call("name").catch(() => "0x"), call("symbol").catch(() => "0x"), call("decimals").catch(() => "0x")]);
  const str = (raw, fn) => { try { return i.decodeFunctionResult(fn, raw)[0]; } catch { try { return decodeBytes32String(b.decodeFunctionResult(fn, raw)[0]); } catch { return null; } } };
  let decimals = null; try { decimals = Number(i.decodeFunctionResult("decimals", d)[0]); } catch {}
  const symbol = str(s, "symbol"), name = str(n, "name");
  if (decimals == null || !symbol) return null;
  try { return normalizeToken({ chainId: CHAIN_ID, address: checksum(address), symbol, name: name || symbol, decimals }); } catch { return null; }
}

// —— 模板 / 本地化 ——
function fromTpl(key) {
  const t = document.createElement("template"); t.innerHTML = MANAGE_TPL[key].html;
  const frag = t.content; if (getLanguage() === "en") localize(frag);
  return { cls: MANAGE_TPL[key].cls, node: frag.firstElementChild };
}
function localize(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { const v = n.nodeValue.trim(); if (MANAGE_EN[v]) n.nodeValue = n.nodeValue.replace(v, MANAGE_EN[v]); }
  root.querySelectorAll?.("[placeholder],[title]").forEach((el) => {
    for (const a of ["placeholder", "title"]) { const v = el.getAttribute(a); if (v && MANAGE_EN[v]) el.setAttribute(a, MANAGE_EN[v]); }
  });
}
function accessibleAction(el, label, action) {
  if (!el) return;
  el.setAttribute("role", "button"); el.setAttribute("aria-label", label); el.tabIndex = 0;
  el.addEventListener("click", action);
  el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); action(); } });
}
function statusText(message) {
  const el = document.createElement("div"); el.className = "css-n821sw"; el.setAttribute("role", "status"); el.textContent = message; return el;
}
const nTokens = (n) => tr(n + " 代币", n + " tokens");
const versionLabel = (v) => (v ? `v${v.major}.${v.minor}.${v.patch}` : "");
const rowId = (url) => "list-row-" + url.replace(/\./g, "-");

/// 打开「管理」视图。content = 弹窗的 [data-reach-dialog-content]；onBack 恢复选择代币视图；
/// onSelectToken(token) 导入代币后选中（官方 handleCurrencySelect：选中并关闭弹窗）。
export function openManageView({ content, onBack, onClose, onSelectToken, request, initial = "manage", importToken = null }) {
  const st = { showLists: true, listInput: "", addError: null, tempList: null, popover: null, tokenInput: "", searchToken: null, tokenError: false,
    listLoading: false, tokenLoading: false, view: initial, importList: null, importListUrl: "", understood: false, importToken, prevView: "manage", seq: 0 };
  let alive = true, currentNode = null, listController = null, listTimer = null, popCleanup = () => {};
  const ownsView = () => alive && content.isConnected && (!currentNode || currentNode.parentNode === content);
  const cancelPending = () => { st.seq++; clearTimeout(listTimer); listController?.abort(); st.listLoading = false; st.tokenLoading = false; };
  const dispose = () => { alive = false; cancelPending(); popCleanup(); };
  const leave = (fn) => () => { dispose(); fn(); };
  refreshDefaultList().then(() => {
    if (ownsView() && st.view === "manage") render(document.activeElement?.id && content.contains(document.activeElement) ? "#" + document.activeElement.id : undefined);
  });
  const set = (cls, node) => { popCleanup(); currentNode = node; content.className = cls + " token-manage-modal"; content.replaceChildren(node); content.scrollTop = 0; };
  const header = (root, backFn) => {
    const back = [...root.querySelectorAll("svg")].find((s) => s.querySelector("polyline[points='12 19 5 12 12 5']"));
    accessibleAction(back, tr("返回", "Back"), backFn);
    accessibleAction(root.querySelector("svg.cinYcx"), tr("关闭", "Close"), leave(onClose));
  };
  function render(focus) {
    if (!ownsView()) return;
    const focusedInput = focus && content.querySelector(focus);
    const selection = focusedInput ? [focusedInput.selectionStart, focusedInput.selectionEnd] : null;
    if (st.view === "importList") return renderImportList();
    if (st.view === "importToken") return renderImportToken();
    const { cls, node } = fromTpl(st.showLists ? "lists" : "tokens");
    header(node, leave(onBack));
    const tabs = node.querySelectorAll(".dSwwfw > div");
    tabs[0].className = tabs[0].className.replace(/\b(hERfOH|ghopLA)\b/, st.showLists ? "hERfOH" : "ghopLA");
    tabs[1].className = tabs[1].className.replace(/\b(hERfOH|ghopLA)\b/, st.showLists ? "ghopLA" : "hERfOH");
    node.querySelector(".dSwwfw").setAttribute("role", "tablist");
    tabs.forEach((tab, i) => {
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(st.showLists === (i === 0))); tab.tabIndex = 0;
      const select = () => { if (st.showLists === (i === 0)) return; cancelPending(); st.showLists = i === 0; st.popover = null; render(); };
      tab.addEventListener("click", select);
      tab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    });
    if (st.showLists) buildLists(node); else buildTokens(node);
    set(cls, node);
    if (st.popover) placePopover(node);
    if (focus) { const inp = node.querySelector(focus); if (inp) { inp.focus({ preventScroll: true }); inp.setSelectionRange(selection?.[0] ?? inp.value.length, selection?.[1] ?? inp.value.length); } }
  }

  // —— 列表标签 ——
  function sortedLists() {
    return listUrls().filter((u) => store.lists[u].list).sort((a, b) => {
      const A = store.lists[a], B = store.lists[b];
      if (A.active !== B.active) return A.active ? -1 : 1;
      const ca = chainTokens(A.list).length, cb = chainTokens(B.list).length; if (ca !== cb) return cb - ca;
      const na = A.list.name.toLowerCase(), nb = B.list.name.toLowerCase(); return na < nb ? -1 : na === nb ? 0 : 1;
    });
  }
  function buildLists(node) {
    const input = node.querySelector("#list-add-input"); input.value = st.listInput; input.setAttribute("value", st.listInput);
    input.placeholder = tr("https:// 或 ipfs:// 列表地址", "https:// or ipfs:// list URL");
    input.setAttribute("aria-label", tr("代币列表地址", "Token list URL"));
    input.addEventListener("input", onListInput);
    const inputCol = input.closest(".dcfqjj");
    if (st.listLoading) inputCol.append(statusText(tr("正在加载列表…", "Loading list…")));
    if (st.addError) {
      const err = fromTpl("lists_invalid").node.querySelector('.dcfqjj > div[title]').cloneNode(true);
      err.title = st.addError; err.textContent = st.addError; inputCol.append(err);
    }
    if (st.tempList) {
      const card = fromTpl("lists_url").node.querySelector('div[style="padding-top: 0px;"]').cloneNode(true);
      card.querySelector(".css-1c69u8p").textContent = st.tempList.name;
      card.querySelector(".css-n821sw").textContent = nTokens(chainTokens(st.tempList).length);
      const btn = card.querySelector("button");
      if (store.lists[canonicalSource(st.listInput)]) { // 官方：已加载
        btn.replaceWith(Object.assign(document.createElement("div"), { className: "sc-132ya8j-0 hOtbQK css-1c69u8p", textContent: tr("已加载", "Loaded") }));
      } else btn.addEventListener("click", () => { st.importList = st.tempList; st.importListUrl = canonicalSource(st.listInput); st.understood = false; st.view = "importList"; render(); });
      inputCol.after(card);
    }
    const host = node.querySelector(".iLHNFd > .dcfnNF");
    const onTpl = fromTpl("lists").node.querySelector('[id^="list-row-"]');
    const offTpl = fromTpl("lists_off").node.querySelector('[id^="list-row-"]');
    const noLogo = fromTpl("lists_two").node.querySelectorAll('[id^="list-row-"]')[1];
    host.replaceChildren(...sortedLists().map((url) => listRow(url, onTpl, offTpl, noLogo)));
  }
  function listRow(url, onTpl, offTpl, noLogo) {
    const { list, active } = store.lists[url];
    const row = (active ? onTpl : offTpl).cloneNode(true);
    row.id = rowId(url);
    const count = chainTokens(list).length;
    if (count === 0) row.style.opacity = "0.4";
    // 图标：官方 ListLogo（加载失败显示斜杠圆圈）；无 logoURI 则 24px 占位
    const logo = row.firstElementChild?.tagName.toLowerCase() === "svg" ? row.firstElementChild : null;
    if (!list.logoURI) { const ph = noLogo.firstElementChild.cloneNode(true); if (logo) logo.replaceWith(ph); else row.prepend(ph); }
    else {
      let el = logo; if (!el) { el = onTpl.firstElementChild.cloneNode(true); row.prepend(el); }
      const img = new Image(); img.onload = () => { if (!el.isConnected) return; const im = document.createElement("img"); im.src = list.logoURI; im.alt = list.name + " list logo"; im.style.cssText = "width:40px;height:40px;border-radius:40px;margin-right:1rem;"; el.replaceWith(im); }; img.src = list.logoURI;
    }
    row.querySelector(".bKIdOE, .dHnpHL").textContent = list.name;
    row.querySelector(".css-h6v0ef").textContent = nTokens(count);
    const gear = row.querySelector(".ibUkRF > button");
    gear.setAttribute("aria-label", tr(list.name + " 列表设置", list.name + " list settings"));
    gear.addEventListener("click", (e) => { e.stopPropagation(); st.popover = st.popover === url ? null : url; render(); });
    if (st.popover === url) {
      const pop = fromTpl("lists_settings").node.querySelector(".kaBXEM").cloneNode(true);
      pop.firstElementChild.textContent = versionLabel(list.version);
      const a = pop.querySelector("a"); a.href = "https://tokenlists.org/token-list?url=" + encodeURIComponent(url);
      const rm = pop.querySelector("button");
      if (url !== DEFAULT_LIST_URL) { rm.removeAttribute("disabled"); rm.className = rm.className.replace(/\bfnunGY\b/, "fnunGY"); rm.style.opacity = "1"; }
      else { rm.setAttribute("disabled", ""); rm.title = tr("内置列表可关闭，不能删除", "The built-in list can be disabled, not removed"); }
      rm.addEventListener("click", () => {
        if (url === DEFAULT_LIST_URL) return;
        if (window.prompt(tr("请输入 REMOVE 确认去除此代币列表", "Please confirm you would like to remove this list by typing REMOVE")) === "REMOVE") {
          removeListEntry(store, url, DEFAULT_LIST_URL); st.popover = null; save(); render();
        }
      });
      pop.addEventListener("click", (e) => e.stopPropagation());
      pop.dataset.popFor = url;
      gear.parentElement.append(pop);
    }
    const toggle = row.querySelector(":scope > button.kWYVHf");
    toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-label", list.name); toggle.setAttribute("aria-checked", String(active));
    row.querySelector(":scope > button.kWYVHf").addEventListener("click", () => { store.lists[url].active = !store.lists[url].active; save(); render(); });
    return row;
  }
  function placePopover(node) {
    const pop = node.querySelector(".kaBXEM"); if (!pop) return;
    const gear = pop.parentElement.querySelector("button");
    const g = gear.getBoundingClientRect(), p = pop.getBoundingClientRect();
    const right = g.right + 8, fitsRight = right + p.width <= innerWidth - 8;
    const x = Math.max(8, Math.min(fitsRight ? right : g.left - p.width - 8, innerWidth - p.width - 8));
    const y = Math.max(8, Math.min(g.top + g.height / 2 - p.height / 2, innerHeight - p.height - 8));
    pop.style.cssText = `position:fixed;inset:0px auto auto 0px;max-width:calc(100vw - 16px);transform:translate(${Math.round(x)}px,${Math.round(y)}px);`;
    pop.setAttribute("data-popper-placement", fitsRight ? "right" : "left");
    const close = e => {
      if (!ownsView()) return popCleanup();
      if (e.type === "resize" || (!pop.contains(e.target) && !gear.contains(e.target))) {
        // Keep the clicked tab/input in the DOM so its subsequent click is not swallowed.
        st.popover = null; pop.remove(); popCleanup();
      }
    };
    document.addEventListener("mousedown", close, true); window.addEventListener("resize", close);
    popCleanup = () => { document.removeEventListener("mousedown", close, true); window.removeEventListener("resize", close); };
  }
  function onListInput(e) {
    st.listInput = e.target.value; const v = st.listInput.trim();
    cancelPending(); const seq = st.seq;
    st.tempList = null; st.addError = null;
    if (v && !listSourceUrls(v).length) st.addError = tr("输入有效的代币列表源", "Enter valid list location");
    else if (v) {
      st.listLoading = true; listController = new AbortController(); const signal = listController.signal;
      listTimer = setTimeout(async () => {
        try {
          const list = await fetchList(v, signal);
          if (seq !== st.seq || !ownsView() || !st.showLists) return;
          if (!chainTokens(list).length) throw new Error("no BSC tokens");
          st.tempList = list;
        } catch (e) {
          if (seq !== st.seq || !ownsView() || !st.showLists) return;
          st.addError = e.message === "no BSC tokens" ? tr("列表中没有 BSC 代币", "No BSC tokens in this list") : tr("无法加载列表，请检查链接、列表格式或网络后重试", "Cannot load list. Check the URL, format or network and retry.");
        }
        if (seq !== st.seq || !ownsView()) return;
        st.listLoading = false; render("#list-add-input");
      }, 250);
    }
    render("#list-add-input");
  }

  // —— 代币标签 ——
  function buildTokens(node) {
    const input = node.querySelector("#token-search-input"); input.value = st.tokenInput; input.setAttribute("value", st.tokenInput);
    input.addEventListener("input", onTokenInput);
    const inputCol = input.closest(".dcfqjj");
    if (st.tokenLoading) inputCol.append(statusText(tr("正在查询代币…", "Looking up token…")));
    if (st.tokenError) { const error = fromTpl("tokens_invalid").node.querySelector(".dcfqjj > .cZxbJV").cloneNode(true); error.textContent = st.tokenError; error.setAttribute("role", "status"); inputCol.append(error); }
    else if (st.searchToken) inputCol.append(importRow(st.searchToken, () => { st.importToken = st.searchToken; st.prevView = "manage"; st.view = "importToken"; render(); }));
    const listBox = node.querySelector(".dcfqjQ");
    const head = listBox.firstElementChild;
    const customTpl = fromTpl("tokens_custom").node.querySelector(".dcfqjQ");
    const headFull = customTpl.firstElementChild, rowTpl = customTpl.children[1];
    const n = store.custom.length;
    const h = (n ? headFull : head).cloneNode(true);
    h.querySelector(".css-1yftw4").textContent = tr(n + " 自定义代币", n + " Custom Tokens");
    h.querySelector("button")?.addEventListener("click", () => { removeCustomEntry(store); st.searchToken = null; save(); render(); });
    const rows = store.custom.map((t) => {
      const r = rowTpl.cloneNode(true);
      r.querySelectorAll("a").forEach((a) => { a.href = "https://bscscan.com/address/" + t.address; });
      r.querySelector(".css-cwlnj4").textContent = t.symbol;
      accessibleAction(r.querySelector("svg.iMtbPZ"), tr("删除 ", "Remove ") + t.symbol, () => { removeCustomEntry(store, t.address); save(); render(); });
      return r;
    });
    listBox.replaceChildren(h, ...rows);
  }
  /// 官方 ImportRow：已在激活列表/自定义 → 「已激活」（列表代币显示「通过 列表名」）；否则「导入」按钮。
  function importRow(token, onImport) {
    const active = findActiveToken(token.address);
    const tplKey = active ? "tokens_active" : "tokens_import";
    const row = fromTpl(tplKey).node.querySelector(".dcfqjj > .idwsKx").cloneNode(true);
    row.querySelector(".css-1a92al5").textContent = token.symbol;
  applyTokenLogo(row.querySelector("svg, img"), token);
    const nm = row.querySelector(".jcImIV"); nm.textContent = token.name; nm.title = token.name;
    if (active) {
      const via = row.querySelector(".css-1a4pry5");
      if (active.userAdded || !active.listName) via?.parentElement.remove(); else via.textContent = tr("通过 " + active.listName, "via " + active.listName);
    } else row.querySelector("button").addEventListener("click", onImport);
    return row;
  }
  async function onTokenInput(e) {
    st.tokenInput = e.target.value.trim(); const v = st.tokenInput; const seq = ++st.seq;
    st.searchToken = null; st.tokenError = v !== "" && !isAddress(v) ? tr("请输入有效的代币合约地址", "Enter a valid token contract address") : null;
    st.tokenLoading = isAddress(v);
    render("#token-search-input");
    if (!isAddress(v)) return;
    const known = findActiveToken(v) || findAnyListToken(v);
    const token = known || await readToken(request, v).catch(() => null);
    if (seq !== st.seq || !ownsView() || st.showLists) return;
    st.tokenLoading = false;
    if (!token) st.tokenError = tr("未找到代币或网络不可用，请检查地址后重试", "Token not found or network unavailable. Check the address and retry.");
    st.searchToken = token; render("#token-search-input");
  }
  const findAnyListToken = (address) => { for (const u of listUrls()) { const t = chainTokens(store.lists[u].list).find((x) => lower(x.address) === lower(address)); if (t) return { ...t, address: checksum(t.address) }; } return null; };

  // —— 导入列表确认页 ——
  function renderImportList() {
    const { cls, node } = fromTpl(st.understood ? "import_list_ok" : "import_list");
    header(node, () => { st.view = "manage"; render(); });
    node.querySelector(".css-1rsmpqp").textContent = st.importList.name;
    node.querySelector(".css-zzrq64").textContent = nTokens(chainTokens(st.importList).length);
    const a = node.querySelector("a.fQylAf"); a.href = "https://tokenlists.org/token-list?url=" + encodeURIComponent(st.importListUrl);
    a.querySelector(".css-1ytr506").textContent = st.importListUrl;
    const box = node.querySelector("input[type=checkbox]"); box.checked = st.understood; box.setAttribute("aria-label", tr("我已知悉", "I understand"));
    box.parentElement.addEventListener("click", (e) => { if (e.target !== box) box.checked = !box.checked; st.understood = box.checked; renderImportList(); });
    const btn = node.querySelector("button");
    if (st.understood) btn.addEventListener("click", () => {
      store.lists[st.importListUrl] = { list: st.importList, active: true }; save();
      st.listInput = ""; st.tempList = null; st.addError = null; st.view = "manage"; st.showLists = true; render();
    });
    set(cls, node);
  }
  // —— 导入代币确认页 ——
  function renderImportToken() {
    const t = st.importToken; const { cls, node } = fromTpl("import_token");
    header(node, () => { st.view = st.prevView === "search" ? "search" : "manage"; if (st.view === "search") leave(onBack)(); else render(); });
    node.querySelector(".css-1ggsbpv").textContent = t.symbol;
    node.querySelector(".css-1tigqh1").textContent = t.name;
    const a = node.querySelector("a.fQylAf"); a.href = "https://bscscan.com/address/" + t.address; a.querySelector(".css-191pg17").textContent = t.address;
    node.querySelector("button.iNelXy").addEventListener("click", () => { addCustomToken(t); dispose(); onSelectToken(findActiveToken(t.address) || t); });
    set(cls, node);
  }
  if (initial === "importToken") { st.prevView = "search"; st.view = "importToken"; }
  render();
  return { render, dispose };
}

/// 选择代币视图中输入未知地址时的导入行（官方 CurrencySearch → ImportRow）。
export function searchImportRow(token, onImport) {
  const active = findActiveToken(token.address);
  const row = fromTpl(active ? "tokens_active" : "tokens_import").node.querySelector(".dcfqjj > .idwsKx").cloneNode(true);
  row.querySelector(".css-1a92al5").textContent = token.symbol;
  applyTokenLogo(row.querySelector("svg, img"), token);
  const nm = row.querySelector(".jcImIV"); nm.textContent = token.name; nm.title = token.name;
  if (!active) row.querySelector("button").addEventListener("click", onImport); else row.querySelector(".css-1a4pry5")?.parentElement.remove();
  return row;
}
export { readToken, isAddress };
