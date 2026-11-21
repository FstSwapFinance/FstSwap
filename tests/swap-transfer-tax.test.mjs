import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Interface} from 'ethers';
import {readTransferTaxes,transferModelsFromWire,transferTaxBps,transferNet} from '../src/swap-transfer-tax.mjs';
globalThis.ethers={Interface};
const TOKEN='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e',PAIR='0xec6abc1cbaef40878069245c2568401e56c949f1',OTHER='0x'+'aa'.repeat(20),WBNB='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',USDT='0x55d398326f99059ff775485246999027b3197955';
const blockNumber='0x8094e65',timestamp=1795237291,codeHash='7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed';
const runtime=(await readFile(new URL('fixtures/fstsi-8a25-runtime.hex',import.meta.url),'utf8')).trim();
const multi=new Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const tokenAbi=new Interface(['function pair() view returns(address)','function tradeTaxBps(bool) view returns(uint256)','function tradingOpenedAt() view returns(uint256)','function tradingOpenedBlock() view returns(uint256)','function protocolContext() view returns(bool)','function liquidityMode() view returns(uint8)','function feeProcessing() view returns(bool)']);
function fixture(options={}){
 const calls=[];const values={pair:PAIR,buy:300n,sell:300n,openedAt:BigInt(timestamp-10000),openedBlock:1n,protocolContext:false,liquidityMode:0n,feeProcessing:false,...options};
 const request=async({method,params})=>{
  calls.push({method,params});assert.equal(params[1],blockNumber,'every tax read must use the original quote block');
  if(method==='eth_getCode')return options.code??runtime;
  assert.equal(method,'eth_call');const decoded=multi.decodeFunctionData('tryAggregate',params[0].data);assert.equal(decoded[0],false);
  const result=decoded[1].map((entry,index)=>{
   assert.equal(entry.target.toLowerCase(),TOKEN);const parsed=tokenAbi.parseTransaction({data:entry.callData});
   const value=parsed.name==='pair'?values.pair:parsed.name==='tradeTaxBps'?(parsed.args[0]?values.buy:values.sell):parsed.name==='tradingOpenedAt'?values.openedAt:parsed.name==='tradingOpenedBlock'?values.openedBlock:values[parsed.name];
   return{success:index!==options.failedIndex,returnData:index===options.failedIndex?'0x':tokenAbi.encodeFunctionResult(parsed.name,[value])};
  });return multi.encodeFunctionResult('tryAggregate',[result]);
 };return{request,calls};
}
const wire=(changes={})=>({token:TOKEN,kind:'pair',pair:PAIR,buyBps:300n,sellBps:300n,codeHash,blockNumber,...changes});
test('known settlement tokens stay tax-free without speculative token RPC',async()=>{
 const f=fixture();const models=await readTransferTaxes(f.request,{tokens:[USDT,WBNB],blockNumber,timestamp:undefined});
 assert.equal(models.get(USDT).kind,'none');assert.equal(models.get(WBNB).kind,'none');assert.equal(f.calls.length,0);
});
test('pinned runtime plus same-block metadata identifies directional canonical-pair taxes',async()=>{
 const f=fixture();const models=await readTransferTaxes(f.request,{tokens:[TOKEN,USDT,TOKEN.toUpperCase().replace('0X','0x')],blockNumber,timestamp});
 const model=models.get(TOKEN);assert.equal(model.kind,'pair');assert.equal(model.pair,PAIR);assert.equal(model.buyBps,300n);assert.equal(model.sellBps,300n);assert.equal(model.codeHash,codeHash);assert.equal(model.blockNumber,blockNumber);assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>c.method).sort(),['eth_call','eth_getCode']);
 assert.equal(transferTaxBps(model,PAIR,OTHER),300n);assert.equal(transferTaxBps(model,OTHER,PAIR),300n);assert.equal(transferTaxBps(model,OTHER,WBNB),0n);
});
test('pair-to-pair transfer is taxed once according to actual from/to and buy precedence',()=>{
 const model=wire({buyBps:500n,sellBps:300n});
 assert.equal(transferTaxBps(model,PAIR,OTHER),500n);assert.equal(transferTaxBps(model,OTHER,PAIR),300n);assert.equal(transferTaxBps(model,PAIR,PAIR),500n);
 assert.equal(transferNet(101n,300n),98n);assert.equal(transferNet(1n,300n),1n);assert.equal(transferNet(0n,300n),0n);assert.equal(transferNet(10000n,10000n),0n);
});
test('unknown token and changed runtime cannot claim a zero-tax reliable quote',async()=>{
 for(const tokens of [[OTHER],[TOKEN,OTHER]]){const f=fixture();await assert.rejects(readTransferTaxes(f.request,{tokens,blockNumber,timestamp}),{code:'TAX_UNVERIFIED'});}
 const f=fixture({code:runtime.slice(0,-2)+'00'});await assert.rejects(readTransferTaxes(f.request,{tokens:[TOKEN],blockNumber,timestamp}),{code:'TAX_UNVERIFIED'});
});
test('active exemptions, closed trading, launch tax window, wrong pair and failed reads reject',async()=>{
 for(const options of [{protocolContext:true},{liquidityMode:1n},{feeProcessing:true},{openedAt:0n},{openedAt:BigInt(timestamp-60)},{openedAt:BigInt(timestamp+1)},{openedBlock:BigInt(blockNumber)+1n},{pair:OTHER},{failedIndex:1},{buy:10001n}]){
  const f=fixture(options);await assert.rejects(readTransferTaxes(f.request,{tokens:[TOKEN],blockNumber,timestamp}),{code:'TAX_UNVERIFIED'},JSON.stringify(options,(_,v)=>typeof v==='bigint'?String(v):v));
 }
});
test('a changed future dynamic rate is read anew rather than cached as three percent',async()=>{
 const a=await readTransferTaxes(fixture({buy:400n,sell:700n}).request,{tokens:[TOKEN],blockNumber,timestamp});
 assert.equal(a.get(TOKEN).buyBps,400n);assert.equal(a.get(TOKEN).sellBps,700n);
});
test('wire tax models are constrained by pinned address, code, pair and exact quote block',()=>{
 const models=transferModelsFromWire([wire()],{tokens:[TOKEN,USDT],blockNumber});assert.equal(models.get(TOKEN).buyBps,300n);assert.equal(models.get(USDT).kind,'none');
 for(const entry of [wire({pair:OTHER}),wire({token:OTHER}),wire({codeHash:'00'.repeat(32)}),wire({blockNumber:'0x8094e66'}),wire({buyBps:300}),wire({sellBps:-1n}),wire({buyBps:10001n}),wire({exempt:true})])assert.throws(()=>transferModelsFromWire([entry],{tokens:[TOKEN],blockNumber}),{code:'TAX_UNVERIFIED'});
 assert.throws(()=>transferModelsFromWire([],{tokens:[TOKEN],blockNumber}),{code:'TAX_UNVERIFIED'});
 assert.throws(()=>transferModelsFromWire([wire(),wire()],{tokens:[TOKEN],blockNumber}),{code:'TAX_UNVERIFIED'});
 assert.throws(()=>transferModelsFromWire([wire()],{tokens:[USDT],blockNumber}),{code:'TAX_UNVERIFIED'});
 assert.throws(()=>transferModelsFromWire([{token:OTHER,kind:'none'}],{tokens:[OTHER],blockNumber}),{code:'TAX_UNVERIFIED'});
});
test('pure tax calculation rejects malformed values instead of returning an optimistic net',()=>{
 for(const [gross,bps]of [[1,300n],[-1n,300n],[1n,-1n],[1n,10001n]])assert.throws(()=>transferNet(gross,bps));
 assert.throws(()=>transferTaxBps(null,PAIR,OTHER),{code:'TAX_UNVERIFIED'});
});
