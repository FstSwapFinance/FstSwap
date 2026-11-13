// Fstswap 聚合前端入口：官方同款路由（#/swap、#/pool、#/pool/v2/find、#/add/v2/A/B、#/remove/v2/A/B、#/analysis/A/B、#/my）。
import { currentRoute, restoreWallet, closeModal, useWallet } from "./swap-shell.mjs?v=mainnet-20261113-50";
import { startDefaultSwapReads } from "./swap-startup.mjs?v=mainnet-20261113-50";

import { refreshDefaultList, onTokensChanged, findActiveToken } from "./swap-manage.mjs?v=mainnet-20261113-50";
import { applyTokenLogo } from "./swap-token-logo.mjs";

const root = document.getElementById("root");
const stopDefaultReads = startDefaultSwapReads({wallet:useWallet(),active:()=>currentRoute()==="swap"});
window.addEventListener('pagehide',stopDefaultReads,{once:true});
let rendering = 0;
let stopLibraryRecovery = () => {};

function recoverLateLibrary(ticket, mountedHash) {
  const current = () => ticket === rendering && location.hash === mountedHash;
  const ready = () => typeof globalThis.ethers?.Interface === "function" && typeof globalThis.ethers?.parseUnits === "function";
  const resume = () => Promise.resolve().then(() => { if (current() && ready()) render(); });
  // The vendor can finish between the loader rejecting and this catch running.
  if (ready()) { resume(); return; }
  const script = document.querySelector('script[data-fst-library="ethers"]');
  if (!script || ["error", "loaded"].includes(script.dataset.fstLibraryState)) return;
  const cleanup = () => {
    script.removeEventListener("load", loaded);
    script.removeEventListener("error", cleanup);
    if (stopLibraryRecovery === cleanup) stopLibraryRecovery = () => {};
  };
  const loaded = () => { cleanup(); if (current() && ready()) resume(); };
  stopLibraryRecovery = cleanup;
  script.addEventListener("load", loaded, {once:true});
  script.addEventListener("error", cleanup, {once:true});
  // Subscribe to the original script only: inserting another classic vendor
  // could execute both copies and redeclare ethers' top-level bindings.
  if (ready()) loaded();
}

async function render() {
  stopLibraryRecovery();
  const ticket = ++rendering;
  const mountedHash = location.hash;
  const route = currentRoute();
  try {
    closeModal();
    document.body.classList.remove("agg-scroll-lock");
    if (route === "swap") {
      const { mountSwapView } = await import("./swap-view.mjs?v=mainnet-20261113-50");
      if (ticket === rendering) await mountSwapView(root);
    } else if (route === "pool" || route === "add" || route === "remove") {
      const { mountPoolPage } = await import("./swap-pool.mjs?v=mainnet-20261113-50");
      if (ticket === rendering) await mountPoolPage(root, route);
    } else if (route === "analysis") {
      const { mountAnalysisPage } = await import("./swap-pages.mjs?v=mainnet-20261113-50");
      if (ticket === rendering) await mountAnalysisPage(root);
    } else if (route === "my") {
      const { mountMyPage } = await import("./swap-pages.mjs?v=mainnet-20261113-50");
      if (ticket === rendering) await mountMyPage(root);
    }
  } catch (err) {
    if (ticket !== rendering) return;
    root.innerHTML = '<div style="padding:120px 16px;color:#fff;text-align:center">页面加载失败：' +
      String((err && (err.message || err)) || "未知错误").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch])) + "</div>";
    if (err?.code === "SWAP_DEPENDENCY") recoverLateLibrary(ticket, mountedHash);
  }
}

window.addEventListener("hashchange", render);
render();
// First paint and wallet interaction take priority over speculative RPC reads.
const background = fn => setTimeout(() => fn().catch(() => {}), 0);
background(restoreWallet);
background(async()=>{
  const {swapService}=await import('./swap-service-client.mjs?v=mainnet-20261113-50');
  await swapService.warmConnection();
});
window.addEventListener('ethereum#initialized', () => background(restoreWallet));

// Background refresh also runs when users land directly on analysis/pool pages.
onTokensChanged(() => root.querySelectorAll('[data-token-address]').forEach(el => applyTokenLogo(el, findActiveToken(el.dataset.tokenAddress))));
refreshDefaultList();

// Unregister only this application's exact scope; leave other apps on the origin alone.
if ('serviceWorker' in navigator) {
  const scope = new URL('./', document.baseURI).href;
  navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.filter(r => r.scope === scope).map(r => r.unregister()))).catch(() => {});
}
