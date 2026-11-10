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
