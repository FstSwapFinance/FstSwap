// Deterministic local model benchmark. No URL, wallet, secret, or broadcast path.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {ethers} from 'ethers';
import {quoteFstRoutes,fstRequiresLinearV2,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {readTransferTaxes} from '../src/swap-transfer-tax.mjs';
import {SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter} from '../src/swap-aggregator.mjs';

globalThis.ethers=ethers;
const ROOT=new URL('../',import.meta.url),BASELINE='59b91a52ca69a21f80cbbba1ce03013e97d47215';
const output=process.env.FST_TAX_BENCH_OUTPUT||fileURLToPath(new URL('../docs/reviews/tax-quote-benchmark-20261121.json',import.meta.url));
const samples=20,warmups=2,rpcDelayMs=3,sha=s=>createHash('sha256').update(s).digest('hex');
const source=execFileSync('git',['show',`${BASELINE}:src/swap-fstswap.mjs`],{cwd:ROOT,encoding:'utf8'});
const marker=source.indexOf('export async function quoteFstRoutes('),end=source.indexOf('\nexport async function quoteFstSwap(',marker);
assert.ok(marker>=0&&end>marker,'baseline source extraction must be complete');
const functionSource=source.slice(marker,end).replace('export async function','async function');
const baseline=new Function('SWAP_ADAPTERS','SWAP_ABI','swapActiveRouter','fstRequiresLinearV2',`const ZERO='0x'+'00'.repeat(20),BPS=10000n;const lower=x=>String(x||ZERO).toLowerCase();const noRoute=()=>Object.assign(Error('no route'),{code:'NO_ROUTE'});${functionSource};return quoteFstRoutes;`)(SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter,fstRequiresLinearV2);
const afterSource=await readFile(new URL('src/swap-fstswap.mjs',ROOT));
const taxSource=await readFile(new URL('src/swap-transfer-tax.mjs',ROOT));
const A=n=>'0x'+n.toString(16).padStart(40,'0'),U=FST_FEE_ASSETS.USDT,C=FST_FEE_ASSETS.USDC,T=A(0xa1);
const fst=SWAP_ADAPTERS.fst.adapter.toLowerCase(),pancake=SWAP_ADAPTERS.pancake.adapter.toLowerCase(),block='0x123';
const router=new ethers.Interface(SWAP_ABI),multi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const delay=()=>new Promise(resolve=>setTimeout(resolve,rpcDelayMs));
const cases=[
 {id:'ordinary-direct',label:'普通结算币直达，无转账税',from:U,to:C,specs:[[1,fst,U,C]],pair:null,expectedBestNet:20000n,expectedPools:[A(1)]},
 {id:'canonical-buy',label:'canonical 池买入，输出税 3%',from:U,to:T,specs:[[1,fst,U,T]],pair:A(1),expectedBestNet:19400n,expectedPools:[A(1)]},
 {id:'canonical-sell',label:'canonical 池卖出，实际入池扣 3%',from:T,to:U,specs:[[1,fst,T,U]],pair:A(1),expectedBestNet:19400n,expectedPools:[A(1)]},
 {id:'pair-to-pair-buy',label:'canonical → other pair，买税只扣一次',from:U,to:C,specs:[[1,fst,U,T],[2,pancake,T,C]],pair:A(1),expectedBestNet:38800n,expectedPools:[A(1),A(2)]},
 {id:'pair-to-pair-sell',label:'other → canonical pair，卖税只扣一次',from:U,to:C,specs:[[1,fst,U,T],[2,pancake,T,C]],pair:A(2),expectedBestNet:38800n,expectedPools:[A(1),A(2)]},
 {id:'net-winner',label:'毛额 20000 的含税池应输给净额 19800 的无税池',from:U,to:T,specs:[[1,fst,U,T],[2,pancake,U,T,198n,100n]],pair:A(1),expectedBestNet:19800n,expectedPools:[A(2)]},
];

function fixture(c){
 const pools=new Map(),models=new Map(),calls=[];
 for(const [id,adapter,token0,token1,numerator=2n,denominator=1n]of c.specs){
  const p={id:String(id),address:A(id),adapter,token0,token1,kind:'v2',reserves:[1000000n*denominator,1000000n*numerator],numerator,denominator};
  pools.set(p.id,p);models.set(adapter+':'+[token0,token1].sort().join(':'),p);
 }
 const transferTaxes=new Map([...new Set(c.specs.flatMap(s=>[s[2],s[3]]))].map(t=>[t,t===T&&c.pair?{kind:'pair',pair:c.pair,buyBps:300n,sellBps:300n,codeHash:'0x'+'ab'.repeat(32),blockNumber:block}:{kind:'none'}]));
 const request=async({method,params})=>{
  assert.equal(method,'eth_call');assert.equal(params[1],block);await delay();
  const [,batch]=multi.decodeFunctionData('tryAggregate',params[0].data);
  const decoded=batch.map(call=>{
   const tx=router.parseTransaction({data:call.callData});assert.equal(tx.name,'getAmountsOutVia');
   const [adapter,amount,path]=tx.args,tokens=[...path].map(x=>x.toLowerCase()),m=models.get(adapter.toLowerCase()+':'+[...tokens].sort().join(':'));assert.ok(m);
   const out=tokens[0]===m.token0?amount*m.numerator/m.denominator:amount*m.denominator/m.numerator;
   return{amount,out};
  });calls.push(decoded);
  return multi.encodeFunctionResult('tryAggregate',[decoded.map(x=>[true,router.encodeFunctionResult('getAmountsOutVia',[[x.amount,x.out]])])]);
 };
 const policy={pools,blockNumber:block,timestamp:1800000000,allowsRoute:()=>true,assertFresh(){}};
 return{request,calls,models,options:{from:c.from,to:c.to,amount:10000n,policy,configVersion:'2.1.0',linearV2Only:true,transferTaxes}};
}

// Independent transfer-graph replay of the chosen route. It does not consume
// the new quote's poolAmountIn, grossOut, net fields, or tax metadata.
function executionModel(c,legs,models){
 let amount=10000n;
 const transfer=(value,token,from,to)=>token===T&&c.pair&&(from===c.pair||to===c.pair)?value-value*3n/100n:value;
 for(let n=0;n<legs.length;n++){
  const leg=legs[n],pair=leg.poolIds[0].toLowerCase(),next=legs[n+1]?.poolIds[0].toLowerCase()||A(99);
  if(n===0)amount=transfer(amount,leg.tokenIn,A(99),pair);
  const m=models.get(leg.adapter.toLowerCase()+':'+[...leg.path].map(x=>x.toLowerCase()).sort().join(':'));assert.ok(m);
  amount=leg.path[0].toLowerCase()===m.token0?amount*m.numerator/m.denominator:amount*m.denominator/m.numerator;
  amount=transfer(amount,leg.tokenOut,pair,next);
 }
 return amount;
}
const percentile=(values,p)=>{const a=[...values].sort((x,y)=>x-y);return a[Math.max(0,Math.ceil(a.length*p)-1)];};
const rounded=n=>Number(n.toFixed(3));
const stats=rows=>({outerRpcCalls:rows[0].outerRpcCalls,innerContractCalls:rows[0].innerContractCalls,medianMs:rounded(percentile(rows.map(r=>r.elapsedMs),.5)),p95Ms:rounded(percentile(rows.map(r=>r.elapsedMs),.95)),reportedOut:rows[0].reportedOut,selectedPoolIds:rows[0].selectedPoolIds,modeledActualNetOut:rows[0].modeledActualNetOut,netOverstatement:rows[0].netOverstatement,shortfallAgainstBestNet:rows[0].shortfallAgainstBestNet});
async function run(fn,c){
 const f=fixture(c),start=performance.now(),q=await fn(f.request,f.options),elapsedMs=performance.now()-start;
 const actual=executionModel(c,q.legs,f.models);
 return{outerRpcCalls:f.calls.length,innerContractCalls:f.calls.reduce((n,c)=>n+c.length,0),elapsedMs,reportedOut:q.out,selectedPoolIds:q.legs.flatMap(l=>l.poolIds).map(x=>x.toLowerCase()),modeledActualNetOut:actual,netOverstatement:q.out-actual,shortfallAgainstBestNet:c.expectedBestNet-actual};
}
const result=[];
for(const c of cases){
 for(let n=0;n<warmups;n++){await run(baseline,c);await run(quoteFstRoutes,c);}
 const before=[],after=[];
 for(let n=0;n<samples;n++){
  if(n%2===0){before.push(await run(baseline,c));after.push(await run(quoteFstRoutes,c));}
  else{after.push(await run(quoteFstRoutes,c));before.push(await run(baseline,c));}
 }
 for(const row of after){assert.equal(row.reportedOut,c.expectedBestNet,c.id+': corrected net output');assert.equal(row.netOverstatement,0n);assert.deepEqual(row.selectedPoolIds,c.expectedPools);}
 for(const rows of [before,after])assert.ok(rows.every(row=>row.outerRpcCalls===rows[0].outerRpcCalls&&row.innerContractCalls===rows[0].innerContractCalls&&row.reportedOut===rows[0].reportedOut));
 result.push({id:c.id,label:c.label,inputBaseUnits:'10000',expectedBestNet:c.expectedBestNet,before:stats(before),after:stats(after),profileNetworkNote:c.pair?'Trusted synthetic map isolates route work; verified token profile acquisition is measured separately below.':'Known settlement profile adds zero token metadata RPC.'});
}

// The actual profile reader is exercised independently with the committed mainnet
// bytecode fixture, while metadata and network delay remain explicitly simulated.
const TOKEN='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e',PAIR='0xec6abc1cbaef40878069245c2568401e56c949f1',profileBlock='0x8094e65',timestamp=1795237291;
const runtime=(await readFile(new URL('tests/fixtures/fstsi-8a25-runtime.hex',ROOT),'utf8')).trim();
const tokenAbi=new ethers.Interface(['function pair() view returns(address)','function tradeTaxBps(bool) view returns(uint256)','function tradingOpenedAt() view returns(uint256)','function tradingOpenedBlock() view returns(uint256)','function protocolContext() view returns(bool)','function liquidityMode() view returns(uint8)','function feeProcessing() view returns(bool)']);
async function profileRun(tokens){
 const calls=[],start=performance.now();
 const request=async({method,params})=>{
  assert.equal(params[1],profileBlock);calls.push({method,inner:0});const row=calls.at(-1);await delay();
  if(method==='eth_getCode')return runtime;
  assert.equal(method,'eth_call');const [,batch]=multi.decodeFunctionData('tryAggregate',params[0].data);row.inner=batch.length;
  return multi.encodeFunctionResult('tryAggregate',[batch.map(c=>{
   const tx=tokenAbi.parseTransaction({data:c.callData});
   const value=tx.name==='pair'?PAIR:tx.name==='tradeTaxBps'?300n:tx.name==='tradingOpenedAt'?BigInt(timestamp-10000):tx.name==='tradingOpenedBlock'?1n:tx.name==='liquidityMode'?0n:false;
   return[true,tokenAbi.encodeFunctionResult(tx.name,[value])];
  })]);
 };
 const models=await readTransferTaxes(request,{tokens,blockNumber:profileBlock,timestamp});
 assert.ok(tokens.every(t=>models.has(t)));
 return{elapsedMs:performance.now()-start,outerRpcCalls:calls.length,innerContractCalls:calls.reduce((n,c)=>n+c.inner,0),methods:calls.map(c=>c.method).sort()};
}
const profiles=[];
for(const [label,tokens]of [['known-settlement',[U,C]],['verified-tax-token',[TOKEN,U]]]){
 const rows=[];for(let n=0;n<samples;n++)rows.push(await profileRun(tokens));
 assert.equal(rows[0].outerRpcCalls,label==='known-settlement'?0:2);
 profiles.push({label,before:{outerRpcCalls:0,innerContractCalls:0,note:'Baseline does not verify transfer taxes.'},after:{outerRpcCalls:rows[0].outerRpcCalls,innerContractCalls:rows[0].innerContractCalls,methods:rows[0].methods,medianMs:rounded(percentile(rows.map(r=>r.elapsedMs),.5)),p95Ms:rounded(percentile(rows.map(r=>r.elapsedMs),.95))}});
}
const report={scope:'Simulated fixed-condition local benchmark; not public-network latency, real trade simulation, or mainnet settlement.',baselineCommit:BASELINE,baselineQuoteFileSHA256:sha(source),patchedQuoteFileSHA256:sha(afterSource),patchedTaxFileSHA256:sha(taxSource),parameters:{samplesPerSide:samples,warmupSamplesPerSide:warmups,outerRpcDelayMs:rpcDelayMs,fixedInputBaseUnits:'10000',routeMode:'linear V2',taxModel:'synthetic canonical-pair directional 300 bps, neutral recipient, no exemptions',profileFixture:'committed real FSTSI runtime bytecode; metadata responses simulated',timing:'paired before/after order alternates; latency includes real ABI decode/encode and production quote code; profile time is separate, not hidden in route cache'},results:result,profileAcquisition:profiles,findings:{allCorrectedNetOutputsMatchExecutionModel:true,routeQuoteRpcCountUnchanged:result.every(r=>r.before.outerRpcCalls===r.after.outerRpcCalls),verifiedTaxProfileAddsOuterRpcCalls:2,verifiedTaxProfileAddsMetadataContractCalls:8,networkOperations:'none; all RPC methods are in-process stubs with fixed delay',privateKeyOrWalletOperations:'none'}};
const json=JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
await mkdir(new URL('.',new URL('file://'+output)),{recursive:true});await writeFile(output,json);
const ms=n=>n.toFixed(3),text=[
 '# 收税币报价补丁同条件对比（模拟数据）','',
 '**范围：本地合成池／税模型、固定 3 ms RPC 延迟；不是公网报价速度，不是真实钱包成交或链上结算验收。**','',
 `基线 commit：\`${BASELINE}\`。补丁文件 SHA256：\`${report.patchedQuoteFileSHA256}\`。`,
 `每侧每场景 ${samples} 次，预热 ${warmups} 次；前后顺序交替。均使用相同池模型、输入基础单位、ABI 和固定 RPC 延迟。`,'',
 '| 场景 | RPC 前→后 | 合约子调用 前→后 | 中位耗时 ms 前→后 | p95 ms 前→后 | 报价数额 前→后 | 基线选中路线实际净额 | 正确最佳净额 |',
 '|---|---:|---:|---:|---:|---:|---:|---:|',
 ...result.map(r=>`| ${r.label} | ${r.before.outerRpcCalls}→${r.after.outerRpcCalls} | ${r.before.innerContractCalls}→${r.after.innerContractCalls} | ${ms(r.before.medianMs)}→${ms(r.after.medianMs)} | ${ms(r.before.p95Ms)}→${ms(r.after.p95Ms)} | ${r.before.reportedOut}→${r.after.reportedOut} | ${r.before.modeledActualNetOut} | ${r.expectedBestNet} |`),'',
 '数额均为合成模型的整数基础单位，不代表某个真实代币的显示数量。基线的净额由独立转账图重放计算，不使用补丁返回的净额字段。',
 '最后一项场景中，基线选择毛额 20000、实际净额 19400 的池；补丁选择实际净额 19800 的另一池。证明修复影响选路，不只是显示扣税。','',
 '## 税模型确认开销单列','',
 '上表为已取得可信税模型后的 route-only 测量。不能把它当成冷启动完整报价时间。实际税确认读取没有被省略或藏进缓存：','',
 '| 类型 | 原有额外 RPC | 补丁额外 RPC | 额外合约子调用 | 补丁读取中位／p95 ms |',
 '|---|---:|---:|---:|---:|',
 ...profiles.map(r=>`| ${r.label} | 0 | ${r.after.outerRpcCalls} | ${r.after.innerContractCalls} | ${ms(r.after.medianMs)} / ${ms(r.after.p95Ms)} |`),'',
 '收税币确认会并行执行同一区块的 eth_getCode 和包含 8 个方法的 Multicall。这里运行实际 reader 与真实 runtime fixture，但元数据和 3 ms 网络延迟仍为模拟。普通已知结算资产不增加该读取。',
 '因此冷态完整报价 RPC 次数应在该场景 route 次数上另加 2；额外等待取决于真实节点、并发和哈希核对，而不是从 route-only 表推断出无开销。','',
 '## 正确性与限制','',
 '- 六个补丁场景的报价均与独立转账图净到账模型精确一致；普通币 route RPC 次数未增加。',
 '- 未对合约、平台费率或用户滑点做修改；本表隔离纯路线计算，平台费与最低到账另由回归测试覆盖。',
 '- 该比较不证明任意收税币可安全支持。无法验证 token 实现／canonical pair／动态税率时仍应拒绝可信到账承诺。',
 '- 真实 FSTSI 主网的 runtime、税率与业务状态另按只读证据核查；本 benchmark 不发任何网络请求，不读取账户或私钥，也不签名／广播。','',
 '复现：`node tools/quote-tax-benchmark.mjs`。可用 `FST_TAX_BENCH_OUTPUT` 指定 JSON 路径；Markdown 写到相同路径的 `.md`。','',
];
await writeFile(output.replace(/\.json$/,'.md'),text.join('\n'));
console.log(JSON.stringify({output,scenarios:result.length,samplesPerSide:samples,correctedNetChecks:true,profileRpc:profiles.map(p=>({label:p.label,rpc:p.after.outerRpcCalls})),patchedQuoteFileSHA256:report.patchedQuoteFileSHA256}));
