import {loadSwapWalletConnect, walletConnectAccount} from "../src/swap-wallet.mjs?v=deploy-20261110";
import {runDeploymentSequence} from "./deploy-fstswap-flow.mjs";
const {ethers}=globalThis;
const $=id=>document.getElementById(id);
const manifest=await fetch('../contracts/fstswap/deployment/mainnet-manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('部署资料未生成');return r.json();});
const digest=ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({chainId:manifest.chainId,owner:manifest.owner,deployer:manifest.deployer,feeReceiver:manifest.feeReceiver,platformFeeBps:manifest.platformFeeBps,defaultFeeToken:manifest.defaultFeeToken,dependencies:manifest.dependencies,contracts:Object.fromEntries(Object.entries(manifest.contracts).map(([k,v])=>[k,v.bytecodeHash]))})));
if(manifest.chainId!==56||manifest.platformFeeBps!==30||!ethers.isAddress(manifest.owner)||!ethers.isAddress(manifest.feeReceiver)||manifest.defaultFeeToken.toLowerCase()!=='0x55d398326f99059ff775485246999027b3197955')throw Error('部署配置与已确认参数不符');
const key='fstswap-mainnet-deployment:2.0.0';
let state=JSON.parse(localStorage.getItem(key)||'null')||{manifestDigest:digest,chainId:56,records:[]};
let wallet,account,pending,busy=false;
const adapters=[['fst','FstSwapAdapter56'],['pancake','PancakeAdapter56'],['biswap','BiSwapAdapter56'],['v3','PancakeV3Adapter']];
const steps=[{key:'router',name:'部署 FstSwap 主路由',contract:'FstSwap'},...adapters.map(([key,contract])=>({key,name:'部署 '+contract,contract})),...adapters.map(([key])=>({key:'register-'+key,name:'管理员登记 '+key,adapter:key}))];
const rpcUrls=['https://bsc-dataseed.bnbchain.org','https://fast.bsc-rpc.com'];
async function read(method,params=[]){let last;for(const url of rpcUrls){try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});const j=await r.json();if(j.error)throw Error(j.error.message);if(j.result===undefined)throw Error('RPC 空响应');return j.result;}catch(e){last=e;}}throw last;}
function status(text){$('status').textContent=text;}
function save(){localStorage.setItem(key,JSON.stringify(state));}
function table(id,entries){$(id).replaceChildren();for(const [label,value] of entries){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);$(id).append(dt,dd);}}
function record(key){return state.records.find(r=>r.step===key&&r.verified);}
function address(key){return record(key)?.contractAddress;}
function current(){return steps.find(s=>!record(s.key));}
const validJobId=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
function renderStart(){if(!$('start'))return;const done=!current(),retry=!state.completedSynced||!validJobId(state.completedJobId)||['failed','source-pending','status-unavailable'].includes(state.completedPhase);$('start').disabled=busy||!account||!manifest.readyForSigning||manifest.status==='deployed'||(done&&!retry);$('start').textContent=done?(retry?'重试记录同步':state.completedPhase==='complete'?'部署完成':'正在核验与开源…'):'开始／继续部署';}
function render(){renderStart();table('config',[['网络','BSC 主网 · chainId 56'],['部署钱包',manifest.deployer],['管理员',manifest.owner],['手续费接收',manifest.feeReceiver],['平台费率',(manifest.platformFeeBps/100)+'%（'+manifest.platformFeeBps+' bps）'],['默认收费币',manifest.defaultFeeToken],['收费资产','USDT / FIST / BNB / WBNB / ETH / USDC'],['版本',manifest.release],['资料摘要',digest]]);$('validation').textContent=manifest.status==='deployed'?'FstSwap 已部署到 BSC 主网：'+manifest.deployedConfig.router+'。无需重复部署。':manifest.readyForSigning?'部署资料已准备，等待钱包签名。':'部署前验证尚未全部完成，签名按钮保持关闭。';$('steps').replaceChildren(...steps.map(s=>{const li=document.createElement('li');const r=record(s.key);li.textContent=(r?'✓ ':'○ ')+s.name;if(r){const a=document.createElement('a');a.href='https://bscscan.com/tx/'+r.hash;a.textContent=' 查看链上交易';a.target='_blank';a.rel='noopener';li.append(a);}return li;}));$('wallet').textContent=account?'当前钱包：'+account:'未连接钱包';}
async function mainnetCheck(){if(BigInt(await wallet.request({method:'eth_chainId'}))!==56n)throw Error('请在钱包中切换到 BSC 主网');const canonical=await read('eth_getBlockByNumber',['latest',false]);const block=await wallet.request({method:'eth_getBlockByNumber',params:[canonical.number,false]});if(!block||block.hash.toLowerCase()!==canonical.hash.toLowerCase())throw Error('钱包网络与公开 BSC 主网区块不一致');}
function args(step){if(step.key==='router')return[manifest.feeReceiver,manifest.platformFeeBps,manifest.owner];if(step.key==='v3')return[address('router'),manifest.dependencies.wbnb,manifest.dependencies.v3Quoter];return[address('router')];}
function transaction(step){if(step.contract){const a=manifest.contracts[step.contract];if(ethers.keccak256(a.bytecode)!==a.bytecodeHash)throw Error('编译产物摘要不符');const factory=new ethers.ContractFactory(a.abi,a.bytecode);return factory.getDeployTransaction(...args(step)).then(tx=>({data:tx.data,value:'0x0'}));}return Promise.resolve({to:address('router'),value:'0x0',data:new ethers.Interface(manifest.contracts.FstSwap.abi).encodeFunctionData('setAdapter',[address(step.adapter),step.adapter==='v3'?1:0,true])});}
async function call(to,contract,method,values=[]){const i=new ethers.Interface(manifest.contracts[contract].abi);const out=await read('eth_call',[{to,data:i.encodeFunctionData(method,values)},'latest']);return i.decodeFunctionResult(method,out)[0];}
function same(a,b){return String(a).toLowerCase()===String(b).toLowerCase();}
async function verifyCode(to,name){const code=await read('eth_getCode',[to,'latest']);const a=manifest.contracts[name];let actual=code.slice(2),expected=a.deployedBytecode.slice(2);if(actual.length!==expected.length)throw Error(name+' 字节码长度不符');for(const refs of Object.values(a.immutableReferences||{}))for(const {start,length} of refs){actual=actual.slice(0,start*2)+'0'.repeat(length*2)+actual.slice((start+length)*2);expected=expected.slice(0,start*2)+'0'.repeat(length*2)+expected.slice((start+length)*2);}if(actual!==expected)throw Error(name+' 字节码不匹配');}
async function verify(step,hash){const [receipt,tx]=await Promise.all([read('eth_getTransactionReceipt',[hash]),read('eth_getTransactionByHash',[hash])]);if(!receipt||!tx||!receipt.blockHash)throw Error('交易尚未确认，请稍后刷新；不要重复发送');const block=await read('eth_getBlockByNumber',[receipt.blockNumber,false]);if(!same(block?.hash,receipt.blockHash)||!same(tx.blockHash,receipt.blockHash))throw Error('交易尚未成为规范区块中的确认记录');const expected=await transaction(step);const matchesStep=same(tx.input,expected.data)&&BigInt(tx.value)===0n&&(expected.to?same(tx.to,expected.to):tx.to===null);if(!same(receipt.transactionHash,hash)||!same(tx.hash,hash)||!same(receipt.from,tx.from)||!same(receipt.to,tx.to))throw Error('回执交易身份不符');
 const intent=state.intent?.step===step.key?state.intent:record(step.key);
 if(!same(tx.from,manifest.deployer))throw Error('交易不是由已确认部署钱包发送');
 if(intent&&(!same(tx.from,intent.account||intent.from)||BigInt(tx.nonce)!==BigInt(intent.nonce)))throw Error('交易发起人或nonce与原始预览不符');
 if(tx.chainId&&BigInt(tx.chainId)!==56n)throw Error('交易链号不符');
 if(![0n,1n].includes(BigInt(receipt.status)))throw Error('未知回执状态');
 if(!matchesStep){
  if(!state.intent||state.intent.step!==step.key||BigInt(await read('eth_getTransactionCount',[tx.from,'latest']))<=BigInt(tx.nonce))throw Error('交易内容与本步骤不符');
  state.replaced||=[];state.replaced.push({step:step.key,hash,from:tx.from,nonce:tx.nonce,blockHash:receipt.blockHash});
  delete state.intent;delete state.pending;pending=null;save();status('原部署交易已被同 nonce 的已确认交易替换，可重新预览。');return {replaced:true};
 }
 if(BigInt(receipt.status)===0n){state.failed||=[];state.failed.push({step:step.key,hash,nonce:tx.nonce,from:tx.from,blockHash:receipt.blockHash});if(state.intent?.step===step.key)delete state.intent;if(state.pending?.step===step.key)delete state.pending;save();status('已确认本笔回滚，可以重新预览。');return {failed:true};}
 if(BigInt(receipt.status)!==1n)throw Error('未知回执状态');
 let deployed=receipt.contractAddress;
 if(step.contract){if(!deployed)throw Error('回执缺少合约地址');await verifyCode(deployed,step.contract);if(step.key==='router'){
  const actual=await Promise.all(['owner','feeReceiver','platformFeeBps','defaultFeeToken','VERSION','WBNB'].map(m=>call(deployed,step.contract,m)));
  if(!same(actual[0],manifest.owner)||!same(actual[1],manifest.feeReceiver)||Number(actual[2])!==manifest.platformFeeBps||!same(actual[3],manifest.defaultFeeToken)||actual[4]!=='2.0.0'||!same(actual[5],manifest.dependencies.wbnb))throw Error('主路由配置核验失败');const feeTokens=['0x0000000000000000000000000000000000000000',manifest.dependencies.wbnb,'0x55d398326f99059ff775485246999027b3197955','0xc9882def23bc42d53895b8361d0b1edc7570bc6a','0x2170ed0880ac9a755fd29b2688956bd959f933f8','0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'];if((await Promise.all(feeTokens.map(token=>call(deployed,step.contract,'isFeeToken',[token])))).some(ok=>!ok))throw Error('收费资产配置不符');
 }else{if(!same(await call(deployed,step.contract,'aggregator'),address('router')))throw Error('适配器绑定错误');if(step.key==='v3'&&(!same(await call(deployed,step.contract,'weth'),manifest.dependencies.wbnb)||!same(await call(deployed,step.contract,'quoter'),manifest.dependencies.v3Quoter)))throw Error('V3 配置错误');}}
 else if(!same(tx.from,manifest.owner)||!await call(address('router'),'FstSwap','adapters',[address(step.adapter)]))throw Error('适配器未被管理员成功登记');
 const r={step:step.key,hash,contractAddress:deployed,from:tx.from,nonce:tx.nonce,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:receipt.gasUsed,verified:true};state.records=state.records.filter(r=>r.step!==step.key);state.records.push(r);if(state.pending?.step===step.key)delete state.pending;if(state.intent?.step===step.key)delete state.intent;save();return r;}
async function prepare({skipVerified=false}={}){pending=null;$('sign').disabled=true;if(manifest.status==='deployed'){render();$('next').textContent='当前版本已部署，无需重复部署。';return;}state=JSON.parse(localStorage.getItem(key)||'null')||state;if(state.manifestDigest!==digest)throw Error('发现其他编译版本的部署记录，请先核验原交易；不能重新发送');if(!skipVerified&&!state.intent&&!state.pending){for(const prior of steps){const known=record(prior.key);if(!known)break;await verify(prior,known.hash);}}render();const step=current();if(!step){$('next').textContent='所有部署与登记步骤已链上核验。请导出记录，随后可切换正式前端。';status('部署完成并核验。');return;}if(state.intent||state.pending){status('存在待核验交易意图。'+(state.pending?'交易哈希：'+state.pending.hash:'请从钱包取得该笔交易哈希，再使用恢复功能；状态未知时不能重新发送。'));return;}if(!account)return;if(!same(account,manifest.deployer))throw Error('请在手机钱包中切换到已确认的新部署钱包：'+manifest.deployer);await mainnetCheck();if(step.adapter&&!same(account,manifest.owner))throw Error('登记适配器需要切换到已确认的管理员钱包：'+manifest.owner);const tx={...(await transaction(step)),from:account};const [gas,price,balance,nonce]=await Promise.all([read('eth_estimateGas',[tx]),read('eth_gasPrice'),read('eth_getBalance',[account,'latest']),read('eth_getTransactionCount',[account,'pending'])]);tx.chainId='0x38';tx.nonce=nonce;tx.gas=ethers.toQuantity(BigInt(gas)*12n/10n);tx.gasPrice=price;const cost=BigInt(tx.gas)*BigInt(price);if(BigInt(balance)<cost)throw Error('钱包 BNB 不足以覆盖本笔估算 Gas');pending={step,tx,account,nonce};$('next').textContent=step.name;table('transaction',[['发起地址',account],['目标',tx.to||'创建新合约'],['转账金额','0 BNB'],['Gas 上限',BigInt(tx.gas)],['按当前 Gas 价格估算上限',ethers.formatEther(cost)+' BNB'],['数据摘要',ethers.keccak256(tx.data)],['当前 nonce',BigInt(nonce)]]);$('data').textContent=JSON.stringify(tx,null,2);$('sign').disabled=!manifest.readyForSigning;status('请核对本笔交易参数。');}
async function run(fn){if(busy)return;busy=true;$('sign').disabled=true;if($('start'))$('start').disabled=true;try{await navigator.locks.request(key,async()=>{state=JSON.parse(localStorage.getItem(key)||'null')||state;await fn();});}catch(e){status(e.message||String(e));}finally{busy=false;renderStart();}}
let scanAttempt=0;
function watchWallet(provider){
 provider.on?.('accountsChanged',()=>{pending=null;account=null;render();$('sign').disabled=true;status('钱包账户已改变，请重新连接并核对。');});
 provider.on?.('chainChanged',()=>{pending=null;$('sign').disabled=true;status('网络已改变，请刷新并核验。');});
 provider.on?.('disconnect',()=>{pending=null;account=null;render();$('sign').disabled=true;});
}
$('scan').onclick=()=>run(async()=>{
 const attempt=++scanAttempt;$('qrPanel').hidden=false;$('qr').textContent='正在生成连接二维码…';status('请使用手机钱包扫码。');
 const provider=await loadSwapWalletConnect({storagePrefix:"fstswap-mainnet-2"});
 const existing=await walletConnectAccount(provider);
 if(existing)await provider.disconnect();
 const {toCanvas}=await import('../assets/vendor/walletconnect/qrcode-1.5.4.js');
 const onUri=event=>{const uri=typeof event==='string'?event:event?.uri;if(!uri||attempt!==scanAttempt)return;const canvas=document.createElement('canvas');$('qr').replaceChildren(canvas);toCanvas(canvas,uri,{width:280,margin:2}).catch(()=>{$('qr').textContent='二维码生成失败';});};
 provider.on('display_uri',onUri);
 try{await provider.connect({optionalNamespaces:{eip155:{chains:['eip155:56'],methods:['eth_sendTransaction'],events:['accountsChanged','chainChanged']}}});if(attempt!==scanAttempt)return;wallet=provider;account=await walletConnectAccount(provider);if(!account)throw Error('配对未完成，请在手机钱包批准 BSC 主网连接');watchWallet(provider);$('qrPanel').hidden=true;await prepare();}
 finally{provider.removeListener?.('display_uri',onUri);}
});
$('cancelScan').onclick=async()=>{++scanAttempt;$('qrPanel').hidden=true;busy=false;status('已取消扫码。');try{await(await loadSwapWalletConnect({storagePrefix:"fstswap-mainnet-2"})).disconnect();}catch{}};
$('connect').onclick=()=>run(async()=>{wallet=window.ethereum;if(!wallet)throw Error('请在安装了 MetaMask 或其他浏览器钱包的浏览器中打开此页面');[account]=await wallet.request({method:'eth_requestAccounts'});watchWallet(wallet);await prepare();});
$('refresh').onclick=()=>run(async()=>{if(state.pending){const s=steps.find(s=>s.key===state.pending.step);await verify(s,state.pending.hash);}for(const s of steps){const r=record(s.key);if(r)await verify(s,r.hash);else break;}await prepare();});
$('recover').onclick=()=>run(async()=>{const hash=$('recoverHash').value.trim();if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入完整交易哈希');const step=current();if(!step)throw Error('所有步骤已完成');await verify(step,hash);await prepare();});
async function sendPending(_prepared,{signal}={}){const running=()=>{if(signal?.aborted)throw new DOMException('Deployment stopped','AbortError');};running();if(manifest.status==='deployed'||!manifest.readyForSigning||!pending)throw Error('当前没有可签名的已核对交易');const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.intent||saved?.pending)throw Error('另一页面已有待处理交易，请刷新并恢复');await mainnetCheck();running();const accounts=await wallet.request({method:'eth_accounts'});running();if(!same(accounts[0],manifest.deployer)||!same(accounts[0],pending.account))throw Error('钱包账户已改变，请刷新预览');const nonce=await read('eth_getTransactionCount',[pending.account,'pending']);running();if(nonce!==pending.nonce)throw Error('钱包 nonce 已改变，请刷新预览');const intent={step:pending.step.key,tx:pending.tx,account:pending.account,nonce:pending.nonce};state.intent=intent;save();status('请在钱包中核对并确认这一笔交易。');let hash;try{hash=await wallet.request({method:'eth_sendTransaction',params:[pending.tx]});}catch(e){if(e.code===4001){delete state.intent;save();}throw e;}if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('钱包未返回有效哈希，保持原交易锁定，请从钱包恢复');state.pending={step:intent.step,hash};save();status('已提交，程序将自动继续部署。');pending=null;return state.pending;}
$('sign').onclick=event=>{if(!event.isTrusted)return;return run(sendPending);};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({...state,owner:manifest.owner,feeReceiver:manifest.feeReceiver},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='fstswap-mainnet-deployment.json';a.click();URL.revokeObjectURL(a.href);};

render();

let sequenceController,completionController;
async function confirmAutomatically(step,hash,signal){
 const expires=Date.now()+180000;
 while(Date.now()<expires){
  if(signal.aborted)throw new DOMException('Deployment stopped','AbortError');
  status(step.name+'：已提交，链上确认后自动继续。');
  let receipt;try{receipt=await read('eth_getTransactionReceipt',[hash]);}catch{}
  if(receipt){const result=await verify(step,hash);render();return result;}
  await new Promise(resolve=>setTimeout(resolve,700));
 }
 throw Error('本笔交易仍在链上处理中，进度已保存。点击继续部署会自动恢复查询，不会重复发送。');
}
async function synchronizeCompleted(){
 const config={router:address('router'),adapters:Object.fromEntries(adapters.map(([k])=>[k,address(k)]))};
 const result={manifestDigest:digest,chainId:56,records:state.records,config,owner:manifest.owner,feeReceiver:manifest.feeReceiver};
 const response=await fetch('/api/deployment/completed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('合约已部署完成，开源记录同步暂未完成；不会重复部署。');
 const accepted=await response.json();if(!accepted.accepted||!validJobId(accepted.jobId))throw Error('本地服务未返回有效同步状态，请重试记录同步；不会重复部署。');
 state.completedSynced=true;state.completedJobId=accepted.jobId;state.completedPhase='queued';save();
 status('链上交易已完成。本地服务已接收记录，正在独立核验并提交合约开源。');
 $('next').textContent='链上交易已完成，正在核验与开源';$('start').disabled=true;
 void trackCompletion(accepted.jobId);
}
async function completionState(jobId,phase,count=0){
 await navigator.locks.request(key,async()=>{
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  if(saved?.manifestDigest!==digest||saved.completedJobId!==jobId)return;
  state=saved;state.completedPhase=phase;state.completedSourceCount=count;save();render();
  if(phase==='complete'){$('next').textContent='部署完成';status('FstSwap 主网部署已独立核验，Sourcify 合约开源完成（5/5）。BscScan 的显示状态由其独立更新。');}
  else if(['failed','source-pending','status-unavailable'].includes(phase)){$('next').textContent='链上交易已完成，记录同步可重试';status(phase==='source-pending'?'开源服务仍在处理中，可重试记录同步；不会重复发送部署交易。':'记录核验或开源状态暂未完成，可重试记录同步；不会重复发送部署交易。');}
  else{$('next').textContent='链上交易已完成，正在核验与开源';status('正在独立核验主网记录与提交 Sourcify 开源（'+count+'/5）。');}
 });
}
async function trackCompletion(jobId){
 completionController?.abort();const controller=completionController=new AbortController(),expires=Date.now()+180000;let errors=0;
 const pendingPhases=['queued','verifying','verified','sourcifying'];
 while(!controller.signal.aborted&&Date.now()<expires){
  try{
   const response=await fetch('/api/deployment/status',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
   if(!response.ok)throw Error('status unavailable');const result=await response.json();
   if(result.jobId!==jobId||result.chainId!==56||!['complete','failed','source-pending',...pendingPhases].includes(result.phase)){await completionState(jobId,'status-unavailable');return;}
   const sources=Array.isArray(result.sourceVerification)?result.sourceVerification:[],seen=new Set();
   for(const source of sources){if(adapters.some(([key])=>key===source?.step)||source?.step==='router')if(source.provider==='sourcify'&&source.status==='verified'&&same(source.address,address(source.step))&&['match','exact_match'].includes(source.creationMatch)&&['match','exact_match'].includes(source.runtimeMatch))seen.add(source.step);}
   if(result.phase==='complete'&&seen.size!==5){await completionState(jobId,'status-unavailable');return;}
   await completionState(jobId,result.phase,seen.size);errors=0;
   if(!pendingPhases.includes(result.phase))return;
  }catch{if(controller.signal.aborted)return;if(++errors>=3){await completionState(jobId,'status-unavailable');return;}}
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 if(!controller.signal.aborted)await completionState(jobId,'status-unavailable');
}
if($('start'))$('start').onclick=event=>{
 if(!event.isTrusted)return;
 return run(async()=>{
  if(!account||!wallet)throw Error('请先连接部署钱包');
  if(!manifest.readyForSigning||manifest.status==='deployed')throw Error('当前没有待部署的新版本');
  if(state.manifestDigest!==digest)throw Error('发现其他编译版本的部署记录；不能继续部署');
  sequenceController=new AbortController();
  // Revalidate saved dependencies once per Continue, before reusing their
  // addresses. Individual newly confirmed steps need no quadratic rescanning.
  for(const step of steps){
   if(sequenceController.signal.aborted)throw new DOMException('Deployment stopped','AbortError');
   const known=record(step.key);if(!known)break;
   if(!(await verify(step,known.hash))?.verified)throw Error('原有部署步骤未成功，已停止后续签名');
  }
  await runDeploymentSequence({next:current,pending:()=>state.pending,intent:()=>state.intent,
   prepare:async()=>{await prepare({skipVerified:true});if(!pending)throw Error('没有可提交的部署交易');return pending;},
   send:sendPending,confirm:(step,hash)=>confirmAutomatically(step,hash,sequenceController.signal),
   complete:synchronizeCompleted,signal:sequenceController.signal,maxSteps:steps.length});
 });
};
if($('stop'))$('stop').onclick=()=>{sequenceController?.abort();status('自动推进已停止；已提交交易的进度已保存。');};
if(state.manifestDigest===digest&&state.completedSynced&&validJobId(state.completedJobId))void trackCompletion(state.completedJobId);
