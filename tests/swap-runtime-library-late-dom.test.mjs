// Actual published HTML, generated graph and declared ethers delivery bytes. The only
// network responses outside this checkout are read-only fixtures. No wallet exists.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url),origin='https://fstswap.pro';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>browser?.close());
async function fixture(t){
 const manifest=JSON.parse(await readFile(new URL('src/fst-runtime-manifest.json',root),'utf8'));
 const index=await readFile(new URL('index.html',root));
 const vendorTags=[...index.toString().matchAll(/<script\b[^>]*data-fst-library=["']ethers["'][^>]*>/gi)];
 assert.equal(vendorTags.length,1,'published HTML must declare exactly one ethers script');
 const vendorSource=vendorTags[0][0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
 assert.ok(vendorSource,'the published ethers marker must have its original src');
 const vendorPath=new URL(vendorSource,origin+'/').pathname;
 const delivery=manifest.cacheAssets.find(asset=>asset.path===vendorPath.slice(1));
 assert.ok(delivery,'the real HTML library must be declared by the published manifest');
 const vendorBytes=await readFile(new URL(delivery.path,root));
 assert.equal(createHash('sha256').update(vendorBytes).digest('hex'),delivery.sha256,'the browser receives exactly the published library artifact');
 assert.equal(vendorBytes.length,delivery.bytes);
 const context=await browser.newContext({viewport:{width:430,height:932},locale:'en-US'}),page=await context.newPage();
 const vendor=deferred(),errors=[],rpc=[],vendorRequests=[],rawModules=[];let closing=false;
 t.after(async()=>{closing=true;vendor.resolve();await context.close();});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('swap_language','en');localStorage.setItem('fstswap_wallet_choice','disconnected');
  // Observe the real delivery script's global assignment without editing it.
  // A duplicate execution must remain observable for both UMD and subset IIFE.
  let value;window.__vendorEvaluations=0;
  Object.defineProperty(globalThis,'ethers',{configurable:true,get(){return value;},set(next){window.__vendorEvaluations++;value=next;}});
 });
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fstswap-time-nonce,x-fstswap-fresh','access-control-expose-headers':'x-fstswap-time-nonce,x-fstswap-server-time'};
  const fulfill=options=>route.fulfill(options).catch(error=>{if(!closing&&!/Target.*closed|Invalid InterceptionId|interception.*already|Route is already handled/i.test(error.message))throw error;});
  if(url.pathname.startsWith('/api/swap/')){
   if(request.method()==='OPTIONS')return fulfill({status:204,headers});
   if(url.pathname.endsWith('/health'))return fulfill({status:200,headers,json:{ready:true}});
   if(url.pathname.endsWith('/quote'))return fulfill({status:400,headers,json:{error:'NO_ROUTE'}});
   return fulfill({status:400,headers,json:{error:'No account in this read-only fixture'}});
  }
  if(url.origin!==origin){
   let body;try{body=request.postDataJSON();}catch{}
   if(body?.jsonrpc==='2.0'){
    rpc.push(body);const result=body.method==='eth_blockNumber'?'0x100':body.method==='eth_chainId'?'0x38':body.method==='eth_getBlockByNumber'?{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}:'0x'+'00'.repeat(32);
    return fulfill({status:200,headers,json:{jsonrpc:'2.0',id:body.id,result}});
   }
   return fulfill({status:503,headers,body:'offline fixture'});
  }
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(relative.startsWith('src/')&&/\.(mjs|js)$/.test(relative)&&!relative.startsWith('src/fst-runtime-'))rawModules.push(relative);
  if(url.pathname===vendorPath||/\/assets\/vendor\/(?:ethers\.umd\.min|ethers-6\.15\.0-fst\.min)\.js$/.test(url.pathname))vendorRequests.push({url:request.url(),at:Date.now()});
  if(url.pathname===vendorPath)await vendor.promise;
  try{const body=relative==='index.html'?index:await readFile(new URL(relative,root));return fulfill({body,contentType:/\.(mjs|js)$/.test(relative)?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.svg')?'image/svg+xml':relative.endsWith('.png')?'image/png':'text/html'});}catch{return fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/#/swap',{waitUntil:'commit'});
 async function realTimeout(){
  await page.waitForFunction(()=>document.querySelector('#root')?.innerText.includes('页面加载失败：交易依赖未加载'),{},{timeout:12000});
  assert.equal(vendorRequests.length,1);assert.ok(Date.now()-vendorRequests[0].at>=7900,'the original eight-second timeout must elapse in real time');
  assert.equal(await page.evaluate(()=>globalThis.ethers?.Interface===undefined),true);
 }
 return{page,errors,rpc,vendorRequests,rawModules,manifest,realTimeout,release:()=>vendor.resolve()};
}
async function singleOriginalVendor(f){
 assert.equal(f.vendorRequests.length,1,'late recovery must join the original request instead of injecting another vendor');
 assert.equal(await f.page.evaluate(()=>window.__vendorEvaluations),1,'the real library delivery must evaluate only once');
 assert.deepEqual(await f.page.evaluate(()=>['Interface','AbiCoder','getAddress','parseUnits','formatUnits','decodeBytes32String'].map(name=>[name,typeof globalThis.ethers?.[name]])),[['Interface','function'],['AbiCoder','function'],['getAddress','function'],['parseUnits','function'],['formatUnits','function'],['decodeBytes32String','function']]);
 assert.equal(await f.page.evaluate(()=>typeof globalThis.ethereum),'undefined');
 assert.deepEqual(f.rpc.filter(call=>/send|sign|approve|requestAccounts/i.test(call.method)),[]);
 assert.deepEqual(f.rawModules,[],'the actual published runtime must not route around generated chunks');
 assert.deepEqual(f.errors,[]);
 const scripts=await f.page.locator('script[type=module][src]').evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname.slice(1)));
 for(const key of ['boot','app'])assert.ok(scripts.includes(f.manifest.entries[key]));
}

test('published swap automatically recovers after the original vendor arrives beyond the real eight-second timeout',async t=>{
 const f=await fixture(t);await f.realTimeout();
 // Exercise lifecycle listeners synthetically; this is not a real BFCache restore.
 await f.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 f.release();
 await f.page.waitForFunction(()=>typeof globalThis.ethers?.Interface==='function',{},{timeout:2500});
 await singleOriginalVendor(f);
 await f.page.waitForFunction(()=>document.querySelector('#root main #swap-currency-input')&&!document.querySelector('#root main[inert]'),{},{timeout:2000});
 await f.page.locator('#swap-currency-input .open-currency-select-button').click();
 await f.page.locator('.fst-token-dialog').waitFor({state:'visible',timeout:1500});await f.page.keyboard.press('Escape');
 await f.page.locator('#connect-wallet').click();await f.page.locator('.fst-wallet-dialog').waitFor({state:'visible',timeout:1500});await f.page.keyboard.press('Escape');
 assert.doesNotMatch(await f.page.locator('#root').innerText(),/页面加载失败/);await singleOriginalVendor(f);
});

test('a late vendor cannot revive failed swap after a newer my route has already mounted',async t=>{
 const f=await fixture(t);await f.realTimeout();
 await f.page.evaluate(()=>{location.hash='#/my';});
 await f.page.waitForFunction(()=>document.querySelector('#root main')&&document.querySelector('#swap-nav-my')?.getAttribute('aria-current')==='page',{},{timeout:2000});
 await f.page.evaluate(()=>{window.__latestMain=document.querySelector('#root main');});
 f.release();await f.page.waitForFunction(()=>typeof globalThis.ethers?.Interface==='function',{},{timeout:2500});
 await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await f.page.evaluate(()=>location.hash),'#/my');
 assert.equal(await f.page.locator('#swap-nav-my').getAttribute('aria-current'),'page');
 assert.equal(await f.page.locator('#swap-currency-input').count(),0,'the newer my template must not acquire the old swap form');
 assert.equal(await f.page.evaluate(()=>document.querySelector('#root main')===window.__latestMain),true,'stale recovery must not remount or replace the newer route');
 await f.page.locator('#connect-wallet').click();await f.page.locator('.fst-wallet-dialog').waitFor({state:'visible',timeout:1500});await f.page.keyboard.press('Escape');
 await singleOriginalVendor(f);
});
