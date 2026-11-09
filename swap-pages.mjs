// 首页 / 币对分析（#/analysis/A/B，官方 pages/PoolAnalysis）与 我的（#/my，官方 pages/My）——
// 界面逐节点复刻官方 DOM 模板；K 线使用官方同版本 TradingView Lightweight Charts v3.8.0（取自官方构建），
// 数据：链上储备/余额/LP（RPC 池）+ GeckoTerminal OHLCV / 成交（官方 /api/Fst/* 接口在静态站点不可用）。
import { SWAP_TOKENS, swapPublicRpc, loadSwapLibrary, swapFormatUnits } from "./swap-aggregator.mjs?v=mainnet-20261110-8";
import { tr, T, tpl, part, html, mountFrame, useWallet, popup, getLanguage, hashParts, DEFAULT_ANALYSIS } from "./swap-shell.mjs?v=mainnet-20261110-8";
import { POOLS } from "./swap-pool.mjs?v=mainnet-20261110-8";
import { marketData } from "./swap-market-data.mjs?v=review-20261110-3";
import { getTheme, setTheme, SOCIAL_LINKS } from "./swap-ui.mjs?v=review-20261110-3";

import { findActiveToken, refreshDefaultList } from "./swap-manage.mjs?v=mainnet-20261110-8";
import { applyTokenLogo } from "./swap-token-logo.mjs";

const FIST = SWAP_TOKENS.fist.address;
const USDT = SWAP_TOKENS.usdt.address;
const WBNB_FST = "0x0efb5FD2402A0967B92551d6AF54De148504A115";
const HISTORY_KEY = "swap_history_v1";
const PAIR_ABI = ["function getReserves() view returns (uint112,uint112,uint32)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
const ERC20 = ["function balanceOf(address) view returns (uint256)"];
const META = {
  [USDT.toLowerCase()]: { symbol: "USDT", decimals: 18, address: USDT },
  [FIST.toLowerCase()]: { symbol: "FIST", decimals: 6, address: FIST },
  [WBNB_FST.toLowerCase()]: { symbol: "BNB", decimals: 18, address: WBNB_FST, native: true },
  bnb: { symbol: "BNB", decimals: 18, address: WBNB_FST, native: true },
};

/// 官方 NumberText：precision = min(6, maxLength(7) − 整数位数)，向下取整，numeral '0,0.000000'，输出 `${b} ${num} ${a}`。
export function numberText(num, { b = "", a = "", digits = 6, maxLength = 7 } = {}) {
  const n = Number(num) || 0;
  let precision = digits;
  const intLen = String(parseInt(n) || 0).length;
  precision = Math.max(0, Math.min(precision, maxLength - intLen));
  const f = Math.floor(n * 10 ** precision) / 10 ** precision;
  const [i, d] = f.toFixed(precision).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return b + " " + (d ? int + "." + d : int) + " " + a;
}
const toNum = (v, decimals) => Number(swapFormatUnits(v, decimals));

// —— K 线周期（官方 1m…12h；GeckoTerminal 不支持的 3m/30m 由 1m/15m 聚合） ——
const INTERVALS = [
  { text: "1m", minutes: 1, tf: "minute", agg: 1, merge: 1 },
  { text: "3m", minutes: 3, tf: "minute", agg: 1, merge: 3 },
  { text: "5m", minutes: 5, tf: "minute", agg: 5, merge: 1 },
  { text: "15m", minutes: 15, tf: "minute", agg: 15, merge: 1 },
  { text: "30m", minutes: 30, tf: "minute", agg: 15, merge: 2 },
  { text: "1h", minutes: 60, tf: "hour", agg: 1, merge: 1 },
  { text: "4h", minutes: 240, tf: "hour", agg: 4, merge: 1 },
  { text: "12h", minutes: 720, tf: "hour", agg: 12, merge: 1 },
];
const klinePath = (pair, iv) => `/pools/${pair.toLowerCase()}/ohlcv/${iv.tf}?aggregate=${iv.agg}&limit=${Math.min(1000, 300 * iv.merge)}&currency=token`;
function klineRows(body, iv) {
  let rows = (body?.data?.attributes?.ohlcv_list ?? []).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], vol: r[5] })).sort((x, y) => x.time - y.time);
  if (iv.merge > 1) {
    const span = iv.minutes * 60; const out = new Map();
    for (const r of rows) {
      const t = Math.floor(r.time / span) * span; const m = out.get(t);
      if (!m) out.set(t, { ...r, time: t }); else { m.high = Math.max(m.high, r.high); m.low = Math.min(m.low, r.low); m.close = r.close; m.vol += r.vol; }
    }
    rows = [...out.values()];
  }
  return rows;
}
let lwModule = null;
const loadLW = () => (lwModule ??= import("./assets/official/vendor/lightweight-charts.esm.production.js"));
const fmtTime = (t) => { const d = new Date(t * 1000); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export async function mountAnalysisPage(root) {
  const libraryReady = loadSwapLibrary().catch(() => null);
  const request = swapPublicRpc();
  const wallet = useWallet();
  const parts = hashParts();
  const ida = (parts[1] || DEFAULT_ANALYSIS.a).toLowerCase(), idb = (parts[2] || DEFAULT_ANALYSIS.b).toLowerCase();
  const ma = META[ida], mb = META[idb];
  const pool = ma && mb ? POOLS.find((p) => [p.token0, p.token1].map((x) => x.toLowerCase()).sort().join() === [ma.address, mb.address].map((x) => x.toLowerCase()).sort().join()) : null;
  const main = tpl("home");
  mountFrame(root, "analysis", main);
  const card = main.querySelector(".eyuYtB");
  // 标题
  const title = card.querySelector("header.jCPZFR");
  title.querySelector("span").textContent = (ma?.symbol || "") + "-" + (mb?.symbol || "");
  if (!pool) title.querySelector(".kVwuYv")?.remove();
  else {
    const logos = title.querySelectorAll(".kVwuYv > svg");
    [ma, mb].forEach((m, i) => { if (!m.native) applyTokenLogo(logos[i], findActiveToken(m.address)); });
    [ma, mb].forEach((m, i) => { if (m.native && logos[i]) { const img = part("swap_quoted", "#swap-currency-input .iWJdVe > img"); img.setAttribute("style", logos[i].getAttribute("style") || ""); img.style.width = img.style.height = "24px"; logos[i].replaceWith(img); } });
  }
  // PoolData 区块：从标题后到 Tab 前
  const tabs = [...card.children].find((el) => el.querySelector?.(":scope > span.active, :scope > span.normal"));
  const dataNodes = []; for (let n = title.nextElementSibling; n && n !== tabs; n = n.nextElementSibling) dataNodes.push(n);
  if (!pool) {
    const nf = html('<div style="padding: 2rem 1rem;"></div>'); nf.textContent = tr("该交易对不存在...", "The pair was not found in the pool...");
    dataNodes.forEach((n, i) => (i === 0 ? n.replaceWith(nf) : n.remove()));
  }
  // 删除没有实际数据的两项「手续费」，保留用户预估手续费及 24 小时统计。
  for (const node of dataNodes) {
    const labels = [...node.querySelectorAll("label.tsqpu")];
    if (labels.length === 2 && labels.every(label => label.textContent.trim() === T("手续费"))) node.remove();
  }
  const valueSpans = pool ? dataNodes.filter(n => n.isConnected).flatMap((n) => [...n.querySelectorAll("span.cVCYxw")]) : [];
  valueSpans.forEach(span => { span.textContent = "—"; });
  const labelPairs = pool ? dataNodes.flatMap((n) => [...n.querySelectorAll(".gkrqzu > label.tsqpu, .jszKmV > label.tsqpu")]) : [];
  // 官方 pair.token0 / token1（按地址排序），BNB 显示为解包后的 BNB
  const [t0, t1] = pool ? [META[pool.token0.toLowerCase()], META[pool.token1.toLowerCase()]].sort((x, y) => (x.address.toLowerCase() < y.address.toLowerCase() ? -1 : 1)) : [];
  async function fillData() {
    await libraryReady;
    if (!pool || !main.isConnected) return;
    // 卡片标签：余额 / 流动池 / 储备 三组使用 token 符号
    [0, 1, 2, 3, 6, 7].forEach((i) => { const l = labelPairs[i]; if (l) l.textContent = (i % 2 === 0 ? t0 : t1).symbol; });
    const call = async (to, abi, method, args = []) => { const i = new globalThis.ethers.Interface(abi); return i.decodeFunctionResult(method, await request({ method: "eth_call", params: [{ to, data: i.encodeFunctionData(method, args) }, "latest"] })); };
    try {
      const [[r0, r1], [ts]] = await Promise.all([call(pool.pair, PAIR_ABI, "getReserves"), call(pool.pair, PAIR_ABI, "totalSupply")]);
      const acct = wallet.account;
      const bal = async (m) => (m.native ? BigInt(await request({ method: "eth_getBalance", params: [acct, "latest"] })) : (await call(m.address, ERC20, "balanceOf", [acct]))[0]);
      const [b0, b1, lp] = acct ? await Promise.all([bal(t0), bal(t1), call(pool.pair, PAIR_ABI, "balanceOf", [acct]).then((r) => r[0])]) : [null, null, null];
      const res0 = toNum(r0, t0.decimals), res1 = toNum(r1, t1.decimals);
      const d0 = lp != null && ts > 0n ? toNum(lp * r0 / ts, t0.decimals) : null, d1 = lp != null && ts > 0n ? toNum(lp * r1 / ts, t1.decimals) : null;
      const money0 = ["USDT", "BNB"].includes(t0.symbol);
      const unit = money0 ? { coin: t1.symbol, money: t0.symbol, num: res0 / res1 } : { coin: t0.symbol, money: t1.symbol, num: res1 / res0 };
      const v0 = b0 != null ? toNum(b0, t0.decimals) : 0, v1 = b1 != null ? toNum(b1, t1.decimals) : 0;
      const total = money0 ? v0 + (d0 || 0) + (v1 + (d1 || 0)) * unit.num : v1 + (d1 || 0) + (v0 + (d0 || 0)) * unit.num;
      const share = lp != null && ts > 0n ? Number(lp * 10n ** 12n / ts) / 1e10 : 0;
      const values = [
        numberText(v0), numberText(v1),
        numberText(total, { b: "≈", a: unit.money }), numberText(unit.num, { b: "1 " + unit.coin + " ≈ ", a: unit.money }),
        numberText(d0 || 0), numberText(d1 || 0), numberText(0), numberText(0), numberText(share, { a: "%" }),
        numberText(res0), numberText(res1), numberText(state.vol0), numberText(state.vol1), numberText(state.fee0), numberText(state.fee1),
      ];
      valueSpans.forEach((s, i) => { if (values[i] != null) s.textContent = values[i]; });
    } catch {}
  }
  const state = { vol0: 0, vol1: 0, fee0: 0, fee1: 0, iv: 5, tab: "kline" };

  // —— K 线（官方 LightWeight） ——
  const chartWrap = [...card.querySelectorAll('div[style*="position: relative"]')].find((d) => d.querySelector(".hYtEsE"));
  chartWrap?.classList.add("fst-chart-wrap");
  const kspan = chartWrap?.querySelector(".hYtEsE");
  const legend = chartWrap?.querySelector(".keaJxJ");
  const host = chartWrap?.querySelector('div[style="width: 90%;"]');
  if (host) {
    host.replaceChildren();
    host.style.width = "100%";
  }
  let chart = null, candle = null, volume = null;
  const chartStatus = html('<div class="fst-market-status" role="status" aria-live="polite"></div>');
  chartWrap?.append(chartStatus);
  const statusText = (entry, suffix = "") => {
    const time = new Date(entry.fetchedAt).toLocaleTimeString(getLanguage() === "en" ? "en-GB" : "zh-CN");
    return tr("更新于 ", "Updated ") + time + (suffix ? " · " + suffix : "");
  };
  async function ensureChart() {
    if (chart || !host) return;
    const { createChart, CrosshairMode } = await loadLW();
    if (chart || !host.isConnected) return;
    const light = getTheme() === "light";
    const bg = light ? "#ffffff" : "#000000";
    chart = createChart(host, {
      width: host.clientWidth, height: 300,
      layout: { backgroundColor: bg, textColor: light ? "#51596a" : "rgba(201, 199, 199, 0.9)" },
      grid: { vertLines: { color: light ? "#e4e8ef" : "rgba(197, 203, 206, 0.5)" }, horzLines: { color: light ? "#e4e8ef" : "rgba(197, 203, 206, 0.5)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(197, 203, 206, 0.8)" },
      timeScale: { borderColor: "rgba(197, 203, 206, 0.8)" },
    });
    chart.applyOptions({ timeScale: { rightOffset: 11, timeVisible: true, secondsVisible: true, tickMarkFormatter: (t) => fmtTime(t) } });
    candle = chart.addCandlestickSeries({ upColor: "rgba(255, 144, 0, 1)", downColor: bg, borderDownColor: "rgba(255, 144, 0, 1)", borderUpColor: "rgba(255, 144, 0, 1)", wickDownColor: "rgba(255, 144, 0, 1)", wickUpColor: "rgba(255, 144, 0, 1)" });
    volume = chart.addHistogramSeries({ color: "#26a69a", priceFormat: { type: "volume" }, priceScaleId: "", scaleMargins: { top: 0.8, bottom: 0 } });
    chart.subscribeCrosshairMove((param) => {
      if (!legend) return;
      if (param.time) {
        param.seriesPrices.forEach((v) => { if (v && v.open) legend.innerHTML = `<div>${fmtTime(param.time)}</div><div>open:${v.open}</div><div>high:${v.high}</div><div>low:${v.low}</div><div>close:${v.close}</div>`; });
      } else legend.innerHTML = "";
    });
    // 画布跟随卡片宽度；切换交易记录后重新显示也会重新测量。
    const resizeObserver = new ResizeObserver(() => {
      if (!host.isConnected) { resizeObserver.disconnect(); return; }
      const width = host.clientWidth;
      if (width > 0) chart.applyOptions({ width });
    });
    resizeObserver.observe(host);
  }
  let klineSequence = 0;
  async function loadKline() {
    const sequence = ++klineSequence;
    const iv = INTERVALS[state.iv];
    await ensureChart();
    if (!pool || !candle || sequence !== klineSequence || !main.isConnected) return;
    const path = klinePath(pool.pair, iv);
    const cached = marketData.peek(path);
    const paint = (entry, suffix = "") => {
      if (!main.isConnected || sequence !== klineSequence) return;
      const rows = klineRows(entry.body, iv);
      const r6 = (x) => Math.floor(x * 1e6) / 1e6;
      candle.setData(rows.map((r) => ({ time: r.time, open: r6(r.open), high: r6(r.high), low: r6(r.low), close: r6(r.close) })));
      volume.setData(rows.map((r) => ({ time: r.time, value: r6(r.vol), color: r.open < r.close ? "rgba(0, 150, 136, 0.8)" : "rgba(255,82,82, 0.8)" })));
      chartStatus.textContent = rows.length ? statusText(entry, suffix) : tr("暂无 K 线数据", "No chart data yet");
    };
    if (cached) paint(cached, Date.now() - cached.fetchedAt >= 60000 ? tr("正在更新", "Updating") : "");
    else { candle.setData([]); volume.setData([]); chartStatus.textContent = tr("正在加载 K 线…", "Loading chart…"); }
    try { paint(await marketData.read(path)); }
    catch {
      if (!main.isConnected || sequence !== klineSequence) return;
      chartStatus.textContent = cached ? statusText(cached, tr("更新失败，显示缓存", "Update failed; cached data")) : tr("行情暂不可用，点击周期重试", "Chart unavailable; select an interval to retry");
    }
  }
  if (kspan) {
    kspan.querySelectorAll("span").forEach((s, i) => s.addEventListener("click", () => {
      state.iv = i; kspan.querySelectorAll("span").forEach((x, j) => (j === i ? x.className = "active" : x.removeAttribute("class"))); loadKline();
    }));
  }
  // —— Tab：K线图 / 最近的交易 ——
  const txDiv = chartWrap?.parentElement?.nextElementSibling;
  const tradesStatus = html('<div class="fst-market-status" role="status" aria-live="polite"></div>');
  const tradesBox = html('<div class="fst-trades-scroll"></div>');
  let renderedTrades = null;
  if (txDiv) { txDiv.querySelector(':scope > div')?.remove(); txDiv.append(tradesStatus, tradesBox); }
  if (tabs) {
    const [kTab, hTab] = tabs.querySelectorAll("span");
    const setTab = (t) => {
      state.tab = t; kTab.className = t === "kline" ? "active" : "normal"; hTab.className = t === "kline" ? "normal" : "active";
      chartWrap.parentElement.style.display = t === "kline" ? "block" : "none"; if (txDiv) txDiv.style.display = t === "kline" ? "none" : "block";
      if (t === "history") loadTrades();
    };
    kTab.addEventListener("click", () => setTab("kline")); hTab.addEventListener("click", () => setTab("history"));
  }
  async function loadTrades() {
    if (!pool || !txDiv) return;
    const path = `/pools/${pool.pair.toLowerCase()}/trades`;
    const cached = marketData.peek(path);
    const paint = (entry, suffix = "") => {
      if (!main.isConnected) return;
      const trades = entry.body?.data ?? [];
      tradesStatus.textContent = trades.length ? statusText(entry, suffix) : tr("暂无交易记录", "No recent transactions");
      if (renderedTrades === entry) return;
      const table = html('<table><tbody></tbody></table>');
      const tb = table.querySelector("tbody");
      const link = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
      const ago = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 45) return tr("几秒前", "a few seconds ago"); if (s < 90) return tr("1 分钟前", "a minute ago"); if (s < 2700) return tr(Math.round(s / 60) + " 分钟前", Math.round(s / 60) + " minutes ago"); if (s < 5400) return tr("1 小时前", "an hour ago"); if (s < 79200) return tr(Math.round(s / 3600) + " 小时前", Math.round(s / 3600) + " hours ago"); return tr(Math.round(s / 86400) + " 天前", Math.round(s / 86400) + " days ago"); };
      for (const t of trades.slice(0, 200)) {
        const a = t.attributes || {};
        const fromSym = (a.from_token_address || "").toLowerCase() === FIST.toLowerCase() ? "FIST" : t0.symbol === "FIST" ? t1.symbol : t0.symbol;
        const toSym = fromSym === "FIST" ? (t0.symbol === "FIST" ? t1.symbol : t0.symbol) : "FIST";
        const amtOf = (sym) => (sym === fromSym ? a.from_token_amount : a.to_token_amount);
        const tr0 = document.createElement("tr");
        tr0.innerHTML = `<td style="width: 220px; padding-left: 10px;"> <a target="_blank" rel="noopener noreferrer" class="sc-hia0it-4 hEuNJK" href="https://bscscan.com/tx/${a.tx_hash}"><span style="margin-right: 4px;"><span>Swap ${fromSym} for ${toSym}</span></span>${link}</a></td>` +
          `<td style="width: 150px; padding-left: 10px;"><span class="sc-1cj24uk-0 cVCYxw">${numberText(amtOf(t0.symbol))}</span> ${t0.symbol}</td>` +
          `<td style="width: 150px; padding-left: 10px;"><span class="sc-1cj24uk-0 cVCYxw">${numberText(amtOf(t1.symbol))}</span> ${t1.symbol}</td>` +
          `<td style="width: 200px; padding-left: 10px;"><a target="_blank" rel="noopener noreferrer" class="sc-hia0it-4 hEuNJK" href="https://bscscan.com/address/${a.tx_from_address}"><span style="margin-right: 4px;">${(a.tx_from_address || "").slice(0, 6)}...${(a.tx_from_address || "").slice(-4)}</span>${link}</a></td>` +
          `<td style="width: 150px; padding-left: 10px;">${ago(a.block_timestamp)}</td>`;
        tb.append(tr0);
      }
      tradesBox.replaceChildren(table);
      renderedTrades = entry;
    };
    if (cached) paint(cached, Date.now() - cached.fetchedAt >= 60000 ? tr("正在更新", "Updating") : "");
    else tradesStatus.textContent = tr("正在加载交易记录…", "Loading transactions…");
    try { paint(await marketData.read(path)); }
    catch { if (main.isConnected) tradesStatus.textContent = cached ? statusText(cached, tr("更新失败，显示缓存", "Update failed; cached data")) : tr("交易记录暂不可用，请稍后重试", "Transactions unavailable; please retry shortly"); }
  }
  // 24 小时成交量 / 手续费（GeckoTerminal 池统计，按 0.3% 费率估算）
  async function loadStats() {
    if (!pool) return;
    try {
      const { body } = await marketData.read(`/pools/${pool.pair.toLowerCase()}`);
      const at = body?.data?.attributes || {};
      const usd = Number(at.volume_usd?.h24 || 0);
      const priceOf = (m) => Number(m.symbol === "FIST" ? (at.base_token_price_usd && body.data.relationships?.base_token?.data?.id?.toLowerCase().includes(FIST.toLowerCase()) ? at.base_token_price_usd : at.quote_token_price_usd) : (at.base_token_price_usd && body.data.relationships?.base_token?.data?.id?.toLowerCase().includes(FIST.toLowerCase()) ? at.quote_token_price_usd : at.base_token_price_usd)) || 0;
      const p0 = priceOf(t0), p1 = priceOf(t1);
      state.vol0 = p0 ? usd / 2 / p0 : 0; state.vol1 = p1 ? usd / 2 / p1 : 0; state.fee0 = state.vol0 * 0.003; state.fee1 = state.vol1 * 0.003;
      [state.vol0, state.vol1, state.fee0, state.fee1].forEach((value, i) => { if (valueSpans[11 + i]) valueSpans[11 + i].textContent = numberText(value); });
    } catch {}
  }
  wallet.subscribe(() => fillData());
  fillData(); loadKline(); loadStats();
  // 用户还在阅读上方数据时预取交易记录，切换标签直接复用。
  if (pool) loadTrades();
}

// —— 我的（官方 pages/My） ——
export async function mountMyPage(root) {
  const main = tpl("my");
  mountFrame(root, "my", main);
  const rows = main.querySelectorAll("button.jUwsPs");
  const [node, code, history, lang, theme] = rows;
  node?.addEventListener("click", () => popup({ summary: tr("节点：内置公共 BSC RPC 池（自动故障转移）", "Node: built-in public BSC RPC pool (automatic failover)") }));
  code?.addEventListener("click", () => { window.location.href = "https://bscscan.com/address/0x9A272d734c5a0d7d84E0a892e891a553e8066dce#code"; });
  history?.addEventListener("click", () => {
    let list = []; try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch {}
    if (!list.length) popup({ summary: tr("您的交易将出现在这里...", "Your transactions will appear here...") });
    list.slice(0, 3).reverse().forEach((i) => popup({ summary: i.summary || "Swap", hash: i.hash }));
  });
  if (lang) {
    const path = "#/my";
    lang.querySelectorAll("a").forEach((a, i) => {
      a.href = path + (getLanguage() === "en" ? "?lng=zh-CN" : "?lng=en-US");
      if (i === 1) a.textContent = getLanguage() === "en" ? "English" : "简体中文";
    });
  }
  if (theme) {
    theme.classList.add("fst-theme-toggle");
    const updateTheme = () => {
      const light = getTheme() === "light";
      const label = light ? tr("切换至深色", "Switch to dark theme") : tr("切换至浅色", "Switch to light theme");
      theme.querySelector("div").textContent = light ? tr("深色", "Dark") : tr("浅色", "Light");
      theme.setAttribute("aria-label", label);
      theme.title = label;
      theme.querySelector("svg").innerHTML = light
        ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    };
    theme.addEventListener("click", () => { setTheme(getTheme() === "light" ? "dark" : "light"); updateTheme(); });
    updateTheme();
    for (const social of SOCIAL_LINKS) {
      const a = html('<a class="sc-3fvj2x-1 jUwsPs fst-social-link" target="_blank" rel="noopener noreferrer"><span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 3h6v6m0-6L10 14M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg></a>');
      a.href = social.url;
      a.querySelector("span").textContent = tr(social.zh, social.en);
      a.setAttribute("aria-label", tr(social.zh + "（新窗口打开）", social.en + " (opens in a new tab)"));
      theme.parentElement.append(a);
    }
  }
}
