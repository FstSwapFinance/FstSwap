import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url),origin='https://fstswap.pro',A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),ZERO='0x'+'00'.repeat(20);
const USDT='0x55d398326f99059ff775485246999027b3197955',FIST='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',three=[USDT,FIST,ZERO].sort();
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>browser?.close());
async function fixture(t,{legacy=false,switchAccount=false}={}){
 const context=await browser.newContext({viewport:{width:430,height:932},locale:'en-US'}),page=await context.newPage(),vendor=deferred(),oldBalance=deferred();
 const posts=[],rpc=[],errors=[];let vendorReleased=false;
 t.after(async()=>{vendor.resolve();oldBalance.resolve();await context.close();});page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({legacy,A})=>{
  if(legacy)delete HTMLElement.prototype.inert;
  localStorage.setItem('fstswap_wallet_choice','injected');localStorage.setItem('swap_language','en');
  const listeners=new Map();window.__wallet={account:A,calls:[],emit(account){this.account=account;for(const fn of listeners.get('accountsChanged')||[])fn([account]);}};
  window.ethereum={isMetaMask:true,request:async payload=>{window.__wallet.calls.push(payload);if(payload.method==='eth_accounts')return[window.__wallet.account];if(payload.method==='eth_chainId')return'0x38';throw Error('Forbidden wallet request: '+payload.method);},
   on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeListener(event,fn){listeners.get(event)?.delete(fn);}};
  const fetch=window.fetch.bind(window);window.__startupReads=[];
  window.fetch=(url,init)=>{if(String(url).includes('/api/swap/'))window.__startupReads.push({url:String(url),body:init?.body});return fetch(url,init);};
 },{legacy,A});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':'*','access-control-expose-headers':'x-fstswap-time-nonce,x-fstswap-server-time'};
  if(url.pathname.startsWith('/api/swap/')){
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
   const nonce=request.headers()['x-fstswap-time-nonce'];if(nonce){headers['x-fstswap-time-nonce']=nonce;headers['x-fstswap-server-time']=String(Date.now());}
   if(url.pathname.endsWith('/health'))return route.fulfill({status:200,headers,json:{ready:true}});
   const body=request.postDataJSON();posts.push({action:url.pathname.split('/').at(-1),body,beforeVendor:!vendorReleased});
   if(url.pathname.endsWith('/quote'))return route.fulfill({status:400,headers,json:{error:'NO_ROUTE'}});
   if(switchAccount&&body.account===A)await oldBalance.promise;
   const now=Date.now();headers['x-fstswap-server-time']=String(now);
   const values=body.account===B?{[USDT]:'12000000000000000000',[FIST]:'7000000',[ZERO]:'20000000000000000'}:{[USDT]:'111000000000000000000',[FIST]:'3000000',[ZERO]:'10000000000000000'};
   return route.fulfill({status:200,headers,json:{schema:1,chainId:56,account:body.account,blockNumber:'0x100',blockHash:'0x'+'ab'.repeat(32),readAt:now,balances:Object.fromEntries(body.tokens.map(token=>[token,values[token]||'0'])),failedTokens:[]}}).catch(()=>{});
  }
  if(url.origin!==origin){
   let body;try{body=request.postDataJSON();}catch{}
   if(body?.jsonrpc==='2.0'){
    rpc.push(body);const result=body.method==='eth_blockNumber'?'0x100':body.method==='eth_chainId'?'0x38':body.method==='eth_getBlockByNumber'?{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}:'0x'+'00'.repeat(32);
    return route.fulfill({status:200,headers,json:{jsonrpc:'2.0',id:body.id,result}});
   }
   return route.fulfill({status:503,headers,body:'offline fixture'});
  }
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
  try{
   let data=await readFile(new URL(relative,root));
   if(relative==='assets/vendor/ethers.umd.min.js'||/^assets\/vendor\/fst-ethers-[A-F0-9]{16}\.js$/.test(relative)){await vendor.promise;vendorReleased=true;}
   if(relative==='src/app.js'&&process.env.FST_STARTUP_REVIEW_VARIANT==='without-early-prefetch')data=Buffer.from(data.toString().replace(/^import \{ startDefaultSwapReads \}[^\n]*\n/m,'').replace(/^const stopDefaultReads =[^\n]*\n/m,'').replace(/^window\.addEventListener\('pagehide',stopDefaultReads[^\n]*\n/m,''));
   return route.fulfill({body:data,contentType:/\.(mjs|js)$/.test(relative)?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.svg')?'image/svg+xml':'text/html'}).catch(()=>{});
  }catch{return route.fulfill({status:404,body:''}).catch(()=>{});}
 });
 await page.goto(origin+'/#/swap',{waitUntil:'domcontentloaded'});
 return{page,posts,rpc,errors,release:()=>{vendorReleased=true;vendor.resolve();},releaseOld:oldBalance.resolve};
}
for(const legacy of[false,true])test(`default quote and three balances start before ethers, then hydrate without duplicate holdings (${legacy?'legacy inert':'native inert'})`,async t=>{
 const f=await fixture(t,{legacy});
 await f.page.waitForFunction(()=>window.__startupReads.some(read=>read.url.endsWith('/quote'))&&window.__startupReads.some(read=>read.url.endsWith('/balances')),{},{timeout:2500});
 assert.equal(await f.page.evaluate(()=>typeof globalThis.ethers),'undefined');
 assert.ok(f.posts.some(post=>post.action==='quote'&&post.beforeVendor&&post.body.tokenIn===USDT&&post.body.tokenOut===FIST&&post.body.amountIn==='1000000000000000000'));
 const first=f.posts.filter(post=>post.action==='balances');assert.equal(first.length,1);assert.equal(first[0].beforeVendor,true);assert.deepEqual([...first[0].body.tokens].sort(),three);
 f.release();await f.page.waitForFunction(()=>globalThis.ethers?.Interface&&document.querySelector('main')&&!document.querySelector('main').hasAttribute('inert')&&document.querySelector('#swap-currency-input .css-djrxae')?.textContent.includes('111 USDT'));
 await f.page.evaluate(()=>Promise.resolve());
 assert.equal(f.posts.filter(post=>post.action==='balances'&&post.body.account===A&&JSON.stringify([...post.body.tokens].sort())===JSON.stringify(three)).length,1);
 assert.equal(f.posts.filter(post=>post.action==='balances'&&post.body.tokens.length===1&&post.body.tokens[0]===ZERO).length,0,'header must join the same native balance snapshot');
 assert.equal(f.rpc.filter(call=>call.method==='eth_getBalance').length,0,'header must not independently requery native BNB');
 assert.deepEqual(await f.page.evaluate(()=>window.__wallet.calls.map(call=>call.method).sort()),['eth_accounts','eth_chainId']);assert.deepEqual(f.errors,[]);
});
test('wallet B starts its own early holdings and an ignored late A response never appears after hydration',async t=>{
 const f=await fixture(t,{switchAccount:true});
 await f.page.waitForFunction(()=>window.__startupReads.some(read=>read.url.endsWith('/balances')),{},{timeout:2500});
 await f.page.evaluate(B=>window.__wallet.emit(B),B);
 await f.page.waitForFunction(B=>window.__startupReads.some(read=>read.url.endsWith('/balances')&&JSON.parse(read.body).account===B),B);
 assert.equal(await f.page.evaluate(()=>typeof globalThis.ethers),'undefined');
 f.release();await f.page.waitForFunction(()=>globalThis.ethers?.Interface&&document.querySelector('#swap-currency-input .css-djrxae')?.textContent.includes('12 USDT'));
 f.releaseOld();await f.page.evaluate(()=>Promise.resolve());
 assert.match(await f.page.locator('#swap-currency-input .css-djrxae').textContent(),/12 USDT/);assert.doesNotMatch(await f.page.locator('#swap-currency-input .css-djrxae').textContent(),/111 USDT/);
 assert.equal(f.posts.filter(post=>post.action==='balances'&&post.body.account===B&&JSON.stringify([...post.body.tokens].sort())===JSON.stringify(three)).length,1);assert.deepEqual(f.errors,[]);
 assert.deepEqual(await f.page.evaluate(()=>window.__wallet.calls.filter(call=>/send|sign|requestAccounts/i.test(call.method))),[]);
});
