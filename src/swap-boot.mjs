import {startDefaultSwapReads} from './swap-startup.mjs?v=mainnet-20261112-46';

// This entry deliberately has no UI/wallet dependency. Its consumer joins the
// same service pending request and original two-second completed cache as app.
export function startEarlyDefaultQuote({events=globalThis,document=globalThis.document,location=globalThis.location,...options}={}) {
  const active=()=>{
    const route=(location?.hash||'#/swap').replace(/^#\//,'').split(/[/?]/)[0]||'swap';
    return route==='swap'||!['analysis','pool','add','remove','my'].includes(route);
  };
  const stop=startDefaultSwapReads({...options,events,active,wallet:{account:null,subscribe(update){update();return()=>{};}}});
  let stopped=false;
  const dispose=()=>{
    if(stopped)return;stopped=true;stop();
    document?.removeEventListener?.('input',onInput,true);
    document?.removeEventListener?.('click',onSelection,true);
    events?.removeEventListener?.('pagehide',dispose);
  };
  // Once the user changes the form, the mounted view owns the active quote.
  // Detach only this speculative consumer; never abort the view's subscriber.
  const onInput=event=>{if(event.target?.closest?.('#swap-currency-input input'))dispose();};
  const onSelection=event=>{if(event.target?.closest?.('.open-currency-select-button, .hDVbXn, #open-settings-dialog-button'))dispose();};
  document?.addEventListener?.('input',onInput,true);
  document?.addEventListener?.('click',onSelection,true);
  events?.addEventListener?.('pagehide',dispose,{once:true});
  return dispose;
}

if(globalThis.document&&globalThis.location)startEarlyDefaultQuote();
