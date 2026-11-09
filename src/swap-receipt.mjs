// Recognize the wallet execution separately from its outer transaction envelope.
// MetaMask Delegation Framework v1.3.0 (BSC):
// https://github.com/MetaMask/delegation-framework/blob/main/documents/Deployments.md
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
const manager='0xdb9b1e94b5b69df7e401ddbede43491141047db3';
const delegationType='tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)';
function matchesCallData(tx,expected,receipt) {
 if(same(tx.input,expected.data))return true;
 // Wallets may reduce ERC20 approval limits in their confirmation screen.
 // Accept only that change, for the same spender, with the emitted amount.
 const actual=String(tx.input||'').toLowerCase(),planned=String(expected.data||'').toLowerCase();
 if(!/^0x095ea7b3[0-9a-f]{128}$/.test(actual)||!/^0x095ea7b3[0-9a-f]{128}$/.test(planned)||actual.slice(0,74)!==planned.slice(0,74))return false;
 if(BigInt('0x'+actual.slice(74))>BigInt('0x'+planned.slice(74)))return false;
 if(BigInt(receipt.status)===0n)return true;
 const owner='0x'+String(expected.from).slice(2).toLowerCase().padStart(64,'0');
 const spender='0x'+actual.slice(10,74),amount='0x'+actual.slice(74);
 return receipt.logs?.some(log=>same(log.address,expected.to)&&log.topics?.length===3&&
  same(log.topics[0],'0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925')&&
  same(log.topics[1],owner)&&same(log.topics[2],spender)&&same(log.data,amount))||false;
}

export function matchesWalletExecution(tx,receipt,expected,{allowApprovalReduction=false}={}) {
 try {
  if(!same(tx.from,expected.from)||!same(receipt.from,expected.from)||!same(receipt.to,tx.to))return false;
  if(tx.chainId!=null&&BigInt(tx.chainId)!==56n)return false;
  if(expected.nonce!=null&&BigInt(tx.nonce)!==BigInt(expected.nonce))return false;
  const matches=call=>same(call.to,expected.to)&&BigInt(call.value)===BigInt(expected.value||0)&&
   (same(call.input,expected.data)||(allowApprovalReduction&&matchesCallData(call,expected,receipt)));
  if(matches(tx))return true;
  // A wallet may submit redeemDelegations with value=0 and the dapp call packed inside.
  // Support the known single, atomic execution only; never accept a type-4 receipt by status alone.
  if(!same(tx.to,manager)||BigInt(tx.value)!==0n)return false;
  const {Interface,AbiCoder}=globalThis.ethers;
  const iface=new Interface(['function redeemDelegations(bytes[],bytes32[],bytes[])',
   'event RedeemedDelegation(address indexed rootDelegator,address indexed redeemer,'+delegationType+' delegation)']);
  const args=iface.decodeFunctionData('redeemDelegations',tx.input);
  if(!same(iface.encodeFunctionData('redeemDelegations',args),tx.input))return false;
  const [contexts,modes,executions]=args;
  if(contexts.length!==1||modes.length!==1||executions.length!==1||!/^0x0{64}$/.test(modes[0]))return false;
  const coder=AbiCoder.defaultAbiCoder(),[delegations]=coder.decode([delegationType+'[]'],contexts[0]);
  if(!same(coder.encode([delegationType+'[]'],[delegations]),contexts[0]))return false;
  if(delegations.length>1)return false;
  if(delegations.length===1){
   const d=delegations[0];
   if(!same(d.delegate,expected.from)||!same(d.delegator,expected.from)||!/^0xf{64}$/i.test(d.authority))return false;
   if(BigInt(receipt.status)===1n&&!receipt.logs?.some(log=>{
    if(!same(log.address,manager)||log.removed)return false;
    try {const event=iface.parseLog(log);return event?.name==='RedeemedDelegation'&&same(event.args.rootDelegator,expected.from)&&
     same(event.args.redeemer,expected.from)&&same(coder.encode([delegationType],[event.args.delegation]),coder.encode([delegationType],[d]));}catch{return false;}
   }))return false;
  }
  const packed=executions[0];if(!/^0x[0-9a-f]+$/i.test(packed)||packed.length<106)return false;
  return matches({to:packed.slice(0,42),value:'0x'+packed.slice(42,106),input:'0x'+packed.slice(106)});
 } catch {return false;}
}
