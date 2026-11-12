// 首页 / 币对分析（#/analysis/A/B，官方 pages/PoolAnalysis）与 我的（#/my，官方 pages/My）——
// 界面逐节点复刻官方 DOM 模板；K 线使用官方同版本 TradingView Lightweight Charts v3.8.0（取自官方构建），
// 数据：链上储备/余额/LP（RPC 池）+ GeckoTerminal OHLCV / 成交（官方 /api/Fst/* 接口在静态站点不可用）。
import { SWAP_TOKENS, swapPublicRpc, loadSwapLibrary, swapFormatUnits } from "./swap-aggregator.mjs?v=mainnet-20261112-39";
import { tr, T, tpl, part, html, mountFrame, useWallet, popup, getLanguage, hashParts, DEFAULT_ANALYSIS } from "./swap-shell.mjs?v=mainnet-20261112-39";
import { TOKENS } from "./swap-view.mjs?v=mainnet-20261112-39";
import { discoverAnalysisPools, readAnalysisPool, analysisStats, analysisTrade, analysisKlinePath, analysisPrice, matchesAnalysisToken, isPoolAddress } from "./swap-analysis-data.mjs?v=mainnet-20261112-39";
import { marketData } from "./swap-market-data.mjs?v=review-20261110-3";
import { getTheme, setTheme, SOCIAL_LINKS } from "./swap-ui.mjs?v=review-20261110-3";

import { findActiveToken, refreshDefaultList, readToken } from "./swap-manage.mjs?v=mainnet-20261112-39";
import { applyTokenLogo } from "./swap-token-logo.mjs";

const WBNB_FST = "0x0efb5FD2402A0967B92551d6AF54De148504A115";
const HISTORY_KEY = "swap_history_v1";
const PAIR_ABI = ["function getReserves() view returns (uint112,uint112,uint32)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
const ERC20 = ["function balanceOf(address) view returns (uint256)"];


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
const loadLW = () => (lwModule ??= import("../assets/official/vendor/lightweight-charts.esm.production.js"));
const fmtTime = (t) => { const d = new Date(t * 1000); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export async function mountAnalysisPage(root) {
  const libraryReady = loadSwapLibrary().catch(() => null);
  const request = swapPublicRpc(globalThis.fetch, undefined, { attempts: 2, timeoutMs: 3500 });
  const wallet = useWallet();
  const parts = hashParts();
  const ida = (parts[1] || DEFAULT_ANALYSIS.a).toLowerCase(), idb = (parts[2] || DEFAULT_ANALYSIS.b).toLowerCase();
  const main = tpl("home");
  let disposed = false, chart = null, candle = null, volume = null, chartObserver = null, stopWallet = () => {};
  const alive = () => !disposed && main.isConnected;
  const dispose = () => { disposed = true; stopWallet(); chartObserver?.disconnect(); chart?.remove(); window.removeEventListener('hashchange', dispose); };
  window.addEventListener('hashchange', dispose, { once: true });
  mountFrame(root, "analysis", main);
  const card = main.querySelector(".eyuYtB");
  const title = card.querySelector("header.jCPZFR");
  const pairIcons = [...title.querySelectorAll(".kVwuYv > svg")];
  title.querySelector("span").textContent = "—";
  const tabs = [...card.children].find(el => el.querySelector?.(":scope > span.active, :scope > span.normal"));
  const dataNodes = [];
  for (let n = title.nextElementSibling; n && n !== tabs; n = n.nextElementSibling) dataNodes.push(n);
  for (const node of dataNodes) {
    const labels = [...node.querySelectorAll("label.tsqpu")];
    if (labels.length === 2 && labels.every(label => label.textContent.trim() === T("手续费"))) node.remove();
  }
  const valueSpans = dataNodes.filter(n => n.isConnected).flatMap(n => [...n.querySelectorAll("span.cVCYxw")]);
  valueSpans.forEach(span => { span.textContent = "—"; });
  const labelPairs = dataNodes.filter(n => n.isConnected).flatMap(n => [...n.querySelectorAll(".gkrqzu > label.tsqpu, .jszKmV > label.tsqpu")]);
  [0, 1, 2, 3, 6, 7].forEach(i => { if (labelPairs[i]) labelPairs[i].textContent = "—"; });
  // Clear captured template chart/trades before any network await.
  const capturedChart = [...card.querySelectorAll('div[style*="position: relative"]')].find(d => d.querySelector(".hYtEsE"));
  capturedChart?.querySelector('div[style="width: 90%;"]')?.replaceChildren();
  capturedChart?.querySelector('.keaJxJ')?.replaceChildren();
  capturedChart?.parentElement?.nextElementSibling?.querySelector(':scope > div')?.remove();
  if (capturedChart) capturedChart.parentElement.style.display = "none";
  if (tabs) tabs.style.display = "none";
  const choice = html('<div class="fst-pool-status" hidden><p role="status" aria-live="polite"></p></div>');
  title.after(choice);
  const poolStatus = choice.querySelector('p');
  let ma = null, mb = null;
  const drawPair = () => {
    title.querySelector('span').textContent = ma.symbol + '-' + mb.symbol;
    [ma, mb].forEach((token, index) => {
      const icon = pairIcons[index];
      if (token.native) {
        const img = document.createElement('img');
        for (const attr of ['class', 'style', 'width', 'height']) if (icon.hasAttribute(attr)) img.setAttribute(attr, icon.getAttribute(attr));
        img.src = 'assets/official/media/bnb.c51cffcc.svg'; img.alt = 'BNB'; icon.replaceWith(img);
      } else applyTokenLogo(icon, token);
    });
  };
  const resolveToken = async id => {
    if (id === 'bnb' || id === WBNB_FST.toLowerCase()) return { ...TOKENS.bnb, native: true };
    if (!isPoolAddress(id)) throw Error('Invalid token address');
    const token = findActiveToken(id) || await readToken(request, id);
    if (!token) throw Error('Token metadata unavailable');
    return { ...token, key: id };
  };
  let pool;
  try {
    await libraryReady;
    [ma, mb] = await Promise.all([resolveToken(ida), resolveToken(idb)]);
    if (!alive()) return;
    drawPair();
    const found = await discoverAnalysisPools(request, ma, mb, marketData);
    if (!alive()) return;
    const selected = found.pools[0];
    if (!selected) {
      choice.hidden = false;
      poolStatus.textContent = found.incomplete ? tr('部分池数据暂不可用，请重试，或在兑换页选择其他币对。', 'Some pool data is unavailable. Retry or choose another pair on Swap.')
        : tr('未找到已收录的直接交易池，请在兑换页选择其他币对。', 'No indexed direct pool found. Choose another pair on Swap.');
      const retry = html('<button type="button" class="fst-common-token"></button>'); retry.textContent = tr('重试', 'Retry');
      retry.onclick = () => { dispose(); mountAnalysisPage(root); }; choice.append(retry);
      return;
    }
    pool = await readAnalysisPool(request, selected, ma, mb);
    if (!alive()) return;
    if (pool.kind === 'v3') { choice.hidden = false; poolStatus.textContent = tr('V3 的个人 NFT 持仓不在此展示', 'Individual V3 NFT positions are not shown here'); }
    else choice.remove();
  } catch {
    if (alive()) {
      choice.hidden = false;
      poolStatus.textContent = tr('池数据读取失败，请重试，或在兑换页选择其他币对。', 'Pool data unavailable. Retry or choose another pair on Swap.');
      const retry = html('<button type="button" class="fst-common-token"></button>'); retry.textContent = tr('重试', 'Retry');
      retry.onclick = () => { dispose(); mountAnalysisPage(root); }; choice.append(retry);
    }
    return;
  }
  const [t0, t1] = pool.tokens;
  const state = { stats: [null, null, null, null], iv: 5, tab: "kline" };
  [0, 1, 2, 3, 6, 7].forEach(i => { if (labelPairs[i]) labelPairs[i].textContent = (i % 2 === 0 ? t0 : t1).symbol; });
  let accountSequence = 0;
  async function fillData() {
    const sequence = ++accountSequence, acct = wallet.account;
    const call = async (to, abi, method, args = []) => {
      const codec = new globalThis.ethers.Interface(abi);
      return codec.decodeFunctionResult(method, await request({ method: 'eth_call', params: [{ to, data: codec.encodeFunctionData(method, args) }, 'latest'] }));
    };
    const [r0, r1] = pool.reserves, ts = pool.totalSupply;
    const res0 = toNum(r0, t0.decimals), res1 = toNum(r1, t1.decimals);
    const price1Per0 = pool.kind === 'v3' ? pool.price1Per0 : res1 / res0;
    const money0 = matchesAnalysisToken(ma, t0.poolAddress);
    const unit = { coin: mb.symbol, money: ma.symbol, num: money0 ? 1 / price1Per0 : price1Per0 };
    const display = n => Number.isFinite(n) ? numberText(n) : '—';
    valueSpans[3].textContent = '1 ' + unit.coin + ' ≈ ' + analysisPrice(unit.num) + ' ' + unit.money;
    valueSpans[9].textContent = display(res0); valueSpans[10].textContent = display(res1);
    [0, 1, 2, 4, 5, 6, 7, 8].forEach(i => { valueSpans[i].textContent = '—'; });
    try {
      const balance = async m => m.native ? BigInt(await request({ method: 'eth_getBalance', params: [acct, 'latest'] }))
        : (await call(m.address, ERC20, 'balanceOf', [acct]))[0];
      const [b0, b1, lp] = acct ? await Promise.all([balance(t0), balance(t1), pool.kind === 'v2' ? call(pool.pair, PAIR_ABI, 'balanceOf', [acct]).then(r => r[0]) : null]) : [0n, 0n, pool.kind === 'v2' ? 0n : null];
      if (!alive() || sequence !== accountSequence || acct !== wallet.account) return;
      const v0 = toNum(b0, t0.decimals), v1 = toNum(b1, t1.decimals);
      const d0 = lp != null && ts > 0n ? toNum(lp * r0 / ts, t0.decimals) : lp === 0n ? 0 : null;
      const d1 = lp != null && ts > 0n ? toNum(lp * r1 / ts, t1.decimals) : lp === 0n ? 0 : null;
      const total = money0 ? v0 + (d0 || 0) + (v1 + (d1 || 0)) * unit.num : v1 + (d1 || 0) + (v0 + (d0 || 0)) * unit.num;
      const share = lp != null && ts > 0n ? Number(lp * 10n ** 12n / ts) / 1e10 : lp === 0n ? 0 : null;
      const values = [display(v0), display(v1), Number.isFinite(total) ? numberText(total, { b: '≈', a: unit.money }) : '—', null,
        d0 == null ? '—' : display(d0), d1 == null ? '—' : display(d1),
        share != null && state.stats[2] != null ? display(state.stats[2] * share / 100) : '—',
        share != null && state.stats[3] != null ? display(state.stats[3] * share / 100) : '—',
        share == null ? '—' : numberText(share, { a: '%' })];
      values.forEach((value, i) => { if (value != null) valueSpans[i].textContent = value; });
    } catch { /* Preserve pool data while unavailable wallet balances remain unknown. */ }
  }
  if (tabs) tabs.style.display = '';
  if (capturedChart) capturedChart.parentElement.style.display = '';

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
  const chartStatus = html('<div class="fst-market-status" role="status" aria-live="polite"></div>');
  chartWrap?.append(chartStatus);
  const statusText = (entry, suffix = "") => {
    const time = new Date(entry.fetchedAt).toLocaleTimeString(getLanguage() === "en" ? "en-GB" : "zh-CN");
    return tr("更新于 ", "Updated ") + time + (suffix ? " · " + suffix : "");
  };
  async function ensureChart() {
    if (chart || !host) return;
    const { createChart, CrosshairMode } = await loadLW();
    if (chart || !host.isConnected || !alive()) return;
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
    const resizeObserver = chartObserver = new ResizeObserver(() => {
      if (!host.isConnected || !alive()) { resizeObserver.disconnect(); return; }
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
    if (!pool || !candle || sequence !== klineSequence || !alive()) return;
    const path = analysisKlinePath(pool.pair, iv, matchesAnalysisToken(mb, t0.poolAddress) ? t0.poolAddress : t1.poolAddress);
    const cached = marketData.peek(path);
    const paint = (entry, suffix = "") => {
      if (!alive() || sequence !== klineSequence) return;
      const rows = klineRows(entry.body, iv);
      const last = rows.at(-1)?.close;
      if (last > 0) {
        const precision = Math.min(16, Math.max(4, 4 - Math.floor(Math.log10(last))));
        candle.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
      }
      candle.setData(rows.map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close })));
      volume.setData(rows.map((r) => ({ time: r.time, value: r.vol, color: r.open < r.close ? "rgba(0, 150, 136, 0.8)" : "rgba(255,82,82, 0.8)" })));
      chartStatus.textContent = rows.length ? statusText(entry, suffix) : tr("暂无 K 线数据", "No chart data yet");
    };
    if (cached) paint(cached, Date.now() - cached.fetchedAt >= 60000 ? tr("正在更新", "Updating") : "");
    else { candle.setData([]); volume.setData([]); chartStatus.textContent = tr("正在加载 K 线…", "Loading chart…"); }
    try { paint(await marketData.read(path)); }
    catch {
      if (!alive() || sequence !== klineSequence) return;
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
      if (!alive()) return;
      const trades = entry.body?.data ?? [];
      tradesStatus.textContent = trades.length ? statusText(entry, suffix) : tr("暂无交易记录", "No recent transactions");
      if (renderedTrades === entry) return;
      const table = html('<table><tbody></tbody></table>');
      const tb = table.querySelector("tbody");
      const ago = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 45) return tr("几秒前", "a few seconds ago"); if (s < 90) return tr("1 分钟前", "a minute ago"); if (s < 2700) return tr(Math.round(s / 60) + " 分钟前", Math.round(s / 60) + " minutes ago"); if (s < 5400) return tr("1 小时前", "an hour ago"); if (s < 79200) return tr(Math.round(s / 3600) + " 小时前", Math.round(s / 3600) + " hours ago"); return tr(Math.round(s / 86400) + " 天前", Math.round(s / 86400) + " days ago"); };
      for (const t of trades.slice(0, 200)) {
        const trade = analysisTrade(t.attributes, pool.tokens);
        if (!trade) continue;
        const row = document.createElement('tr');
        const cell = (text, href) => {
          const td = document.createElement('td'); td.style.padding = '0 10px';
          const el = document.createElement(href ? 'a' : 'span'); el.textContent = text;
          if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.className = 'hEuNJK'; }
          td.append(el); row.append(td);
        };
        cell('Swap ' + trade.from + ' for ' + trade.to, 'https://bscscan.com/tx/' + trade.hash);
        pool.tokens.forEach((token, i) => cell(numberText(trade.amounts[i]) + ' ' + token.symbol));
        cell(trade.account ? trade.account.slice(0, 6) + '…' + trade.account.slice(-4) : '—', trade.account ? 'https://bscscan.com/address/' + trade.account : null);
        cell(ago(trade.time)); tb.append(row);
      }
      tradesBox.replaceChildren(table);
      renderedTrades = entry;
    };
    if (cached) paint(cached, Date.now() - cached.fetchedAt >= 60000 ? tr("正在更新", "Updating") : "");
    else tradesStatus.textContent = tr("正在加载交易记录…", "Loading transactions…");
    try { paint(await marketData.read(path)); }
    catch { if (alive()) tradesStatus.textContent = cached ? statusText(cached, tr("更新失败，显示缓存", "Update failed; cached data")) : tr("交易记录暂不可用，请稍后重试", "Transactions unavailable; please retry shortly"); }
  }
  // Statistics are mapped by token address, independently of API base/quote ordering.
  async function loadStats() {
    try {
      const { body } = await marketData.read(`/pools/${pool.pair.toLowerCase()}`);
      if (!alive()) return;
      state.stats = analysisStats(body.data, pool.tokens, pool.feeRate);
      state.stats.forEach((value, i) => { if (valueSpans[11 + i]) valueSpans[11 + i].textContent = value == null ? '—' : numberText(value); });
      fillData();
    } catch {}
  }
  stopWallet = wallet.subscribe(() => { if (alive()) fillData(); else stopWallet(); });
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
