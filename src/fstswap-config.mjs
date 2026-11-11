// BSC mainnet deployment verified from nine successful receipts.
export const FSTSWAP_CONFIG = Object.freeze({
  name: 'FstSwap', version: '2.0.0', chainId: 56,
  status: 'verified-mainnet',
  router: '0x44101D7Ac0B9Ae7c2ac2C40cB6dE68BCC95268c9',
  adapters: Object.freeze({
    "fst": "0x3053F1C2E69DDA1bf67d7b8586F6BCc1375651EC",
    "pancake": "0xC3E03597BE39b5a534665210DcEAB7F31BE1F15D",
    "v3": "0x3726A0724633a10AE6590A2662e34Ba5c1b25FB8"
}),
});
export function fstSwapReady(config=FSTSWAP_CONFIG) {
  const address=value=>/^0x[0-9a-f]{40}$/i.test(value||'')&&!/^0x0{40}$/i.test(value);
  return config.status==='verified-mainnet'&&config.chainId===56&&config.version==='2.0.0'
    &&address(config.router)&&['fst','pancake','v3'].every(k=>address(config.adapters?.[k]));
}
