import { swapService } from './swap-service-client.mjs?v=mainnet-20261111-23';
const MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11';
const ABI=['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function getEthBalance(address) view returns(uint256)','function balanceOf(address) view returns(uint256)'];

// A single BSC read for native BNB and token balances. Do not cache balances:
// every post-transaction refresh must see chain state, not a pre-send value.
export async function readTokenBalances(request,account,tokens) {
 if(!/^0x[0-9a-f]{40}$/i.test(account||''))throw new Error('Invalid balance account');
 const codec=new globalThis.ethers.Interface(ABI),balances={},failed=[];
 const entries=[...new Map(tokens.filter(Boolean).map(t=>[t.key,t])).values()];
 for(let start=0;start<entries.length;start+=64){
  const group=entries.slice(start,start+64),calls=group.map(t=>{
   const native=t.key==='bnb'&&!t.address,method=native?'getEthBalance':'balanceOf';
   return[native?MULTICALL:t.address,codec.encodeFunctionData(method,[account])];
  });
  let results;
  try {
   const raw=await request({method:'eth_call',params:[{to:MULTICALL,data:codec.encodeFunctionData('tryAggregate',[false,calls])},'latest']});
   results=codec.decodeFunctionResult('tryAggregate',raw)[0];
   if(results.length!==group.length)throw new Error('Incomplete balance response');
  } catch { failed.push(...group.map(t=>t.key));continue; }
  group.forEach((token,n)=>{
   const r=results[n],method=token.key==='bnb'&&!token.address?'getEthBalance':'balanceOf';
   try{if(!r.success)throw new Error('Balance unavailable');balances[token.key]=codec.decodeFunctionResult(method,r.returnData)[0];}
   catch{failed.push(token.key);}
  });
 }
 return{balances,failed};
}

// Short display cache shared by page transitions and the token picker. Transaction
// refreshes use fresh:true; account/chain changes invalidate all in-flight writes.
const balanceSnapshots=new Map();
export function invalidateWalletBalances(){balanceSnapshots.clear();}
export async function readWalletBalances(request,account,tokens,{fresh=false,clock=Date.now}={}){
 const wanted=tokens.filter(Boolean),owner=String(account).toLowerCase();
 const identity=t=>`${t.key}:${String(t.address||'native').toLowerCase()}`;
 const keys=wanted.map(identity);
 if(!fresh){
  for(const entry of balanceSnapshots.values()){
   if(entry.owner!==owner||!keys.every(k=>entry.keys.includes(k)))continue;
   if(entry.pending||clock()-entry.completedAt<3000){
    const result=await entry.promise;
    // An invalidated read may finish for its original caller, but must never
    // clear or replace the new account/transaction cache. Callers guard identity.
    return{balances:Object.fromEntries(wanted.filter(t=>result.balances[t.key]!=null).map(t=>[t.key,result.balances[t.key]])),failed:wanted.filter(t=>result.failed.includes(t.key)).map(t=>t.key)};
   }
  }
 }
 if(fresh){balanceSnapshots.clear();}
 const key=owner+':'+keys.join(','),entry={owner,keys,pending:true};
 entry.promise=(async()=>await swapService.balances(account,wanted)||await readTokenBalances(request,account,wanted))().then(result=>{entry.completedAt=clock();return result;}).finally(()=>{entry.pending=false;});
 balanceSnapshots.set(key,entry);if(balanceSnapshots.size>6)balanceSnapshots.delete(balanceSnapshots.keys().next().value);
 return entry.promise;
}
