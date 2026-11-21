import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {ethers} from 'ethers';

const root=new URL('../',import.meta.url),origin='https://fst-startup.test';
const runtimeTag=(await readFile(new URL('src/swap-pages.mjs',root),'utf8')).match(/swap-shell\.mjs(\?[^"']+)/)[1];
const U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),P='0x'+'77'.repeat(20),FACTORY='0x'+'99'.repeat(20),S=10n**18n;
const codec=new ethers.Interface(['function factory() view returns(address)','function getPair(address,address) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)','function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const multi=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])','function getEthBalance(address) view returns(uint256)']);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,{holdFactory=false,holdBalances=false}={}){
 const context=await browser.newContext(),page=await context.newPage(),calls=[],errors=[],factoryGate=deferred(),balanceGate=deferred();
 t.after(()=>context.close());page.on('pageerror',error=>errors.push(error.message));
 let failing=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin){
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="root"></div></body></html>'});
   if(url.pathname==='/src/swap-market-data.mjs')return route.fulfill({contentType:'application/javascript',body:'export const marketData=globalThis.__market;'});
   if(url.pathname.endsWith('/lightweight-charts.esm.production.js'))return route.fulfill({contentType:'application/javascript',body:'export const CrosshairMode={Normal:0};export const createChart=()=>({applyOptions(){},subscribeCrosshairMove(){},remove(){},addCandlestickSeries:()=>({setData(){},applyOptions(){}}),addHistogramSeries:()=>({setData(){}})});'});
   try{const body=await readFile(new URL(url.pathname.slice(1),root));return route.fulfill({body,contentType:/\.(?:mjs|js)$/.test(url.pathname)?'application/javascript':url.pathname.endsWith('.json')?'application/json':url.pathname.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  }
  if(route.request().method()==='POST'){
   const payload=route.request().postDataJSON();let result;
   if(payload.method==='eth_blockNumber')result='0x100';
   else if(payload.method==='eth_getBalance')result='0x1';
   else if(payload.method==='eth_call'){
    const tx=payload.params[0];
    if(tx.to.toLowerCase()==='0xca11bde05977b3631167028862be2a173976ca11'){
     const parsed=multi.parseTransaction({data:tx.data});assert.equal(parsed.name,'tryAggregate');
     const results=parsed.args[1].map(row=>{assert.equal(multi.parseTransaction({data:row.callData}).name,'getEthBalance');return[true,multi.encodeFunctionResult('getEthBalance',[1n])];});
     result=multi.encodeFunctionResult('tryAggregate',[results]);
    }else{
    const parsed=codec.parseTransaction({data:tx.data}),call={method:parsed.name,target:tx.to.toLowerCase(),account:parsed.name==='balanceOf'?parsed.args[0].toLowerCase():null};calls.push(call);
    if(parsed.name==='factory'&&holdFactory)await factoryGate.promise;
    if(parsed.name==='balanceOf'&&holdBalances&&call.account===A)await balanceGate.promise;
    if(parsed.name==='balanceOf'&&failing)return route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'unavailable'});
    const multiplier=call.account===B?2n:1n;
    const value=parsed.name==='factory'?[FACTORY]:parsed.name==='getPair'?[P]:parsed.name==='token0'?[U]:parsed.name==='token1'?[F]:parsed.name==='getReserves'?[100n*S,200000000n,0]:parsed.name==='totalSupply'?[100n*S]:[call.target===F?20_000_000n*multiplier:10n*S*multiplier];
    result=codec.encodeFunctionResult(parsed.name,value);
    }
   }else throw Error('unexpected RPC '+payload.method);
   return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:payload.id,result})});
  }
  return route.fulfill({status:404,body:''});
 });
 await page.goto(origin);await page.addScriptTag({content:await readFile(new URL('assets/vendor/ethers.umd.min.js',root),'utf8')});
 await page.evaluate(({U,F,P,A})=>{
  let release;const stats=new Promise(r=>release=r);globalThis.releaseStats=release;
  globalThis.__market={peek(){return null;},read:async path=>{
   if(path===`/pools/${P}`){await stats;return{fetchedAt:Date.now(),body:{data:{attributes:{volume_usd:{h24:'10000'},base_token_price_usd:'1',quote_token_price_usd:'0.5'},relationships:{base_token:{data:{id:'bsc_'+U}},quote_token:{data:{id:'bsc_'+F}}}}}};}
   return{fetchedAt:Date.now(),body:{data:[]}};
  }};
  location.hash=`#/analysis/${U}/${F}`;globalThis.startAccount=A;
 },{U,F,P,A});
 await page.evaluate(async tag=>{
  const shell=await import('/src/swap-shell.mjs'+tag);globalThis.testWallet=shell.useWallet();testWallet.wallet={account:startAccount,provider:{request(){throw Error('analysis must not prompt wallet');}}};
  const pages=await import('/src/swap-pages.mjs'+tag);globalThis.mount=()=>pages.mountAnalysisPage(document.querySelector('#root'));
 },runtimeTag);
 const start=()=>page.evaluate(()=>{globalThis.mountDone=false;globalThis.mounting=mount().then(()=>mountDone=true);});
 const balances=()=>calls.filter(c=>c.method==='balanceOf');
 const values=()=>page.locator('main .eyuYtB span.cVCYxw').allTextContents();
 const notify=account=>page.evaluate(account=>{testWallet.wallet=account?{...testWallet.wallet,account}:null;testWallet.notify();},account);
 return{page,calls,errors,start,balances,values,notify,factoryGate,balanceGate,fail:value=>{failing=value;}};
}
test('analysis first paint subscribes before pool awaits and unmount immediately removes that listener',async t=>{
 const f=await fixture(t,{holdFactory:true});await f.start();await f.page.waitForFunction(()=>document.querySelector('main'));
 await f.page.waitForTimeout(30);assert.equal(await f.page.evaluate(()=>testWallet.listeners.size),1,'wallet subscription must exist during pending pool discovery');
 await f.page.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));assert.equal(await f.page.evaluate(()=>testWallet.listeners.size),0);
 f.factoryGate.resolve();await f.page.evaluate(()=>mounting);assert.equal(f.balances().length,0);
});
test('connected analysis first paint reads each balance once and stats reuse amounts to update LP fees',async t=>{
 const f=await fixture(t);await f.start();await f.page.waitForFunction(()=>mountDone);await f.page.waitForTimeout(80);
 assert.equal(f.balances().length,3,'two token balances and one LP read; immediate subscribe and startup must not duplicate them');
 assert.deepEqual([U,F,P].map(token=>f.balances().filter(c=>c.target===token).length),[1,1,1]);
 await f.page.evaluate(()=>releaseStats());await f.page.waitForTimeout(80);
 assert.equal(f.balances().length,3,'statistics change only redraws the saved balance amounts');
 const values=await f.values();assert.equal(parseFloat(values[6]),1.5);assert.equal(parseFloat(values[7]),3);assert.deepEqual(f.errors,[]);
});
test('wallet switches and disconnect clear old amounts and late account reads cannot overwrite new balances',async t=>{
 const f=await fixture(t,{holdBalances:true});await f.start();await f.page.waitForFunction(()=>mountDone);await f.page.waitForTimeout(40);
 assert.equal(f.balances().length,3);await f.notify(B);await f.page.waitForTimeout(80);
 assert.equal(f.balances().filter(c=>c.account===B).length,3);assert.equal(parseFloat((await f.values())[0]),20);
 f.balanceGate.resolve();await f.page.waitForTimeout(50);assert.equal(parseFloat((await f.values())[0]),20);
 await f.notify(null);await f.page.waitForTimeout(40);assert.equal(parseFloat((await f.values())[0]),0);
});
test('failed analysis balance reads remain unknown and a later wallet notification retries them',async t=>{
 const f=await fixture(t);f.fail(true);await f.start();await f.page.waitForFunction(()=>mountDone);await f.page.waitForTimeout(100);
 assert.equal((await f.values())[0].trim(),'—');f.fail(false);const before=f.balances().length;await f.notify(A);await f.page.waitForTimeout(100);
 assert.equal(f.balances().length-before,3);assert.equal(parseFloat((await f.values())[0]),10);
});
test('analysis native BNB metadata no longer pulls in the swap controller',async t=>{
 const context=await browser.newContext(),page=await context.newPage(),modules=[];t.after(()=>context.close());
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
  if(url.pathname.endsWith('.mjs'))modules.push(url.pathname);
  try{return route.fulfill({contentType:'application/javascript',body:await readFile(new URL(url.pathname.slice(1),root))});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin);await page.evaluate(tag=>import('/src/swap-pages.mjs'+tag),runtimeTag);
 assert.ok(!modules.includes('/src/swap-view.mjs'),'pages must not download/evaluate the whole swap UI to obtain BNB metadata');
});
