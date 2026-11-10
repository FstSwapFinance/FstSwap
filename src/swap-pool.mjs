import { formatAmountInput, limitAmountDecimals } from "./swap-amount.mjs";
// 流动池（#/pool、#/pool/v2/find）、注入流动资金（#/add/v2/A/B）、去除流动资金（#/remove/v2/A/B）——
// 界面逐节点复刻官方 fstswap.github.io（DOM 模板 swap-official-tpl.mjs + 样式 swap-official.css）；
// 链上逻辑：直接调用 FstSwap 路由器（Pancake V2 fork，同官方授权对象 0x1B6C…ABC2d），所有启用列表中的代币，按 FstSwap factory 查询所选币对。
import { SWAP_TOKENS, swapPublicRpc, loadSwapLibrary, swapFormatUnits } from "./swap-aggregator.mjs?v=mainnet-20261111-21";
import { tr, T, tpl, part, html, mountFrame, useWallet, openWalletModal, openModal, closeModal, popup, refreshNativeBalance, hashParts } from "./swap-shell.mjs?v=mainnet-20261111-21";
import { TOKENS, sigDown, tokenKeys, openTokenPicker } from "./swap-view.mjs?v=mainnet-20261111-21";

import { discoverPool, reservesByToken } from "./swap-pool-data.mjs";
import { refreshDefaultList } from "./swap-manage.mjs?v=mainnet-20261111-21";
import { tokenLogo, applyTokenLogo } from "./swap-token-logo.mjs";

const FST_ROUTER = "0x1B6C9c20693afDE803B27F8782156c0f892ABC2d";
const WBNB_FST = "0x0efb5FD2402A0967B92551d6AF54De148504A115";
const FIST = SWAP_TOKENS.fist.address;
const USDT = SWAP_TOKENS.usdt.address;
const BPS = 10000n;
const MAX_UINT = (1n << 256n) - 1n;
const SETTINGS_KEY = "swap_settings_v2";

export const POOLS = [
  { id: "fist-wbnb", keys: ["fist", "bnb"], tokenA: "FIST", tokenB: "BNB", pair: "0x796acbA6556f70A3c5756A0d8Fd0a10251c21050", token0: WBNB_FST, token1: FIST, native: true },
  { id: "fist-usdt", keys: ["fist", "usdt"], tokenA: "FIST", tokenB: "USDT", pair: "0xb4Ec801aED8C92F2E69589518AAa127afb37d8C9", token0: USDT, token1: FIST, native: false },
];
const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const ROUTER_ABI = [
  "function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)",
  "function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB,uint256 liquidity)",
  "function removeLiquidityETH(address token,uint256 liquidity,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) returns (uint256 amountToken,uint256 amountETH)",
  "function removeLiquidity(address tokenA,address tokenB,uint256 liquidity,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB)",
];

const iface = (abi) => new globalThis.ethers.Interface(abi);
const readSettings = () => { try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); return { slippageBps: 50, slippageAuto: !("slippageBps" in saved), deadlineMinutes: 30, ...saved }; } catch { return { slippageBps: 50, slippageAuto: true, deadlineMinutes: 30 }; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };
const keyFromId = (id) => {
  const v = String(id || "").toLowerCase();
  if (v === "bnb" || v === "eth") return "bnb";
  return tokenKeys().find(k => TOKENS[k].address?.toLowerCase() === v) || null;
};
const discoveredPools = new Map();
const poolKey = (a, b) => [a, b].sort().join(":");
const poolFor = (a, b) => discoveredPools.get(poolKey(a, b)) || POOLS.find(p => a && b && a !== b && p.keys.includes(a) && p.keys.includes(b)) || null;
const tokenId = k => k === "bnb" ? "BNB" : TOKENS[k].address;
const pairRoute = (action, pool) => "#/" + action + "/v2/" + pool.keys.map(tokenId).join("/");
async function resolvePool(request, a, b) {
  if (!a || !b || a === b) return null;
  const cached = poolFor(a, b);
  if (cached) return cached;
  const pool = await discoverPool(request, TOKENS[a], TOKENS[b]);
  if (pool) discoveredPools.set(poolKey(a, b), pool);
  return pool;
}
function rememberPool(pool) {
  try {
    const pairs = JSON.parse(localStorage.getItem("fstswap_imported_pairs_v1") || "[]");
    const ids = pool.keys.map(tokenId);
    const key = ids.map(x => x.toLowerCase()).sort().join(":");
    const next = pairs.filter(p => p.map(x => x.toLowerCase()).sort().join(":") !== key);
    localStorage.setItem("fstswap_imported_pairs_v1", JSON.stringify([ids, ...next].slice(0, 50)));
  } catch {}
}
async function importedPools(request) {
  try {
    const pairs = JSON.parse(localStorage.getItem("fstswap_imported_pairs_v1") || "[]");
    const loaded = await Promise.all(pairs.slice(0, 50).map(p => resolvePool(request, keyFromId(p[0]), keyFromId(p[1])).catch(() => null)));
    return [...new Map([...POOLS, ...loaded.filter(Boolean)].map(p => [p.pair.toLowerCase(), p])).values()];
  } catch { return POOLS; }
}
const addrOf = (k) => (k === "bnb" ? WBNB_FST : TOKENS[k].address);
/// 官方 Price.toSignificant(6)（ROUND_HALF_UP）。
const price6 = (num) => (!Number.isFinite(num) || num <= 0 ? "-" : String(Number(num.toPrecision(6))));
function parseAmount(value, decimals) {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value || ""))) return 0n;
  try { const r = globalThis.ethers.parseUnits(String(value), decimals); return r > 0n ? r : 0n; } catch { return 0n; }
}
function formatBalance(bal, tk) {
  if (bal === 0n) return "0";
  if (bal * 100000n < 10n ** BigInt(tk.decimals)) return "<0.00001";
  return sigDown(bal, tk.decimals, 9);
}
/// 代币图标：BNB 用官方 bnb.svg，其余为官方构建里的灰色占位图标（与官方一致）。
function logoFor(k, sample) {
  if (k !== "bnb") return tokenLogo(TOKENS[k], sample);
  const img = part("swap_quoted", "#swap-currency-input .iWJdVe > img");
  if (img && sample) { img.setAttribute("style", sample.getAttribute("style") || ""); }
  return img;
}

function chainReads(request) {
  const call = async (to, abi, method, args = []) => {
    const i = iface(abi);
    const raw = await request({ method: "eth_call", params: [{ to, data: i.encodeFunctionData(method, args) }, "latest"] });
    return i.decodeFunctionResult(method, raw);
  };
  return {
    call,
    async pool(pool) {
      const [[r0, r1], [ts]] = await Promise.all([call(pool.pair, PAIR_ABI, "getReserves"), call(pool.pair, PAIR_ABI, "totalSupply")]);
      return reservesByToken(pool, r0, r1, ts);
    },
    async balance(k, account, provider) {
      if (k === "bnb") return BigInt(await (provider ? provider.request({ method: "eth_getBalance", params: [account, "latest"] }) : request({ method: "eth_getBalance", params: [account, "latest"] })));
      return (await call(TOKENS[k].address, ERC20_ABI, "balanceOf", [account]))[0];
    },
    async allowance(token, owner, spender) { return (await call(token, ERC20_ABI, "allowance", [owner, spender]))[0]; },
  };
}

function txHelpers(wallet, request) {
  async function waitReceipt(hash) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const receipt = await request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
      if (!receipt) continue;
      if (BigInt(receipt.status) === 0n) throw new Error(tr("交易已回滚", "Transaction reverted"));
      return receipt;
    }
    throw new Error(tr("确认超时，请到浏览器查看", "Confirmation timeout"));
  }
  async function send(tx, fallbackGas = 300000n) {
    const light = swapPublicRpc(globalThis.fetch, undefined, { attempts: 2, timeoutMs: 8000 });
    const est = await light({ method: "eth_estimateGas", params: [tx] }).then((v) => BigInt(v) * 13n / 10n).catch(() => fallbackGas);
    return wallet.provider.request({ method: "eth_sendTransaction", params: [{ ...tx, gas: "0x" + est.toString(16) }] });
  }
  async function approve(token, symbol, onDone) {
    const data = iface(ERC20_ABI).encodeFunctionData("approve", [FST_ROUTER, MAX_UINT]);
    const hash = await send({ from: wallet.account, to: token, data, value: "0x0" }, 100000n);
    popup({ summary: "Approve " + symbol, hash });
    waitReceipt(hash).then(() => onDone?.(true)).catch((err) => { popup({ summary: "Approve " + symbol + ": " + (err?.message || ""), hash, success: false }); onDone?.(false); });
    return hash;
  }
  return { waitReceipt, send, approve };
}

// —— 结果弹窗（官方 TransactionConfirmationModal：等待确认 / 已提交 / 错误） ——
function pendingModal(text) {
  const overlay = tpl("pending_modal");
  overlay.querySelector(".css-hzsvkq").textContent = text;
  overlay.querySelector(".jmNfaf > svg")?.addEventListener("click", closeModal);
  openModal(overlay);
}
function submittedModal(hash) {
  const overlay = tpl("submitted_modal");
  overlay.querySelector('a[href*="/tx/"]').href = "https://bscscan.com/tx/" + hash;
  overlay.querySelector("button.gbLYuj")?.remove();
  overlay.querySelectorAll(".jmNfaf > svg, button.dwqBbh").forEach((el) => el.addEventListener("click", closeModal));
  openModal(overlay);
  setTimeout(() => { if (overlay.isConnected) closeModal(); }, 1200);
}
function errorModal(message) {
  const overlay = tpl("submitted_modal");
  const body = overlay.querySelector(".kkrlOG"); const iconBox = overlay.querySelector(".jXsGAI");
  iconBox.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#FD4040" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke-width:1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  const title = body.querySelector(".css-1p6fq9y"); title.textContent = message; title.style.color = "#FD4040"; title.style.fontSize = "16px"; title.style.textAlign = "center"; title.style.width = "85%";
  body.querySelector("a")?.remove(); body.querySelector("button.gbLYuj")?.remove();
  const close = body.querySelector("button.dwqBbh"); if (close) close.querySelector("div").textContent = tr("关闭", "Dismiss");
  overlay.querySelectorAll(".jmNfaf > svg, button.dwqBbh").forEach((el) => el.addEventListener("click", closeModal));
  openModal(overlay);
}
const isReject = (err) => err?.code === 4001 || /reject|denied/i.test(err?.message || "");

// —— 设置齿轮（官方 SettingsTab：注入/去除页同样可调滑点和期限） ——
function bindSettings(main) {
  const wrap = main.querySelector(".eWRqBu"); if (!wrap) return;
  const settings = readSettings(); let open = false; let custom = "";
  const draw = () => {
    const fresh = part(open ? "swap_settings" : "swap_empty", ".eWRqBu");
    fresh.querySelector("#open-settings-dialog-button").addEventListener("click", (e) => { e.stopPropagation(); open = !open; draw(); });
    const fly = fresh.querySelector(".llqzho");
    if (fly) {
      fly.addEventListener("click", (e) => e.stopPropagation());
      const groups = fly.querySelectorAll(".bPPnFe");
      const presets = [10, 20, 50, 100];
      const slipBtns = groups[0].querySelectorAll(".jmNfaf")[0].querySelectorAll("button");
      slipBtns.forEach((b, i) => {
        b.className = b.className.replace(/\b(fpFSKc|jLxtdz)\b/, !settings.slippageAuto && settings.slippageBps === presets[i] ? "jLxtdz" : "fpFSKc");
        b.addEventListener("click", () => { settings.slippageBps = presets[i]; settings.slippageAuto = false; custom = ""; saveSettings(settings); draw(); });
      });
      const si = groups[0].querySelector("input"); const opt = si.closest("button, .hQBzuZ, .lagkxn");
      if (opt) opt.className = opt.className.replace(/\b(hQBzuZ|lagkxn)\b/, settings.slippageAuto ? "hQBzuZ" : "lagkxn");
      si.value = custom || (settings.slippageAuto ? "" : (settings.slippageBps / 100).toFixed(2)); si.setAttribute("placeholder", (settings.slippageBps / 100).toFixed(2));
      si.addEventListener("input", () => {
        custom = si.value;
        if (si.value === "") { settings.slippageAuto = true; settings.slippageBps = 50; saveSettings(settings); return; }
        const v = Math.floor(Number(si.value) * 100);
        if (Number.isSafeInteger(v) && v >= 0 && v <= 5000) { settings.slippageBps = v; settings.slippageAuto = false; saveSettings(settings);
          slipBtns.forEach((b, i) => { b.className = b.className.replace(/\b(fpFSKc|jLxtdz)\b/, v === presets[i] ? "jLxtdz" : "fpFSKc"); });
          if (opt) opt.className = opt.className.replace(/\b(hQBzuZ|lagkxn)\b/, "lagkxn"); }
      });
      si.addEventListener("blur", () => { custom = ""; });
      const dls = [10, 20, 30];
      groups[1].querySelectorAll(".jmNfaf")[0].querySelectorAll("button").forEach((b, i) => {
        b.className = b.className.replace(/\b(fpFSKc|jLxtdz)\b/, settings.deadlineMinutes === dls[i] ? "jLxtdz" : "fpFSKc");
        b.addEventListener("click", () => { settings.deadlineMinutes = dls[i]; saveSettings(settings); draw(); });
      });
      const di = groups[1].querySelector("input"); di.setAttribute("placeholder", String(settings.deadlineMinutes));
      di.addEventListener("input", () => { const v = Number(di.value); if (Number.isSafeInteger(v) && v >= 1 && v <= 180) { settings.deadlineMinutes = v; saveSettings(settings); } });
      fly.querySelectorAll("#toggle-expert-mode-button, #toggle-disable-multihop-button").forEach((t) => {
        const key = t.id === "toggle-expert-mode-button" ? "expert" : "singleHop"; const [on, off] = t.querySelectorAll("span");
        on.className = on.className.replace(/\b(iRRrwD|ksfRJa)\b/, settings[key] ? "ksfRJa" : "iRRrwD");
        off.className = off.className.replace(/\b(iRRrwD|ksfRJa)\b/, settings[key] ? "iRRrwD" : "ksfRJa");
        t.addEventListener("click", () => { settings[key] = !settings[key]; saveSettings(settings); draw(); });
      });
    }
    wrap.replaceChildren(...fresh.childNodes);
  };
  draw();
  document.addEventListener("click", () => { if (open && main.isConnected) { open = false; draw(); } });
  return settings;
}

// —— 代币选择弹窗（官方 CurrencySearchModal，用于注入页 / 导入流动池） ——
function connectButton() {
  const btns = tpl("swap_empty").querySelectorAll("#swap-page button");
  const b = btns[btns.length - 1].cloneNode(true);
  b.addEventListener("click", () => openWalletModal());
  return b;
}

export async function mountPoolPage(root, route) {
  try { await loadSwapLibrary(); } catch {}
  const request = swapPublicRpc();
  const mountedHash = location.hash, parts = hashParts();
  if ([parts[2], parts[3]].some(id => /^0x/i.test(id || "") && !keyFromId(id))) await refreshDefaultList().catch(() => {});
  if (location.hash !== mountedHash) return;
  if (route === "add") return mountAdd(root, request, parts);
  if (route === "remove") return mountRemove(root, request, parts);
  if (parts[1] === "v2" && parts[2] === "find") return mountFind(root, request);
  return mountPoolList(root, request);
}

// —— 流动池列表（官方 pages/Pool/v2.tsx） ——
async function mountPoolList(root, request) {
  const wallet = useWallet();
  const main = tpl("pool");
  mountFrame(root, "pool", main);
  const reads = chainReads(request);
  const holder = main.querySelector(".bWHOHv");
  const msg = holder.querySelector(".css-1mkknq7");
  const proto = holder.cloneNode(true);
  let visible = holder, drawSeq = 0;
  async function draw() {
    const seq = ++drawSeq, account = wallet.account;
    if (!main.isConnected) return;
    if (visible !== holder) { visible.replaceWith(holder); visible = holder; }
    if (!account) { msg.textContent = tr("连接钱包以查看您的流动资金。", "Connect to a wallet to view your liquidity."); return; }
    msg.textContent = T("未找到流动资金。");
    const rows = await Promise.all((await importedPools(request)).map(async (pool) => {
      try {
        const [pr, [lp]] = await Promise.all([reads.pool(pool), reads.call(pool.pair, PAIR_ABI, "balanceOf", [account])]);
        return lp > 0n && pr.totalSupply > 0n ? { pool, pr, lp } : null;
      } catch { return null; }
    }));
    const held = rows.filter(Boolean);
    if (!held.length || !main.isConnected || seq !== drawSeq || account !== wallet.account) return;
    // 有持仓：沿用官方卡片容器，按 FullPositionCard 内容列出（币对 / 份额 / 去除入口）
    const list = html('<div class="sc-16waliw-2 dcfnNF" style="width: 100%;"></div>');
    held.forEach(({ pool, pr, lp }) => {
      const card = proto.cloneNode(true);
      const [first, other] = pool.keys;
      const firstAmt = lp * pr.reserves[addrOf(first).toLowerCase()] / pr.totalSupply, otherAmt = lp * pr.reserves[addrOf(other).toLowerCase()] / pr.totalSupply;
      const share = Number(lp) / Number(pr.totalSupply) * 100;
      const body = card.querySelector(".css-1mkknq7");
      body.style.textAlign = "left";
      body.innerHTML = "";
      const line = (k, v) => { const d = document.createElement("div"); d.style.cssText = "display:flex;justify-content:space-between;margin:4px 0"; d.append(k, Object.assign(document.createElement("span"), { textContent: v })); return d; };
      const title = document.createElement("div"); title.style.cssText = "font-weight:500;font-size:20px;color:#fff;margin-bottom:8px"; title.textContent = TOKENS[other].symbol + "/" + TOKENS[first].symbol;
      body.append(title,
        line(tr("您的总流动池代币：", "Your total pool tokens:"), sigDown(lp, 18, 4)),
        line(tr("已入金 ", "Pooled ") + TOKENS[other].symbol + "：", sigDown(otherAmt, TOKENS[other].decimals, 6)),
        line(tr("已入金 ", "Pooled ") + TOKENS[first].symbol + "：", sigDown(firstAmt, TOKENS[first].decimals, 6)),
        line(tr("您的资金池份额：", "Your pool share:"), (share < 0.01 ? "<0.01" : share.toFixed(2)) + "%"));
      const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px;margin-top:12px";
      const mk = (text, href) => { const a = main.querySelector("a.egNOzd").cloneNode(true); a.textContent = text; a.href = href; a.style.flex = "1"; return a; };
      actions.append(mk(tr("增加", "Add"), pairRoute("add", pool)), mk(tr("去除", "Remove"), pairRoute("remove", pool)));
      body.append(actions);
      list.append(card);
    });
    holder.replaceWith(list); visible = list;
  }
  wallet.subscribe(() => { draw(); });
  draw();
}

// —— 导入流动池（官方 PoolFinder） ——
async function mountFind(root, request) {
  const wallet = useWallet();
  const main = tpl("pool_find");
  mountFrame(root, "pool", main);
  const reads = chainReads(request);
  const sel = { a: "bnb", b: null };
  const [btnA, btnB] = main.querySelectorAll("button.gOauOq");
  const protoSelected = btnA.cloneNode(true), protoEmpty = btnB.cloneNode(true);
  const status = main.querySelector(".exvWjX:last-child .css-1lx7oj");
  let checkSeq = 0;
  async function check() {
    const seq = ++checkSeq, account = wallet.account;
    const current = () => seq === checkSeq && main.isConnected && account === wallet.account;
    if (!sel.a || !sel.b) { status.textContent = T("选择代币以查找您的 v2 流动资金。"); return; }
    status.textContent = tr("正在加载…", "Loading…");
    try {
      const pool = await resolvePool(request, sel.a, sel.b);
      if (!current()) return;
      if (!pool) { status.textContent = tr("未找到流动池。", "No pool found."); return; }
      if (!account) { status.textContent = tr("连接钱包以查找流动池。", "Connect to a wallet to find pools"); return; }
      const [lp] = await reads.call(pool.pair, PAIR_ABI, "balanceOf", [account]);
      if (!current()) return;
      if (lp > 0n) rememberPool(pool);
      status.textContent = lp > 0n ? tr("已找到流动池！已导入。", "Pool Found! Imported.") : tr("您在此流动池中还没有流动资金。", "You don’t have liquidity in this pool yet.");
      const link = document.createElement("a"); link.href = pairRoute("add", pool); link.textContent = tr(" 增加流动资金", " Add liquidity"); status.append(link);
    } catch { if (current()) status.textContent = tr("读取失败", "Read failed"); }
  }
  function draw() {
    const live = main.querySelectorAll("button.gOauOq");
    [["a", live[0]], ["b", live[1]]].forEach(([field, el]) => {
      const k = sel[field], o = field === "a" ? "b" : "a";
      const fresh = (k ? protoSelected : protoEmpty).cloneNode(true);
      if (k) {
        const logo = fresh.querySelector("img");
        if (logo && k !== "bnb") logo.replaceWith(part("swap_quoted", "#swap-currency-output .iWJdVe > svg"));
        applyTokenLogo(fresh.querySelector("svg, img"), TOKENS[k]);
        const sym = fresh.querySelector(".css-6dfm9t"); if (sym) sym.textContent = TOKENS[k].symbol;
      }
      fresh.addEventListener("click", () => openTokenPicker({ selected: k, other: sel[o], onPick: (nk) => { if (sel[o] === nk) sel[o] = k; sel[field] = nk; draw(); } }));
      el.replaceWith(fresh);
    });
    check();
  }
  void btnA; void btnB;
  draw();
  wallet.subscribe(() => { if (main.isConnected) check(); });
}

// —— 注入流动资金（官方 pages/AddLiquidityV2） ——
async function mountAdd(root, request, parts) {
  const wallet = useWallet();
  const reads = chainReads(request);
  const tx = txHelpers(wallet, request);
  const st = {
    a: keyFromId(parts[2]) || (parts[2] ? null : null), b: keyFromId(parts[3]),
    field: "a", typed: "", pr: null, pool: null, poolLoading: true, poolError: false, balances: {}, allowance: {}, approving: {},
  };
  const main = tpl("add");
  mountFrame(root, "pool", main);
  const settings = bindSettings(main);
  const $ = (s) => main.querySelector(s);
  const col = $(".dbEdQm > .dcfoEc");
  const protoPanel = $("#add-liquidity-input-tokena").cloneNode(true);
  const protoPrices = $(".gplWWU").cloneNode(true);
  const protoBottomEmpty = col.lastElementChild.cloneNode(true);
  const protoBottomApprove = part("add_amount", ".dbEdQm > .dcfoEc > .dcfnNF:last-child");
  const pool = () => st.pool;
  const reserve = (k) => st.pr?.reserves[addrOf(k).toLowerCase()] ?? 0n;

  const parsed = () => {
    const ka = st.a, kb = st.b; const out = { a: 0n, b: 0n };
    if (!ka || !kb) return out;
    const indep = st.field, dep = indep === "a" ? "b" : "a";
    const ki = st[indep], kd = st[dep];
    out[indep] = parseAmount(st.typed, TOKENS[ki].decimals);
    if (out[indep] > 0n && st.pr && reserve(ki) > 0n) out[dep] = out[indep] * reserve(kd) / reserve(ki);
    return out;
  };

  function panelEl(field) {
    const k = st[field];
    const el = protoPanel.cloneNode(true);
    el.id = field === "a" ? "add-liquidity-input-tokena" : "add-liquidity-input-tokenb";
    const btn = el.querySelector(".open-currency-select-button");
    const sym = btn.querySelector(".token-symbol-container");
    const logo = btn.querySelector(".iWJdVe > svg");
    if (k) {
      sym.textContent = TOKENS[k].symbol;
      const img = logoFor(k, logo); if (img && logo) logo.replaceWith(img);
    } else {
      const empty = part("swap_empty", "#swap-currency-input .open-currency-select-button");
      btn.replaceWith(empty);
    }
    const target = el.querySelector(".open-currency-select-button");
    target.addEventListener("click", () => openTokenPicker({ selected: k, other: st[field === "a" ? "b" : "a"], balances: st.balances, onPick: (nk) => {
      const o = field === "a" ? "b" : "a"; if (st[o] === nk) st[o] = k; st[field] = nk;
      const id = (x) => (x ? (x === "bnb" ? "BNB" : TOKENS[x].address) : "");
      location.hash = "#/add/v2/" + [id(st.a), id(st.b)].filter(Boolean).join("/");
    } }));
    const input = el.querySelector("input.token-amount-input");
    const p = parsed();
    const v = st.field === field ? st.typed : (p[field] > 0n ? formatAmountInput(p[field], TOKENS[k].decimals) : "");
    input.value = limitAmountDecimals(v); input.setAttribute("value", input.value);
    input.addEventListener("input", () => {
      const raw = limitAmountDecimals(input.value.replace(/,/g, "."));
      if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) { input.value = st.field === field ? st.typed : ""; return; }
      st.field = field; st.typed = raw; render(field);
    });
    const left = el.querySelector(".fNKPVt .jmNfaf > .iWJdVe");
    if (!wallet.account || !k) left.replaceWith(document.createElement("span"));
    else {
      const bal = st.balances[k];
      const text = left.querySelector(".css-djrxae");
      text.textContent = bal == null ? "" : tr("余额：", "Balance: ") + formatBalance(bal, TOKENS[k]) + " " + TOKENS[k].symbol;
      const max = left.querySelector("button.cfnxzr");
      const setMax = () => { if (!bal) return; const m = k === "bnb" ? (bal > 10n ** 16n ? bal - 10n ** 16n : 0n) : bal; st.field = field; st.typed = swapFormatUnits(m, TOKENS[k].decimals); render(); };
      if (!bal || bal === 0n || (st.field === field && parseAmount(st.typed, TOKENS[k].decimals) === bal)) max.remove(); else max.addEventListener("click", setMax);
      text.addEventListener("click", setMax);
    }
    return el;
  }

  function pricesEl(p) {
    const box = protoPrices.cloneNode(true);
    const cells = box.querySelectorAll(".dmuRTh");
    const ra = reserve(st.a), rb = reserve(st.b);
    const num = (r, k) => Number(swapFormatUnits(r, TOKENS[k].decimals));
    const pAB = ra > 0n ? num(rb, st.b) / num(ra, st.a) : 0;
    cells[0].querySelector(".css-1kt4f20").textContent = price6(pAB);
    cells[0].querySelector(".css-1ayx7yo").textContent = tr(TOKENS[st.b].symbol + " 每 " + TOKENS[st.a].symbol, TOKENS[st.b].symbol + " per " + TOKENS[st.a].symbol);
    cells[1].querySelector(".css-1kt4f20").textContent = price6(pAB ? 1 / pAB : 0);
    cells[1].querySelector(".css-1ayx7yo").textContent = tr(TOKENS[st.a].symbol + " 每 " + TOKENS[st.b].symbol, TOKENS[st.a].symbol + " per " + TOKENS[st.b].symbol);
    let share = "0";
    if (p.a > 0n && p.b > 0n && st.pr && st.pr.totalSupply > 0n) {
      const la = p.a * st.pr.totalSupply / ra, lb = p.b * st.pr.totalSupply / rb; const minted = la < lb ? la : lb;
      const pct = Number(minted) / Number(st.pr.totalSupply + minted) * 100;
      share = pct < 0.01 ? "<0.01" : pct.toFixed(2);
    }
    cells[2].querySelector(".css-1kt4f20").textContent = share + "%";
    return box;
  }

  function bottomEl(p) {
    if (!wallet.account) { const wrap = protoBottomEmpty.cloneNode(true); wrap.replaceChildren(connectButton()); return wrap; }
    const wrap = protoBottomEmpty.cloneNode(true); const btn = wrap.querySelector("button"); const label = btn.querySelector("div");
    if (!st.a || !st.b) { label.textContent = T("无效币对"); return wrap; }
    if (st.poolLoading) { label.textContent = tr("正在加载流动池…", "Loading pool…"); return wrap; }
    if (!st.pr) { label.textContent = st.poolError ? tr("流动池读取失败，请刷新重试", "Could not load pool. Refresh to retry.") : tr("未找到流动池", "No pool found"); return wrap; }
    if (!(p.a > 0n) || !(p.b > 0n)) { label.textContent = T("输入数额"); return wrap; }
    for (const f of ["a", "b"]) {
      const k = st[f]; const bal = st.balances[k];
      if (bal != null && bal < p[f]) { label.textContent = tr(TOKENS[k].symbol + " 余额不足", "Insufficient " + TOKENS[k].symbol + " balance"); return wrap; }
    }
    const needs = ["a", "b"].filter((f) => st[f] !== "bnb" && (st.allowance[st[f]] == null || st.allowance[st[f]] < p[f]));
    const out = protoBottomApprove.cloneNode(true);
    const row = out.firstElementChild; const supply = out.querySelector("button.bhVlig");
    const tplBtn = row.querySelector("button").cloneNode(true);
    if (needs.length) {
      row.replaceChildren(...needs.map((f) => {
        const k = st[f]; const b = tplBtn.cloneNode(true);
        if (needs.length === 1) b.style.width = "100%";
        if (st.approving[k]) { b.disabled = true; b.textContent = tr("批准中 ", "Approving ") + TOKENS[k].symbol; }
        else { b.textContent = tr("批准 ", "Approve ") + TOKENS[k].symbol; b.addEventListener("click", () => approveToken(k)); }
        return b;
      }));
      supply.disabled = true;
    } else {
      row.remove(); supply.disabled = false;
      supply.addEventListener("click", () => supplyLiquidity(p));
    }
    return out;
  }

  function render(focusField) {
    const p = parsed();
    const panels = col.querySelectorAll(".jnrqxZ");
    const na = panelEl("a"), nb = panelEl("b");
    panels[0].replaceWith(na); panels[1].replaceWith(nb);
    const pricesSlot = col.querySelector(".gplWWU");
    if (st.a && st.b && pool() && st.pr) { const n = pricesEl(p); if (pricesSlot) pricesSlot.replaceWith(n); else col.lastElementChild.before(n); }
    else pricesSlot?.remove();
    col.lastElementChild.replaceWith(bottomEl(p));
    if (focusField) { const inp = (focusField === "a" ? na : nb).querySelector("input"); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }

  async function loadPool() {
    st.poolLoading = true; st.poolError = false;
    try { st.pool = await resolvePool(request, st.a, st.b); st.pr = st.pool ? await reads.pool(st.pool) : null; }
    catch { st.pr = null; st.poolError = true; }
    finally { st.poolLoading = false; }
  }
  let accountSeq = 0, loadedAccount;
  async function loadAccount() {
    const account = wallet.account, seq = ++accountSeq;
    if (account !== loadedAccount) { st.balances = {}; st.allowance = {}; st.approving = {}; loadedAccount = account; }
    if (!account) return;
    const keys = [...new Set([st.a, st.b].filter(Boolean))];
    await Promise.all(keys.map(async k => {
      const [bal, allowance] = await Promise.all([reads.balance(k, account, wallet.provider).catch(() => null), k === "bnb" ? null : reads.allowance(TOKENS[k].address, account, FST_ROUTER).catch(() => null)]);
      if (seq !== accountSeq || account !== wallet.account) return;
      st.balances[k] = bal; st.allowance[k] = allowance;
    }));
  }
  async function approveToken(k) {
    const account = wallet.account;
    const job = { account }; st.approving[k] = job; render();
    try {
      await tx.approve(TOKENS[k].address, TOKENS[k].symbol, async (ok) => {
        if (st.approving[k] !== job || wallet.account !== account) return;
        const actual = ok ? await reads.allowance(TOKENS[k].address, account, FST_ROUTER).catch(() => null) : null;
        if (st.approving[k] !== job || wallet.account !== account) return;
        st.approving[k] = false;
        st.allowance[k] = actual;
        if (main.isConnected) render();
      });
    } catch (err) {
      if (st.approving[k] !== job || wallet.account !== account) return;
      st.approving[k] = false; if (main.isConnected) render();
      if (!isReject(err)) popup({ summary: err?.message || tr("授权失败", "Approval failed"), success: false });
    }
  }
  async function supplyLiquidity(p) {
    const pl = pool(); if (!pl) return;
    const sa = TOKENS[st.a].symbol, sb = TOKENS[st.b].symbol;
    const ta = sigDown(p.a, TOKENS[st.a].decimals, 6), tb = sigDown(p.b, TOKENS[st.b].decimals, 6);
    pendingModal(tr("正在供应 " + ta + " " + sa + " 和 " + tb + " " + sb, "Supplying " + ta + " " + sa + " and " + tb + " " + sb));
    const s = readSettings(); const slip = BigInt(s.slippageBps);
    const min = (x) => x * (BPS - slip) / BPS;
    const deadline = Math.floor(Date.now() / 1000) + s.deadlineMinutes * 60;
    try {
      let txReq;
      if (st.a === "bnb" || st.b === "bnb") {
        const tokenKey = st.a === "bnb" ? st.b : st.a; const tokenAmt = st.a === "bnb" ? p.b : p.a; const ethAmt = st.a === "bnb" ? p.a : p.b;
        txReq = { from: wallet.account, to: FST_ROUTER, value: "0x" + ethAmt.toString(16), data: iface(ROUTER_ABI).encodeFunctionData("addLiquidityETH", [TOKENS[tokenKey].address, tokenAmt, min(tokenAmt), min(ethAmt), wallet.account, deadline]) };
      } else {
        txReq = { from: wallet.account, to: FST_ROUTER, value: "0x0", data: iface(ROUTER_ABI).encodeFunctionData("addLiquidity", [TOKENS[st.a].address, TOKENS[st.b].address, p.a, p.b, min(p.a), min(p.b), wallet.account, deadline]) };
      }
      const hash = await tx.send(txReq, 400000n);
      const summary = "Add " + sigDown(p.a, TOKENS[st.a].decimals, 3) + " " + sa + " and " + sigDown(p.b, TOKENS[st.b].decimals, 3) + " " + sb;
      submittedModal(hash); popup({ summary, hash });
      st.typed = ""; render();
      tx.waitReceipt(hash).then(async () => { rememberPool(pl); await Promise.all([loadPool(), loadAccount()]); refreshNativeBalance(); if (main.isConnected) render(); })
        .catch((err) => popup({ summary: summary + " — " + (err?.message || ""), hash, success: false }));
    } catch (err) {
      errorModal(isReject(err) ? T("交易被拒绝。") : (err?.message || tr("交易失败", "Transaction failed")));
    }
  }
  void settings;
  render();
  await loadPool(); if (main.isConnected) render();
  wallet.subscribe(async () => { if (!main.isConnected) return; await loadAccount(); if (main.isConnected) render(); });
  if (wallet.account) { await loadAccount(); if (main.isConnected) render(); }
}

// —— 去除流动资金（官方 pages/RemoveLiquidity：简单模式 滑杆 + 25/50/75/Max） ——
async function mountRemove(root, request, parts) {
  const wallet = useWallet();
  const reads = chainReads(request);
  const tx = txHelpers(wallet, request);
  const st = { a: parts[2] ? keyFromId(parts[2]) : "usdt", b: parts[3] ? keyFromId(parts[3]) : "fist", pct: 0, pr: null, lp: 0n, allowance: null, approving: false };
  const main = tpl("remove");
  mountFrame(root, "pool", main);
  bindSettings(main);
  const $ = (s) => main.querySelector(s);
  if (!st.a || !st.b || st.a === st.b) { errorModal(T("无效币对")); return; }
  let pool;
  try { pool = await resolvePool(request, st.a, st.b); }
  catch { if (main.isConnected) errorModal(tr("流动池读取失败，请刷新重试", "Could not load pool. Refresh to retry.")); return; }
  if (!main.isConnected) return;
  if (!pool) { errorModal(tr("未找到流动池", "No pool found")); return; }
  const btnRow = main.querySelector('div[style="position: relative;"] > .jmNfaf');
  const proto = { approveIdle: btnRow.children[0].cloneNode(true), main: btnRow.children[1].cloneNode(true) };
  const r50 = tpl("remove_50").querySelector('div[style="position: relative;"] > .jmNfaf');
  proto.approved = r50.children[0].cloneNode(true); proto.mainOn = r50.children[1].cloneNode(true);
  const slider = $("input.dDFCFi");
  const pctText = $(".css-1dy6e9l");
  const amountRows = main.querySelectorAll(".exvWjX .dcfoDv > .jmNfaf");
  const rateBox = main.querySelector('div[style="padding: 10px 20px;"]');

  // 代币符号 / 图标
  [[st.a, "#remove-liquidity-tokena-symbol"], [st.b, "#remove-liquidity-tokenb-symbol"]].forEach(([k, sel]) => {
    const symEl = $(sel); symEl.textContent = TOKENS[k].symbol;
    const logo = symEl.previousElementSibling; const img = logoFor(k, logo); if (img && logo) logo.replaceWith(img);
  });
  const reserve = (k) => st.pr?.reserves[addrOf(k).toLowerCase()] ?? 0n;
  const amounts = () => {
    if (!st.pr || st.pr.totalSupply === 0n) return null;
    const liq = st.lp * BigInt(st.pct) / 100n;
    return { liq, a: liq * reserve(st.a) / st.pr.totalSupply, b: liq * reserve(st.b) / st.pr.totalSupply };
  };
  function render() {
    slider.value = String(st.pct); slider.setAttribute("value", String(st.pct));
    pctText.textContent = st.pct + "%";
    const am = amounts();
    const show = (row, k, v) => { row.firstElementChild.textContent = st.pct === 0 || v == null ? "-" : sigDown(v, TOKENS[k].decimals, 6); };
    show(amountRows[0], st.a, am?.a); show(amountRows[1], st.b, am?.b);
    // 兑换率
    const rows = rateBox.children;
    if (st.pr && reserve(st.a) > 0n) {
      const num = (r, k) => Number(swapFormatUnits(r, TOKENS[k].decimals));
      const pAB = num(reserve(st.b), st.b) / num(reserve(st.a), st.a);
      rows[0].lastElementChild.textContent = "1 " + TOKENS[st.a].symbol + " = " + price6(pAB) + " " + TOKENS[st.b].symbol;
      rows[1].lastElementChild.textContent = "1 " + TOKENS[st.b].symbol + " = " + price6(1 / pAB) + " " + TOKENS[st.a].symbol;
      rateBox.style.display = "";
    } else rateBox.style.display = "none";
    // 按钮
    const holder = main.querySelector('div[style="position: relative;"]');
    if (!wallet.account) { holder.replaceChildren(connectButton()); return; }
    const row = html('<div class="sc-bdnxRM sc-1ep0hjq-0 sc-1ep0hjq-1 fzUdiI hlBXoz jmNfaf"></div>');
    let approveBtn, mainBtn;
    const liq = am?.liq ?? 0n;
    const approved = liq > 0n && st.allowance != null && st.allowance >= liq;
    if (st.pct === 0) approveBtn = proto.approveIdle.cloneNode(true);
    else if (approved) approveBtn = proto.approved.cloneNode(true);
    else {
      approveBtn = proto.approveIdle.cloneNode(true); approveBtn.disabled = Boolean(st.approving) || liq === 0n;
      approveBtn.textContent = st.approving ? tr("批准中", "Approving") : T("批准");
      approveBtn.addEventListener("click", approveLp);
    }
    if (st.pct === 0) mainBtn = proto.main.cloneNode(true);
    else { mainBtn = proto.mainOn.cloneNode(true); mainBtn.disabled = !approved; if (approved) mainBtn.addEventListener("click", removeLp); }
    row.append(approveBtn, mainBtn); holder.replaceChildren(row);
  }
  const setPct = (v) => { st.pct = Math.max(0, Math.min(100, Math.round(v))); render(); };
  slider.addEventListener("input", () => setPct(Number(slider.value)));
  main.querySelectorAll("button.GhknT").forEach((b, i) => b.addEventListener("click", () => setPct([25, 50, 75, 100][i])));

  let loadSeq = 0, loadedAccount;
  async function load() {
    const account = wallet.account, seq = ++loadSeq;
    if (account !== loadedAccount) { st.lp = 0n; st.allowance = null; st.approving = false; loadedAccount = account; }
    const pr = await reads.pool(pool).catch(() => null);
    if (seq !== loadSeq || account !== wallet.account) return;
    st.pr = pr;
    if (account) {
      const [[lp], [al]] = await Promise.all([
        reads.call(pool.pair, PAIR_ABI, "balanceOf", [account]).catch(() => [0n]),
        reads.call(pool.pair, PAIR_ABI, "allowance", [account, FST_ROUTER]).catch(() => [null]),
      ]);
      if (seq !== loadSeq || account !== wallet.account) return;
      st.lp = lp ?? 0n; st.allowance = al;
    }
  }
  async function approveLp() {
    const account = wallet.account;
    const job = { account }; st.approving = job; render();
    try {
      await tx.approve(pool.pair, "FST-LP", async (ok) => {
        if (st.approving !== job || wallet.account !== account) return;
        const actual = ok ? await reads.allowance(pool.pair, account, FST_ROUTER).catch(() => null) : null;
        if (st.approving !== job || wallet.account !== account) return;
        st.approving = false;
        st.allowance = actual;
        if (main.isConnected) render();
      });
    } catch (err) { if (st.approving !== job || wallet.account !== account) return; st.approving = false; if (main.isConnected) render(); if (!isReject(err)) popup({ summary: err?.message || tr("授权失败", "Approval failed"), success: false }); }
  }
  async function removeLp() {
    const am = amounts(); if (!am || am.liq === 0n) { errorModal(tr("您在此流动池中没有可去除的流动资金。", "You have no liquidity to remove in this pool.")); return; }
    const sa = TOKENS[st.a].symbol, sb = TOKENS[st.b].symbol;
    const ta = sigDown(am.a, TOKENS[st.a].decimals, 6), tb = sigDown(am.b, TOKENS[st.b].decimals, 6);
    pendingModal(tr("正在去除 " + ta + " " + sa + " 和 " + tb + " " + sb, "Removing " + ta + " " + sa + " and " + tb + " " + sb));
    const s = readSettings(); const slip = BigInt(s.slippageBps); const min = (x) => x * (BPS - slip) / BPS;
    const deadline = Math.floor(Date.now() / 1000) + s.deadlineMinutes * 60;
    try {
      let data;
      if (pool.native) {
        const tokAmt = st.a === "bnb" ? am.b : am.a, ethAmt = st.a === "bnb" ? am.a : am.b;
        data = iface(ROUTER_ABI).encodeFunctionData("removeLiquidityETH", [TOKENS[st.a === "bnb" ? st.b : st.a].address, am.liq, min(tokAmt), min(ethAmt), wallet.account, deadline]);
      } else {
        data = iface(ROUTER_ABI).encodeFunctionData("removeLiquidity", [TOKENS[st.a].address, TOKENS[st.b].address, am.liq, min(am.a), min(am.b), wallet.account, deadline]);
      }
      const hash = await tx.send({ from: wallet.account, to: FST_ROUTER, data, value: "0x0" }, 400000n);
      const summary = "Remove " + sigDown(am.a, TOKENS[st.a].decimals, 3) + " " + sa + " and " + sigDown(am.b, TOKENS[st.b].decimals, 3) + " " + sb;
      submittedModal(hash); popup({ summary, hash });
      st.pct = 0; render();
      tx.waitReceipt(hash).then(async () => { await load(); refreshNativeBalance(); if (main.isConnected) render(); })
        .catch((err) => popup({ summary: summary + " — " + (err?.message || ""), hash, success: false }));
    } catch (err) {
      errorModal(isReject(err) ? T("交易被拒绝。") : (err?.message || tr("交易失败", "Transaction failed")));
    }
  }
  render();
  await load(); if (main.isConnected) render();
  wallet.subscribe(async () => { if (!main.isConnected) return; await load(); if (main.isConnected) render(); });
}
