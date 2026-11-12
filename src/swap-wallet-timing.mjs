// Opt-in diagnostics only. No request identity, payload, address or result is
// accepted here; a send invocation is distinct from a visible wallet UI.
const phases=new Set(['click','warm_hit','warm_miss','warm_pending','allowance_refresh_only','approval_refreshed',
 'lock_wait','lock_acquired','recovery_done','guard_start','guard_done','prepare_start','prepare_done',
 'final_guard_start','final_guard_done','send_invoked','wallet_result','wallet_error','finished',
 ...['WRONG_CHAIN','WALLET_CHANGED','TARGET_MISSING','REQUEST_CHANGED','UNSAFE_QUOTE','TX_PENDING','WALLET_BUSY','REQUEST_TIMEOUT','ABORTED','REJECTED','OTHER'].map(code=>'failed_'+code),
 ...['public_config','public_policy','public_allowance','public_gas','wallet_simulation','warm_canonical'].flatMap(name=>[name+'_start',name+'_end'])]);
const emit=(record,phase)=>{try{record?.(phase);}catch{/* Diagnostics never control a wallet request. */}};
export function createWalletTiming({search=globalThis.location?.search||'',clock=()=>globalThis.performance.now(),limit=64,output=(...args)=>globalThis.console?.debug(...args)}={}){
 let enabled=false;try{enabled=new URLSearchParams(search).get('debug')==='wallet-timing';}catch{}
 let rows=[],sequence=0;
 const snapshot=()=>rows.map(row=>({id:row.id,operation:row.operation,events:row.events.map(event=>({...event}))}));
 const clear=()=>{rows=[];};
 const capacity=Number.isInteger(limit)&&limit>0?Math.min(limit,64):64;
 function begin(operation){
  if(!enabled||!['approve','swap'].includes(operation))return;
  let start;try{start=clock();}catch{return;}if(!Number.isFinite(start))return;
  const row={id:++sequence,operation,events:[]};rows.push(row);if(rows.length>capacity)rows.shift();
  let finished=false;
  const record=phase=>{
   if(finished||!phases.has(phase)||row.events.length>=128)return;
   try{
    const elapsed=clock()-start;if(!Number.isFinite(elapsed)||elapsed<0)return;
    const ms=Math.round(elapsed*10)/10;row.events.push({phase,ms});
    if(phase==='finished')finished=true;
    try{output('[FstSwap wallet timing]',operation+'#'+row.id,phase,ms);}catch{}
   }catch{}
  };
  record('click');return record;
 }
 const api=Object.freeze({enabled,begin,snapshot,clear});
 return api;
}
export function timeWalletPhase(record,name,run){
 if(!record)return run();
 emit(record,name+'_start');
 let result;try{result=run();}catch(error){emit(record,name+'_end');throw error;}
 return Promise.resolve(result).finally(()=>emit(record,name+'_end'));
}
export function walletTimingFailure(record,error){
 if(!record)return;
 const code=error?.name==='AbortError'?'ABORTED':Number(error?.code)===4001?'REJECTED':String(error?.code);
 emit(record,phases.has('failed_'+code)?'failed_'+code:'failed_OTHER');
}
