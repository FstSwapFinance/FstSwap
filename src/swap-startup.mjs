import {SWAP_TOKENS,SWAP_ADAPTERS,swapActiveRouter,swapPublicRpc} from './swap-aggregator.mjs?v=mainnet-20261112-46';
import {swapService} from './swap-service-client.mjs?v=mainnet-20261112-46';
import {readWalletBalances} from './swap-balances.mjs?v=mainnet-20261112-46';

const DEFAULT_TOKENS=[
  {...SWAP_TOKENS.usdt,key:'usdt',decimals:18},
  {...SWAP_TOKENS.fist,key:'fist',decimals:6},
  {...SWAP_TOKENS.bnb,key:'bnb',address:null,decimals:18},
];
function settingsFrom(storage) {
  let saved;
  try { saved=JSON.parse((storage??globalThis.localStorage)?.getItem('swap_settings_v2')||'{}'); } catch {}
  return {
    slippageBps:Number.isInteger(saved?.slippageBps)&&saved.slippageBps>=0&&saved.slippageBps<=5000?saved.slippageBps:50,
    singleHop:saved?.singleHop===true,
  };
}

// Read-only startup work shares the page's service/cache, but owns only its
// subscriptions. It does not load ethers, connect a wallet or invalidate data.
export function startDefaultSwapReads({wallet,active=()=>true,events=globalThis,request,service=swapService,readBalances=readWalletBalances,storage}={}) {
  let stopped=false,quoteController=null,balanceController=null,lastAccount,lastQuoteKey,stopWallet=()=>{};
  const allowed=()=>{try{return !stopped&&active();}catch{return false;}};
  const cancel=()=>{quoteController?.abort();balanceController?.abort();quoteController=balanceController=null;};
  const launch=work=>{try{Promise.resolve(work()).catch(()=>{});}catch{}};
  const fallback=request??((payload,{signal}={})=>swapPublicRpc(globalThis.fetch,signal,{lane:'balance'})(payload));
  const read=(payload,{signal}={})=>{
    // API balances work before the transaction library exists. A local fallback
    // must wait for a later page retry instead of starting extra startup work.
    if(typeof globalThis.ethers?.Interface!=='function')throw Error('SWAP_DEPENDENCY');
    return fallback(payload,{signal});
  };
  function update() {
    if(!allowed()){cancel();lastAccount=lastQuoteKey=undefined;return;}
    const account=wallet?.account||null,identity=typeof account==='string'?account.toLowerCase():'';
    const settings=settingsFrom(storage),quoteKey=JSON.stringify([settings.slippageBps,settings.singleHop]);
    // Price discovery has no account input. Restoring or switching a wallet
    // must not discard the first in-flight quote and restart the same work.
    if(!quoteController||lastQuoteKey!==quoteKey) {
      quoteController?.abort();quoteController=new AbortController();lastQuoteKey=quoteKey;
      const signal=quoteController.signal;
      launch(()=>service.quote({tokenIn:SWAP_TOKENS.usdt.address,tokenOut:SWAP_TOKENS.fist.address,amountIn:10n**18n,...settings},
        {router:swapActiveRouter(),adapters:SWAP_ADAPTERS,signal}));
    }
    if(identity!==lastAccount) {
      balanceController?.abort();balanceController=null;lastAccount=identity;
      if(/^0x[0-9a-f]{40}$/i.test(account||'')) {
        balanceController=new AbortController();const signal=balanceController.signal;
        launch(()=>readBalances(read,account,DEFAULT_TOKENS.map(token=>({...token})),{signal}));
      }
    }
  }
  const onStorage=event=>{if(!event.key||event.key==='swap_settings_v2')update();};
  try { stopWallet=wallet?.subscribe?.(update)||stopWallet; } catch {}
  events?.addEventListener?.('hashchange',update);
  events?.addEventListener?.('storage',onStorage);
  update();
  return function dispose() {
    if(stopped)return;stopped=true;cancel();stopWallet();events?.removeEventListener?.('hashchange',update);events?.removeEventListener?.('storage',onStorage);
  };
}
