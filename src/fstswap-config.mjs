// Updated only after all mainnet deployment receipts and bindings are verified.
export const FSTSWAP_CONFIG = Object.freeze({
  name: 'FstSwap', version: '2.0.0', chainId: 56,
  status: 'awaiting-deployment', router: '', adapters: Object.freeze({}),
});
export function fstSwapReady(config=FSTSWAP_CONFIG) {
  const address=value=>/^0x[0-9a-f]{40}$/i.test(value||'')&&!/^0x0{40}$/i.test(value);
  return config.status==='verified-mainnet'&&config.chainId===56&&config.version==='2.0.0'
    &&address(config.router)&&['fst','pancake','biswap','v3'].every(k=>address(config.adapters?.[k]));
}
