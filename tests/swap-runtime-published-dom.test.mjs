// Complete published-index runtime, served byte-for-byte from this checkout.
// API replies are explicit fixtures. No provider, signature or transaction exists.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {validateServiceQuote} from '../src/swap-service-client.mjs';
import {FSTSWAP_CONFIG} from '../src/fstswap-config.mjs';
import {SWAP_ADAPTERS} from '../src/swap-aggregator.mjs';

const root=new URL('../',import.meta.url),origin='https://fstswap.pro';
// Historical RED is byte-for-byte commit44, not a string-edited current index.
const baseline=process.env.FST_RUNTIME_PUBLISHED_BASELINE==='1',run=promisify(execFile);
async function asset(relative){
 if(!baseline)return readFile(new URL(relative,root));
 return(await run('git',['show','171508db7518c1656433d1ee6c92ef0cdacd9dca:'+relative],{cwd:fileURLToPath(root),encoding:'buffer',maxBuffer:4*1024*1024})).stdout;
}
const U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const W='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',A='0x'+'aa'.repeat(20),POOL='0x'+'44'.repeat(20);
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$bigint:String(v)}:v);
function wire(request,{at=Date.now(),out=4000000n}={}){
 const amount=BigInt(request.amountIn),fee=amount*30n/10000n,min=out*(10000n-BigInt(request.slippageBps))/10000n,P=SWAP_ADAPTERS.pancake.adapter;
 const leg={adapter:P,kind:'v2',path:[request.tokenIn,request.tokenOut],tokenIn:request.tokenIn,tokenOut:request.tokenOut,amountIn:amount-fee,out,weightBps:10000,poolIds:[POOL]};
 const stage={tokenIn:request.tokenIn,tokenOut:request.tokenOut,out,legs:[leg]};
 return{schema:1,chainId:56,router:FSTSWAP_CONFIG.router,input:{chainId:56,...request,amountIn:String(amount)},blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:at,expiresAt:at+15000,
  config:{version:'2.1.0',platformFeeBps:30,feeReceiver:A,wbnb:W,defaultFeeToken:U,feeConfigVersion:5n,adaptersOff:[]},
  quote:{kind:'fstswap',tokenIn:request.tokenIn,tokenOut:request.tokenOut,amountIn:amount,out,minimum:min,lpFee:fee,feeToken:request.tokenIn,feeMode:'input',configVersion:5n,impact:0,poolCheckedAt:at,
   stages:[{tokenIn:request.tokenIn,tokenOut:request.tokenOut,minOut:min,branches:[{adapter:P,kind:0,weightBps:10000,path:[request.tokenIn,request.tokenOut],v3Path:'0x'}]}],
   segments:[{from:request.tokenIn,to:request.tokenOut,amountIn:amount-fee,out,minimum:min,impact:0,legs:[leg],routeStages:[stage]}]}};
}
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>browser?.close());
async function fixture(t,{settings={slippageBps:0,singleHop:true},holdCss=false}={}){
 const context=await browser.newContext({viewport:{width:430,height:932},locale:'en-US'}),page=await context.newPage();
 const uiGate=deferred(),ethersGate=deferred(),cssGate=deferred(),posts=[],errors=[],rpc=[],rawModules=[],blockedUI=[],blockedCss=[],waiters=new Set();
 let manifest;try{manifest=JSON.parse(await asset('src/fst-runtime-manifest.json'));}catch{}
 const stylesheetSources=new Map((manifest?.cacheAssets?.filter(file=>file.source.endsWith('.css'))||['src/swap-official.css','src/swap-manage.css','src/swap-ui.css'].map(source=>({source,path:source}))).map(file=>[file.path,file.source]));
 const uiPaths=new Set(manifest?.files?.filter(file=>file.inputs.some(input=>input.includes('swap-official-tpl.mjs'))).map(file=>'/'+file.path)||['/src/swap-official-tpl.mjs']);
 assert.ok(uiPaths.size,'the manifest must locate the real UI template output');
 let closing=false,uiReleased=false,ethersReleased=false,cssReleased=!holdCss;
 const notify=()=>{for(const waiter of waiters)if(posts.length>=waiter.count){clearTimeout(waiter.timer);waiters.delete(waiter);waiter.resolve();}};
 function waitQuotes(count,timeout=2500){if(posts.length>=count)return Promise.resolve();return new Promise((resolve,reject)=>{const waiter={count,resolve,timer:setTimeout(()=>{waiters.delete(waiter);reject(Error(`Published index did not start quote ${count} while UI templates and ethers were blocked`));},timeout)};waiters.add(waiter);});}
 t.after(async()=>{closing=true;uiGate.resolve();ethersGate.resolve();cssGate.resolve();for(const post of posts)post.gate.resolve({status:400,body:{error:'NO_ROUTE'}});for(const waiter of waiters){clearTimeout(waiter.timer);waiter.resolve();}await context.close();});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(settings=>{
  localStorage.setItem('swap_language','en');localStorage.setItem('fstswap_wallet_choice','disconnected');localStorage.setItem('swap_settings_v2',JSON.stringify(settings));
  window.__runtimeReads=[];
  const fetch=window.fetch.bind(window);
  window.fetch=(url,init)=>{
   if(!String(url).includes('/api/swap/quote'))return fetch(url,init);
   const number=window.__runtimeReads.filter(e=>e.phase==='start').length+1;
   window.__runtimeReads.push({number,phase:'start',body:init?.body});
   init?.signal?.addEventListener('abort',()=>window.__runtimeReads.push({number,phase:'abort'}),{once:true});
   return fetch(url,init).then(response=>{window.__runtimeReads.push({number,phase:'headers'});return response;},error=>{window.__runtimeReads.push({number,phase:'reject',name:error?.name});throw error;});
  };
 },settings);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fstswap-time-nonce,x-fstswap-fresh','access-control-expose-headers':'x-fstswap-time-nonce,x-fstswap-server-time'};
  const fulfill=options=>route.fulfill(options).catch(error=>{if(!closing&&!/Target.*closed|Invalid InterceptionId|interception.*already|Route is already handled/i.test(error.message))throw error;});
  if(url.pathname.startsWith('/api/swap/')){
   if(request.method()==='OPTIONS')return fulfill({status:204,headers});
   if(url.pathname.endsWith('/health'))return fulfill({status:200,headers,json:{ready:true}});
   const body=request.postDataJSON(),nonce=request.headers()['x-fstswap-time-nonce'];
   if(url.pathname.endsWith('/quote')){
    const gate=deferred(),post={body,gate,beforeUI:!uiReleased,beforeEthers:!ethersReleased,beforeCss:!cssReleased};posts.push(post);notify();
    const result=await gate.promise;
    if(nonce){headers['x-fstswap-time-nonce']=nonce;headers['x-fstswap-server-time']=String(Date.now());}
    return fulfill({status:result.status,headers,contentType:'application/json',body:encode(result.body)});
   }
   return fulfill({status:400,headers,json:{error:'Unexpected disconnected balance request'}});
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
  if(holdCss&&stylesheetSources.has(relative)){blockedCss.push(stylesheetSources.get(relative));await cssGate.promise;}
  if(relative.startsWith('src/')&&/\.(mjs|js)$/.test(relative)&&!relative.startsWith('src/fst-runtime-'))rawModules.push(relative);
  if(uiPaths.has(url.pathname)){blockedUI.push(relative);await uiGate.promise;}
  if(relative==='assets/vendor/ethers.umd.min.js'||/^assets\/vendor\/fst-ethers-[A-F0-9]{16}\.js$/.test(relative))await ethersGate.promise;
  try{const data=await asset(relative);return fulfill({body:data,contentType:/\.(mjs|js)$/.test(relative)?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.svg')?'image/svg+xml':relative.endsWith('.png')?'image/png':'text/html'});}catch{return fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/#/swap',{waitUntil:'commit'});
 const releaseUI=()=>{uiReleased=true;uiGate.resolve();},releaseEthers=()=>{ethersReleased=true;ethersGate.resolve();},releaseCss=()=>{cssReleased=true;cssGate.resolve();};
 return{page,posts,rpc,errors,manifest,rawModules,blockedUI,blockedCss,waitQuotes,releaseUI,releaseEthers,releaseCss,
  respond(index,{out=4000000n}={}){const post=posts[index];post.gate.resolve({status:200,body:wire(post.body,{out})});}};
}
async function hydrated(f){
 await f.page.waitForFunction(()=>globalThis.ethers?.Interface&&document.querySelector('#swap-currency-input')&&!document.querySelector('main[inert]'),{},{timeout:5000});
 await f.page.locator('#swap-currency-input .open-currency-select-button').click();
 await f.page.locator('.fst-token-dialog').waitFor({state:'visible',timeout:1500});await f.page.keyboard.press('Escape');
 await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function noWalletOrRaw(f){
 assert.equal(await f.page.evaluate(()=>typeof globalThis.ethereum),'undefined');
 assert.deepEqual(f.rpc.filter(call=>/send|sign|approve|requestAccounts/i.test(call.method)),[]);
 assert.deepEqual(f.errors,[]);
 if(f.manifest){assert.deepEqual(f.rawModules,[],'published runtime must not bypass its bundle through original src modules');const scripts=await f.page.locator('script[type=module][src]').evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname.slice(1)));for(const key of ['boot','app'])assert.ok(scripts.includes(f.manifest.entries[key]),`published index must use manifest ${key} entry`);}
}

test('published-runtime wire fixture retains the real staged quote validator',()=>{
 const input={chainId:56,tokenIn:U,tokenOut:F,amountIn:'1000000000000000000',slippageBps:0,singleHop:true},at=Date.now();
 assert.ok(validateServiceQuote(wire(input,{at}),input,{router:FSTSWAP_CONFIG.router,adapters:SWAP_ADAPTERS,clock:()=>at,expectedVersion:'2.1.0'}));
});

test('published index starts saved-settings quote behind blocked UI and ethers, then app joins the same pending request',async t=>{
 const f=await fixture(t);await f.waitQuotes(1);
 assert.ok(f.posts[0].beforeUI&&f.posts[0].beforeEthers);assert.ok(f.blockedUI.length,'the actual published UI template output must be held');assert.equal(await f.page.evaluate(()=>typeof globalThis.ethers),'undefined');
 assert.ok(await f.page.locator('main[inert]').count(),'the published form must still await its blocked UI/library dependency');
 assert.equal(f.posts[0].body.tokenIn.toLowerCase(),U);assert.equal(f.posts[0].body.tokenOut.toLowerCase(),F);assert.equal(f.posts[0].body.amountIn,'1000000000000000000');assert.equal(f.posts[0].body.slippageBps,0);assert.equal(f.posts[0].body.singleHop,true);
 f.releaseUI();f.releaseEthers();await hydrated(f);
 assert.equal(f.posts.length,1,'boot, app startup and unit-price view must share one physical pending quote');
 f.respond(0);await f.page.waitForFunction(()=>document.querySelector('#swap-page button.kePVKR')?.innerText==='1 FIST = 0.25 USDT');
 assert.equal(f.posts.length,1);await noWalletOrRaw(f);
});

test('published app reuses an early completed quote within its original two-second cache window',async t=>{
 const f=await fixture(t);await f.waitQuotes(1);const completedAt=Date.now();f.respond(0);
 await f.page.waitForFunction(()=>window.__runtimeReads.some(e=>e.number===1&&e.phase==='headers'));
 f.releaseUI();f.releaseEthers();await hydrated(f);
 await f.page.waitForFunction(()=>document.querySelector('#swap-page button.kePVKR')?.innerText==='1 FIST = 0.25 USDT');
 assert.ok(Date.now()-completedAt<2000,'fixture must finish before the existing two-second cache expires');
 assert.equal(f.posts.length,1,'the published app must consume the same completed service cache');await noWalletOrRaw(f);
});

test('leaving swap aborts early quote, ignored late response cannot satisfy the next visit',async t=>{
 const f=await fixture(t);await f.waitQuotes(1);
 await f.page.evaluate(()=>{location.hash='#/my';});
 await f.page.waitForFunction(()=>window.__runtimeReads.some(e=>e.number===1&&e.phase==='abort'),{},{timeout:1500});
 f.respond(0);await f.page.evaluate(()=>Promise.resolve());
 assert.equal(f.posts.length,1);
 await f.page.evaluate(()=>{location.hash='#/swap';});await f.waitQuotes(2);
 f.releaseUI();f.releaseEthers();await hydrated(f);
 assert.equal(f.posts.length,2,'returning view must join the replacement request instead of using aborted data or a third client');
 f.respond(1,{out:2000000n});await f.page.waitForFunction(()=>document.querySelector('#swap-page button.kePVKR')?.innerText==='1 FIST = 0.5 USDT');
 assert.equal(f.posts.length,2);assert.doesNotMatch(await f.page.locator('#swap-page button.kePVKR').innerText(),/0\.25/);await noWalletOrRaw(f);
});

test('published UI cannot revive an early quote after its real two-second completed cache expires',async t=>{
 const f=await fixture(t);await f.waitQuotes(1);
 const original=wire(f.posts[0].body,{out:4000000n});
 const originalTimes={quotedAt:original.quotedAt,expiresAt:original.expiresAt};
 f.posts[0].gate.resolve({status:200,body:original});
 await f.page.waitForFunction(()=>window.__runtimeReads.some(e=>e.number===1&&e.phase==='headers'));
 // Use elapsed real time: neither Date.now, the service clock nor cache TTL is patched.
 await new Promise(resolve=>setTimeout(resolve,2050));
 assert.ok(Date.now()-original.quotedAt>2000);
 assert.ok(original.expiresAt>Date.now(),'the original quote is still inside its separate fifteen-second validity window');
 assert.deepEqual({quotedAt:original.quotedAt,expiresAt:original.expiresAt},originalTimes);
 assert.equal(f.posts.length,1,'UI remains blocked while the ordinary completed cache ages out');
 f.releaseUI();f.releaseEthers();await f.waitQuotes(2);await hydrated(f);
 assert.equal(f.posts.length,2,'app and view must share the new pending quote rather than revive old cache or issue a third request');
 assert.equal(await f.page.locator('#swap-page button.kePVKR').count(),0,'the old default unit price must remain unpublished while replacement quotation is pending');
 f.respond(1,{out:2000000n});
 await f.page.waitForFunction(()=>document.querySelector('#swap-page button.kePVKR')?.innerText==='1 FIST = 0.5 USDT');
 assert.equal(f.posts.length,2);await noWalletOrRaw(f);
});

test('published async boot quotes while all three stylesheets, UI template and ethers remain blocked',async t=>{
 const f=await fixture(t,{holdCss:true});await f.waitQuotes(1);
 assert.deepEqual([...new Set(f.blockedCss)].sort(),['src/swap-manage.css','src/swap-official.css','src/swap-ui.css']);
 assert.ok(f.blockedUI.length,'the generated UI template output must also be held');
 assert.ok(f.posts[0].beforeCss&&f.posts[0].beforeUI&&f.posts[0].beforeEthers);
 assert.equal(await f.page.evaluate(()=>typeof globalThis.ethers),'undefined');
 assert.equal(f.posts[0].body.tokenIn.toLowerCase(),U);assert.equal(f.posts[0].body.tokenOut.toLowerCase(),F);
 assert.equal(f.posts[0].body.amountIn,'1000000000000000000');assert.equal(f.posts[0].body.slippageBps,0);assert.equal(f.posts[0].body.singleHop,true);
 // Blocking CSS may hold the following inline script/parser before SSR main exists.
 f.releaseCss();f.releaseUI();f.releaseEthers();await hydrated(f);
 assert.equal(f.posts.length,1,'CSS release and app hydration must keep the same physical pending quote');
 f.respond(0);await f.page.waitForFunction(()=>document.querySelector('#swap-page button.kePVKR')?.innerText==='1 FIST = 0.25 USDT');
 assert.equal(f.posts.length,1);await noWalletOrRaw(f);
});
