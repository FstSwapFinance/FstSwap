// Transfer tax belongs to a verified token implementation and a real transfer
// edge, never to an arbitrary symbol or every pool containing that token.
const ZERO='0x'+'00'.repeat(20),BPS=10000n;
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);
const lower=value=>String(value).toLowerCase();
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const fail=()=>Object.assign(Error('无法可靠确认此代币的转账税，请勿使用税前报价作为到账数量'),{code:'TAX_UNVERIFIED'});
const FSTSI='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e';
const FSTSI_PAIR='0xec6abc1cbaef40878069245c2568401e56c949f1';
// Exact 6,647-byte mainnet PGToken runtime. SHA256 hashes raw bytecode bytes.
// Its compiled frozen source matches after masking constructor immutables.
const FSTSI_CODE_SHA256='7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed';
const SETTLEMENTS=new Set([ZERO,
 '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
 '0x0efb5fd2402a0967b92551d6af54de148504a115',
 '0x55d398326f99059ff775485246999027b3197955',
 '0xc9882def23bc42d53895b8361d0b1edc7570bc6a',
 '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
 '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
 '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
]);
const validRate=value=>typeof value==='bigint'&&value>=0n&&value<=BPS;
function tokensFor(tokens,blockNumber){
 if(!Array.isArray(tokens)||tokens.length>64||!quantity(blockNumber)||tokens.some(token=>!address(token)))throw fail();
 return [...new Set(tokens.map(lower))];
}
function pairModel(entry,blockNumber){
 if(entry.token!==FSTSI||entry.kind!=='pair'||entry.pair!==FSTSI_PAIR||entry.codeHash!==FSTSI_CODE_SHA256||entry.blockNumber!==blockNumber||!validRate(entry.buyBps)||!validRate(entry.sellBps))throw fail();
 return Object.freeze({kind:'pair',pair:FSTSI_PAIR,buyBps:entry.buyBps,sellBps:entry.sellBps,codeHash:FSTSI_CODE_SHA256,blockNumber});
}
export function transferModelsFromWire(entries,{tokens,blockNumber}){
 const required=tokensFor(tokens,blockNumber),models=new Map(required.filter(token=>SETTLEMENTS.has(token)).map(token=>[token,Object.freeze({kind:'none'})]));
 if(!Array.isArray(entries)||entries.length>64)throw fail();
 const seen=new Set();
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||!address(entry.token)||seen.has(lower(entry.token)))throw fail();
  const token=lower(entry.token);if(!required.includes(token))throw fail();seen.add(token);
  if(entry.kind==='none'){
   if(Object.keys(entry).some(key=>!['token','kind'].includes(key))||!SETTLEMENTS.has(token))throw fail();
   models.set(token,Object.freeze({kind:'none'}));
  }else{
   if(Object.keys(entry).some(key=>!['token','kind','pair','buyBps','sellBps','codeHash','blockNumber'].includes(key)))throw fail();
   models.set(token,pairModel({...entry,token,pair:address(entry.pair)?lower(entry.pair):entry.pair},blockNumber));
  }
 }
 if(required.some(token=>!models.has(token)))throw fail();
 return models;
}
export function transferTaxBps(model,from,to){
 if(!model||!address(from)||!address(to))throw fail();
 if(model.kind==='none')return 0n;
 if(model.kind!=='pair'||!address(model.pair)||!validRate(model.buyBps)||!validRate(model.sellBps))throw fail();
 return lower(from)===lower(model.pair)?model.buyBps:lower(to)===lower(model.pair)?model.sellBps:0n;
}
export function transferNet(gross,bps){
 if(typeof gross!=='bigint'||gross<0n||!validRate(bps))throw fail();
 // Solidity deducts floor(gross*bps/10000); rounding net down is a different tax.
 return gross-gross*bps/BPS;
}
async function runtimeHash(code){
 if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||code.length>200002)throw fail();
 const bytes=new Uint8Array((code.length-2)/2);
 for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(code.slice(2+i*2,4+i*2),16);
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function readTransferTaxes(request,{tokens,blockNumber,timestamp}){
 const required=tokensFor(tokens,blockNumber);
 if(typeof request!=='function'||required.includes(FSTSI)&&(!Number.isSafeInteger(timestamp)||timestamp<=0))throw fail();
 if(required.some(token=>!SETTLEMENTS.has(token)&&token!==FSTSI))throw fail();
 const entries=[];
 if(required.includes(FSTSI)){
  try{
   const I=globalThis.ethers.Interface;
   const abi=new I(['function pair() view returns(address)','function tradeTaxBps(bool) view returns(uint256)','function tradingOpenedAt() view returns(uint256)','function tradingOpenedBlock() view returns(uint256)','function protocolContext() view returns(bool)','function liquidityMode() view returns(uint8)','function feeProcessing() view returns(bool)']);
   const multi=new I(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
   const fields=[['pair',[]],['tradeTaxBps',[true]],['tradeTaxBps',[false]],['tradingOpenedAt',[]],['tradingOpenedBlock',[]],['protocolContext',[]],['liquidityMode',[]],['feeProcessing',[]]];
   const [codeHash,raw]=await Promise.all([
    request({method:'eth_getCode',params:[FSTSI,blockNumber]}).then(runtimeHash),
    request({method:'eth_call',params:[{to:'0xca11bde05977b3631167028862be2a173976ca11',data:multi.encodeFunctionData('tryAggregate',[false,fields.map(([name,args])=>[FSTSI,abi.encodeFunctionData(name,args)])])},blockNumber]}),
   ]);
   if(codeHash!==FSTSI_CODE_SHA256)throw fail();
   const results=multi.decodeFunctionResult('tryAggregate',raw)[0];
   if(results.length!==fields.length||results.some(entry=>!entry.success))throw fail();
   const [pair,buyBps,sellBps,openedAt,openedBlock,protocolContext,liquidityMode,feeProcessing]=results.map((entry,n)=>abi.decodeFunctionResult(fields[n][0],entry.returnData)[0]);
   if(openedAt<=0n||openedAt>BigInt(timestamp)-61n||openedBlock<=0n||openedBlock>BigInt(blockNumber)||protocolContext!==false||liquidityMode!==0n||feeProcessing!==false)throw fail();
   entries.push({token:FSTSI,kind:'pair',pair:lower(pair),buyBps,sellBps,codeHash,blockNumber});
  }catch(error){if(error?.name==='AbortError')throw error;throw fail();}
 }
 return transferModelsFromWire(entries,{tokens:required,blockNumber});
}
