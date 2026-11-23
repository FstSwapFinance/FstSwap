import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('  let balanceRequestId ='),source.indexOf('  async function refreshBalances('));
const deferred=()=>{let resolve,reject;return{promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
function fixture(){
 const jobs=[],paint=[],wallet={account:'0x'+'11'.repeat(20)},TOKENS={usdt:{key:'usdt',address:'0x'+'aa'.repeat(20),decimals:18},fist:{key:'fist',address:'0x'+'bb'.repeat(20),decimals:6},bnb:{key:'bnb',address:null,decimals:18}};
 const state={balanceEpoch:0,balances:{usdt:100n,fist:200n,bnb:300n},balanceErrors:{},balancePending:{}};
 const context={wallet,TOKENS,state,AbortController,DOMException,Promise,BigInt,JSON,Map,Set,Object,main:{isConnected:true},page:{inKey:'usdt',outKey:'fist'},ORDER:['usdt','fist','bnb'],
  balanceRequest(){throw Error('No physical RPC in controller fixture');},submissionWarmup:{pending:()=>false},cancelSubmissionWarm(){},activeBalanceReads:0,queueSubmissionWarm(){},otherBalances:{pause(){}},
  renderPanels(){paint.push('panels');},renderBottom(){paint.push('bottom');},readWalletBalances(_request,account,tokens,options){const job=deferred();jobs.push({...job,account,tokens,options});return job.promise;}};
 vm.createContext(context);vm.runInContext(controller,context);
 return{context,state,wallet,TOKENS,jobs,paint,read:(keys=['usdt'],fresh=false,options={})=>context.loadBalances(keys,fresh,options)};
}
test('a newer ordinary balance consumer settles and clears a transferred fresh pending mark',async()=>{
 const f=fixture(),old=f.read(['usdt'],true),next=f.read(['usdt']);
 assert.equal(f.jobs[1].options.fresh,false,'an in-flight fresh read can be shared without invalidating it again');
 f.jobs[1].resolve({balances:{usdt:9n},failed:[]});await next;
 assert.equal(f.state.balances.usdt,9n);assert.equal(f.state.balancePending.usdt,undefined);
 f.jobs[0].resolve({balances:{usdt:100n},failed:[]});await old;
 assert.equal(f.state.balances.usdt,9n);assert.equal(f.state.balancePending.usdt,undefined);
});
test('the real shared balance cache keeps a fresh physical read alive for its newer ordinary consumer',async t=>{
 const specifier=source.match(/from '([^']*swap-balances\.mjs[^']*)'/)[1],moduleUrl=new URL(specifier,new URL('../src/swap-view.mjs',import.meta.url));
 const {readWalletBalances,invalidateWalletBalances}=await import(moduleUrl.href);
 const lowerSource=readFileSync(moduleUrl,'utf8'),serviceSpecifier=lowerSource.match(/from '([^']*swap-service-client\.mjs[^']*)'/)[1];
 const {swapService}=await import(new URL(serviceSpecifier,moduleUrl).href),original=swapService.balances,physical=[];
 invalidateWalletBalances();swapService.balances=(_account,tokens,options)=>{const gate=deferred();physical.push({...gate,tokens,options});return gate.promise;};
 t.after(()=>{for(const job of physical)job.resolve({balances:{},failed:job.tokens.map(token=>token.key)});swapService.balances=original;invalidateWalletBalances();});
 const f=fixture(),abort=new AbortController();f.context.readWalletBalances=readWalletBalances;
 const first=f.read(['usdt'],true,{signal:abort.signal});for(let n=0;n<10;n++)await Promise.resolve();
 const latest=f.read(['usdt']);for(let n=0;n<10;n++)await Promise.resolve();
 assert.equal(physical.length,1);assert.equal(physical[0].options.fresh,true);
 abort.abort();await first;assert.equal(physical[0].options.signal.aborted,false,'a newer subscriber owns the physical fresh read');
 physical[0].resolve({balances:{usdt:9n},failed:[]});await latest;
 assert.equal(f.state.balances.usdt,9n);assert.equal(f.state.balancePending.usdt,undefined);
 assert.equal((await readWalletBalances(()=>{throw Error('No public read');},f.wallet.account,[f.TOKENS.usdt])).balances.usdt,9n);assert.equal(physical.length,1);
});
test('fresh requirements survive a superseding failed read and force a subsequent reread',async()=>{
 const f=fixture(),old=f.read(['usdt'],true),next=f.read(['usdt']);
 f.jobs[1].resolve({balances:{},failed:['usdt']});await next;
 assert.equal(f.state.balances.usdt,undefined);assert.equal(f.state.balanceErrors.usdt,true);assert.equal(f.state.balancePending.usdt,undefined);
 const retry=f.read(['usdt']);assert.equal(f.jobs[2].options.fresh,true);
 f.jobs[2].resolve({balances:{usdt:7n},failed:[]});await retry;
 f.jobs[0].resolve({balances:{usdt:100n},failed:[]});await old;
 assert.equal(f.state.balances.usdt,7n);assert.equal(f.state.balanceErrors.usdt,undefined);
});
test('an aborted fresh read cannot restore stale values and retains the need for a fresh retry',async()=>{
 const f=fixture(),abort=new AbortController(),old=f.read(['usdt'],true,{signal:abort.signal});abort.abort();
 f.jobs[0].reject(new DOMException('canceled','AbortError'));await old;
 assert.equal(f.state.balances.usdt,undefined);assert.equal(f.state.balancePending.usdt,undefined);
 const next=f.read(['usdt']);assert.equal(f.jobs[1].options.fresh,true);
 f.jobs[1].resolve({balances:{usdt:4n},failed:[]});await next;assert.equal(f.state.balances.usdt,4n);
});
test('an ordinary read joining an aborted fresh owner forces a new fresh generation',async()=>{
 const f=fixture(),abort=new AbortController(),old=f.read(['usdt'],true,{signal:abort.signal});abort.abort();
 const next=f.read(['usdt']);assert.equal(f.jobs[1].options.fresh,true);
 f.jobs[0].reject(new DOMException('canceled','AbortError'));await old;
 f.jobs[1].resolve({balances:{usdt:3n},failed:[]});await next;
 assert.equal(f.state.balances.usdt,3n);assert.equal(f.state.balancePending.usdt,undefined);
});
test('fresh requirements and successful partial results remain isolated per token',async()=>{
 const f=fixture(),old=f.read(['usdt','fist'],true),next=f.read(['usdt']);
 f.jobs[1].resolve({balances:{usdt:9n},failed:[]});await next;
 f.jobs[0].resolve({balances:{usdt:100n,fist:0n},failed:[]});await old;
 assert.equal(f.state.balances.usdt,9n);assert.equal(f.state.balances.fist,0n);assert.deepEqual(Object.keys(f.state.balancePending),[]);
 const retry=f.read(['fist']);assert.equal(f.jobs[2].options.fresh,false);
 f.jobs[2].resolve({balances:{fist:0n},failed:[]});await retry;
});
test('account, epoch, token address or precision changes reject old balance completions',async()=>{
 for(const change of['account','epoch','address','decimals']){
  const f=fixture(),work=f.read(['usdt']);
  if(change==='account')f.wallet.account='0x'+'22'.repeat(20);
  if(change==='epoch')f.state.balanceEpoch++;
  if(change==='address')f.TOKENS.usdt={...f.TOKENS.usdt,address:'0x'+'cc'.repeat(20)};
  if(change==='decimals')f.TOKENS.usdt={...f.TOKENS.usdt,decimals:6};
  f.jobs[0].resolve({balances:{usdt:999n},failed:[]});await work;
  assert.equal(f.state.balances.usdt,100n,change+' must not publish');
 }
});
test('overlapping latest successes do not lose unaffected token results or show failed tokens as zero',async()=>{
 const f=fixture(),old=f.read(['usdt','fist']),next=f.read(['usdt']);
 f.jobs[1].resolve({balances:{usdt:0n},failed:[]});await next;
 f.jobs[0].resolve({balances:{usdt:99n},failed:['fist']});await old;
 assert.equal(f.state.balances.usdt,0n);assert.equal(f.state.balances.fist,undefined);assert.equal(f.state.balanceErrors.fist,true);
});
test('opening the full balance list repaints current pair balances after its results arrive',async()=>{
 const f=fixture(),work=f.context.loadAllBalances();f.jobs[0].resolve({balances:{usdt:5n,fist:6n,bnb:7n},failed:[]});await work;
 assert.deepEqual(f.paint,['panels','bottom']);assert.equal(f.state.balances.usdt,5n);
});

function pickerFixture(){
 const start=source.indexOf('  const refreshBalances = async () => {',source.indexOf('export function openTokenPicker'));
 const fragment=source.slice(start,source.indexOf('  const openedAccount = wallet.account;',start));
 const jobs=[],balances={},TOKENS={usdt:{key:'usdt',address:'0x'+'aa'.repeat(20),decimals:18}};
 const wallet={account:'0x'+'11'.repeat(20)},context={wallet,balances,TOKENS,ORDER:['usdt'],overlay:{isConnected:true},Promise,Map,JSON,pickerBalanceSeq:0,loadBalances:null,
  balanceRequest(){},readWalletBalances(_read,_account,tokens){const job=deferred();jobs.push({...job,tokens});return job.promise;},draws:0,draw(){context.draws++;},syncTokenRegistry(){},cleanup(){},onTokensChanged(fn){context.notify=fn;return()=>{};}};
 vm.createContext(context);vm.runInContext(fragment,context);
 return{context,jobs,balances,TOKENS,wallet};
}
test('an open picker requests new token holdings after a list update and redraws the result',async()=>{
 const f=pickerFixture();f.jobs[0].resolve({balances:{usdt:1n},failed:[]});await Promise.resolve();await Promise.resolve();
 f.TOKENS.fist={key:'fist',address:'0x'+'bb'.repeat(20),decimals:6};f.context.ORDER.push('fist');
 f.context.notify();assert.equal(f.jobs.length,2);f.jobs[1].resolve({balances:{usdt:1n,fist:2n},failed:[]});
 for(let n=0;n<6;n++)await Promise.resolve();assert.equal(f.balances.fist,2n);assert.ok(f.context.draws>=3);
});
test('an open picker drops superseded and changed-metadata standalone reads',async()=>{
 const f=pickerFixture();f.TOKENS.usdt={...f.TOKENS.usdt,decimals:6};f.jobs[0].resolve({balances:{usdt:99n},failed:[]});
 for(let n=0;n<4;n++)await Promise.resolve();assert.equal(f.balances.usdt,undefined);
 f.context.notify();f.context.notify();assert.equal(f.jobs.length,3);
 f.jobs[2].resolve({balances:{usdt:3n},failed:[]});for(let n=0;n<4;n++)await Promise.resolve();
 f.jobs[1].resolve({balances:{usdt:2n},failed:[]});for(let n=0;n<4;n++)await Promise.resolve();assert.equal(f.balances.usdt,3n);
});
