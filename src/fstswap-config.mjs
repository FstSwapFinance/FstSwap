// BSC mainnet deployment verified from seven successful receipts; three adapters.
export const FSTSWAP_CONFIG = Object.freeze({
  "name": "FstSwap",
  "version": "2.1.0",
  "chainId": 56,
  "status": "verified-mainnet",
  "router": "0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7",
  "adapters": Object.freeze({
    "fst": "0xdFabF87EE3A9A4cEdda43D3f8035C89E1C9438b7",
    "pancake": "0x9De342bDFFB5da04D9865f4cd9846D22560D253a",
    "v3": "0xE381c967c14b0c6ef82944E0e4b4272D24dd8957"
  })
});
export function fstSwapReady(config=FSTSWAP_CONFIG) {
  const address=value=>/^0x[0-9a-f]{40}$/i.test(value||'')&&!/^0x0{40}$/i.test(value);
  return config.status==='verified-mainnet'&&config.chainId===56&&['2.0.0','2.1.0'].includes(config.version)
    &&address(config.router)&&['fst','pancake','v3'].every(k=>address(config.adapters?.[k]));
}
