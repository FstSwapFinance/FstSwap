// Fstswap 聚合前端入口：官方同款路由（#/swap、#/pool、#/pool/v2/find、#/add/v2/A/B、#/remove/v2/A/B、#/analysis/A/B、#/my）。
import { currentRoute, restoreWallet, useWallet, closeModal } from "./swap-shell.mjs?v=mainnet-20261111-21";

import { refreshDefaultList, onTokensChanged, findActiveToken } from "./swap-manage.mjs?v=mainnet-20261111-21";
import { applyTokenLogo } from "./swap-token-logo.mjs";

const root = document.getElementById("root");
let rendering = 0;

async function render() {
  const ticket = ++rendering;
  const route = currentRoute();
  try {
    closeModal();
    document.body.classList.remove("agg-scroll-lock");
    if (route === "swap") {
      const { mountSwapView } = await import("./swap-view.mjs?v=mainnet-20261111-21");
      if (ticket === rendering) await mountSwapView(root);
    } else if (route === "pool" || route === "add" || route === "remove") {
      const { mountPoolPage } = await import("./swap-pool.mjs?v=mainnet-20261111-21");
      if (ticket === rendering) await mountPoolPage(root, route);
    } else if (route === "analysis") {
      const { mountAnalysisPage } = await import("./swap-pages.mjs?v=mainnet-20261111-21");
      if (ticket === rendering) await mountAnalysisPage(root);
    } else if (route === "my") {
      const { mountMyPage } = await import("./swap-pages.mjs?v=mainnet-20261111-21");
      if (ticket === rendering) await mountMyPage(root);
    }
  } catch (err) {
    if (ticket !== rendering) return;
    root.innerHTML = '<div style="padding:120px 16px;color:#fff;text-align:center">页面加载失败：' +
      String((err && (err.message || err)) || "未知错误").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch])) + "</div>";
  }
}

window.addEventListener("hashchange", render);
render();
// First paint and wallet interaction take priority over speculative RPC reads.
const background = fn => setTimeout(() => fn().catch(() => {}), 0);
background(restoreWallet);
window.addEventListener('ethereum#initialized', () => background(restoreWallet));
let warmedAccount = null;
useWallet().subscribe(wallet => {
  const account = wallet?.account || null;
  if (!account || account === warmedAccount) { warmedAccount = account; return; }
  warmedAccount = account;
  background(async () => { const {warmSwapData} = await import('./swap-view.mjs?v=mainnet-20261111-21'); await warmSwapData(account); });
});
background(async () => { const {warmSwapData} = await import('./swap-view.mjs?v=mainnet-20261111-21'); await warmSwapData(useWallet().account); });

// Background refresh also runs when users land directly on analysis/pool pages.
onTokensChanged(() => root.querySelectorAll('[data-token-address]').forEach(el => applyTokenLogo(el, findActiveToken(el.dataset.tokenAddress))));
refreshDefaultList();

// Unregister only this application's exact scope; leave other apps on the origin alone.
if ('serviceWorker' in navigator) {
  const scope = new URL('./', document.baseURI).href;
  navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.filter(r => r.scope === scope).map(r => r.unregister()))).catch(() => {});
}
