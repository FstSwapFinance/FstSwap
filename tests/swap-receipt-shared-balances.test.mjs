import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const view=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8'),shell=readFileSync(new URL('../src/swap-shell.mjs',import.meta.url),'utf8');
const balanceSpecifier=view.match(/from '([^']*swap-balances\.mjs[^']*)'/)[1];
const balanceModule=new URL(balanceSpecifier,new URL('../src/swap-view.mjs',import.meta.url));
const {readWalletBalances,invalidateWalletBalances}=await import(balanceModule.href);
const balanceSource=readFileSync(balanceModule,'utf8'),serviceSpecifier=balanceSource.match(/from '([^']*swap-service-client\.mjs[^']*)'/)[1];
const {swapService}=await import(new URL(serviceSpecifier,balanceModule).href);
const account='0x'+'11'.repeat(20),usdt={key:'usdt',address:'0x'+'aa'.repeat(20),decimals:18},fist={key:'fist',address:'0x'+'bb'.repeat(20),decimals:6},bnb={key:'bnb',address:null,decimals:18};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const flush=async()=>{for(let n=0;n<100;n++)await Promise.resolve();};

test('verified swap receipt performs one fresh three-token read, then header shares it without failing the page or restoring old balances',async t=>{
 invalidateWalletBalances();const original=swapService.balances,jobs=[],reads=[],verified=deferred(),receipt=deferred();
 swapService.balances=(_owner,tokens,{signal})=>{const gate=deferred();jobs.push({tokens,signal,gate});return gate.promise;};
 t.after(()=>{for(const job of jobs)job.gate.resolve({balances:{},failed:job.tokens.map(token=>token.key)});swapService.balances=original;invalidateWalletBalances();});
 const provider={},wallet={wallet:{provider,account},bnb:100n,get account(){return this.wallet?.account;},get provider(){return this.wallet?.provider;}},state={balances:{usdt:100n,fist:100n,bnb:100n},balanceErrors:{},balancePending:{},balanceEpoch:0};
 const request=async()=>{throw Error('Unexpected physical fallback');};
 const context={AbortController,AbortSignal,Promise,BigInt,Date,globalThis:{fetch(){}},wallet,walletState:wallet,state,
  readWalletBalances:(...args)=>{reads.push({tokens:args[2],fresh:args[3]?.fresh===true});return readWalletBalances(...args);},invalidateWalletBalances,
  balanceRequest:request,swapPublicRpc:()=>request,renderHeader(){},renderPanels(){},renderBottom(){},
  activeBalanceReads:0,submissionWarmup:{pending:()=>false},queueSubmissionWarm(){},page:{inKey:'usdt',outKey:'fist'},TOKENS:{usdt,fist,bnb},ORDER:['usdt','fist','bnb'],main:{isConnected:true},
  otherBalances:{pause(){},schedule(){}},refreshAllowance:async()=>{},
  hash:'0x'+'33'.repeat(32),submittedAccount:account,expectedRequest:{},submittedTokens:{},min:1n,q:{amountIn:1n,feeToken:usdt.address,lpFee:0n},receiptReads:{read(){},dispose(){}},
  swapV10Ready:()=>true,waitReceipt:()=>receipt.promise,readV10Receipt:()=>verified.promise,
 };
 vm.createContext(context);
 vm.runInContext(shell.slice(shell.indexOf('// —— Polling'),shell.indexOf('// —— Popups')).replace(/^export /gm,''),context);
 vm.runInContext(view.slice(view.indexOf('  let balanceRequestId ='),view.indexOf('  // 授权对象')),context);
 const old=readWalletBalances(request,account,[usdt,fist,bnb]),oldRejected=assert.rejects(old,{name:'AbortError'}),oldHeader=context.refreshNativeBalance();await flush();assert.equal(jobs.length,1);
 let controller=view.match(/waitReceipt\(hash, submittedAccount, undefined, receiptReads\.read\)\.then\(async \(\) => \{[\s\S]*?\n      \}\)/)[0];
 // This test-only variant replays the original observed bug without editing the
 // production source, providing independent RED evidence for the receipt flow.
 if(process.env.FST_RECEIPT_REVIEW_VARIANT==='legacy-double-fresh')controller=controller.replace('await refreshBalances(); refreshNativeBalance();','refreshBalances(); refreshNativeBalance({fresh:true});');
 const completion=vm.runInContext(controller,context);receipt.resolve();await flush();assert.equal(jobs.length,1,'receipt result verification must finish before any fresh balance work');
 verified.resolve();await flush();assert.equal(jobs.length,2);
 assert.deepEqual(jobs[1].tokens.map(token=>token.key),['usdt','fist','bnb'],'the one post-receipt physical batch must contain both page tokens and Gas balance');
 assert.equal(jobs[0].signal.aborted,true);assert.equal(jobs[1].signal.aborted,false);await oldRejected;await oldHeader;
 const received={usdt:90n*10n**18n,fist:7123456n,bnb:9000000000000000n};jobs[1].gate.resolve({balances:received,failed:[]});await completion;await flush();
 assert.equal(reads.filter(read=>read.fresh).length,1,'the receipt flow must invalidate once, rather than header canceling the new page read');
 assert.equal(jobs.length,2,'header must use the three-token result without another physical balance read');
 assert.deepEqual(state.balances,received);assert.deepEqual(state.balanceErrors,{});assert.equal(wallet.bnb,9000000000000000n);
 jobs[0].gate.resolve({balances:{usdt:100n,fist:100n,bnb:100n},failed:[]});await flush();
 assert.deepEqual(state.balances,received);assert.equal(wallet.bnb,9000000000000000n);
 assert.deepEqual((await readWalletBalances(request,account,[usdt,fist,bnb])).balances,received);assert.equal(jobs.length,2);
});
