// Real published HTML and hash artifacts, with explicit offline read replies.
// No provider is installed, and no wallet connection/signature/transaction occurs.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url),origin='https://fst-runtime.test';
const U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a';
const routes=[
 {name:'swap',hash:'#/swap',source:'src/swap-view.mjs',active:'swap-nav-link'},
 {name:'analysis',hash:`#/analysis/${U}/${F}`,source:'src/swap-pages.mjs',active:'swap-nav-home'},
 {name:'my',hash:'#/my',source:'src/swap-pages.mjs',active:'swap-nav-my'},
 {name:'pool',hash:'#/pool',source:'src/swap-pool.mjs',active:'pool-nav-link'},
 {name:'add',hash:`#/add/v2/${U}/${F}`,source:'src/swap-pool.mjs',active:'pool-nav-link'},
 {name:'remove',hash:`#/remove/v2/${U}/${F}`,source:'src/swap-pool.mjs',active:'pool-nav-link'},
];
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>browser?.close());
function staticClosure(manifest,seeds){
 const files=new Map(manifest.files.map(file=>[file.path,file])),seen=new Set();
 const visit=key=>{if(seen.has(key))return;const file=files.get(key);assert.ok(file,'declared module must exist');seen.add(key);for(const item of file.imports)if(!item.external&&item.kind!=='dynamic-import')visit(item.path);};
 for(const seed of seeds)visit(seed);return seen;
}
function entry(manifest,source){const file=manifest.files.find(file=>file.entryPoint?.split('?')[0]===source);assert.ok(file,'the real published route entry must be discoverable');return file.path;}
function routeBudget(manifest,source){
 // This oracle follows the emitted import graph, not manifest.routePreloads or
 // the production route-selector algorithm being tested.
 return staticClosure(manifest,[manifest.entries.boot,manifest.entries.app,entry(manifest,'src/swap-service-client.mjs'),entry(manifest,source)]);
}
async function fixture(t,initial=routes[0]){
 const manifest=JSON.parse(await readFile(new URL('src/fst-runtime-manifest.json',root),'utf8'));
 const context=await browser.newContext({viewport:{width:430,height:932},locale:'en-US'}),page=await context.newPage();
 const requested=[],errors=[],critical=[],rpc=[];let closing=false;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.origin===origin&&/^\/src\/fst-runtime-.*\.mjs$/.test(url.pathname))requested.push(url.pathname.slice(1));});
 page.on('response',response=>{if(response.status()>=400&&['script','stylesheet','document'].includes(response.request().resourceType()))critical.push({url:response.url(),status:response.status()});});
 await page.addInitScript(()=>{
  localStorage.setItem('swap_language','en');localStorage.setItem('fstswap_wallet_choice','disconnected');
  let library;window.__ethersEvaluations=0;
  Object.defineProperty(globalThis,'ethers',{configurable:true,get(){return library;},set(value){window.__ethersEvaluations++;library=value;}});
 });
 t.after(async()=>{closing=true;await context.close();});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fstswap-time-nonce,x-fstswap-fresh','access-control-expose-headers':'x-fstswap-time-nonce,x-fstswap-server-time'};
  const reply=options=>route.fulfill(options).catch(error=>{if(!closing&&!/Target.*closed|Invalid InterceptionId|interception.*already|Route is already handled/i.test(error.message))throw error;});
  if(url.pathname.startsWith('/api/swap/')){
   if(request.method()==='OPTIONS')return reply({status:204,headers});
   if(url.pathname.endsWith('/health'))return reply({status:200,headers,json:{ready:true}});
   return reply({status:400,headers,json:{error:'NO_ROUTE'}});
  }
  if(url.origin!==origin){
   let body;try{body=request.postDataJSON();}catch{}
   if(body?.jsonrpc==='2.0'){
    rpc.push(body);
    const result=body.method==='eth_blockNumber'?'0x100':body.method==='eth_chainId'?'0x38':body.method==='eth_getBlockByNumber'?{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}:body.method==='eth_getCode'?'0x6001':'0x'+'00'.repeat(96);
    return reply({status:200,headers,json:{jsonrpc:'2.0',id:body.id,result}});
   }
   return reply({status:503,headers,body:'offline read fixture'});
  }
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
  try{const body=await readFile(new URL(relative,root));return reply({body,contentType:/\.(mjs|js)$/.test(relative)?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.svg')?'image/svg+xml':relative.endsWith('.png')?'image/png':'text/html'});}catch{return reply({status:404,body:''});}
 });
 await page.goto(origin+'/'+initial.hash,{waitUntil:'domcontentloaded'});
 async function ready(route,previousMain){
  await page.waitForFunction(({active,previous})=>{
   const main=document.querySelector('#root main');return main&&!main.hasAttribute('data-fst-initial')&&!main.inert&&document.querySelector('#'+active)?.getAttribute('aria-current')==='page'&&(!previous||main!==window.__priorMain);
  },{active:route.active,previous:!!previousMain},{timeout:6000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 }
 await ready(initial);
 return{page,manifest,requested,errors,critical,rpc,ready};
}
async function assertLibraryAndControls(f){
 assert.deepEqual(await f.page.evaluate(()=>{
  const names=['Interface','AbiCoder','getAddress','parseUnits','formatUnits','decodeBytes32String'];
  return names.map(name=>[name,typeof globalThis.ethers?.[name]]);
 }),[['Interface','function'],['AbiCoder','function'],['getAddress','function'],['parseUnits','function'],['formatUnits','function'],['decodeBytes32String','function']]);
 const sample=await f.page.evaluate(()=>({
  unit:String(ethers.parseUnits('1.000001',6)),
  formatted:ethers.formatUnits(1000000000000000001n,18),
  allowance:new ethers.Interface(['function allowance(address,address) view returns(uint256)']).encodeFunctionData('allowance',['0x'+'11'.repeat(20),'0x'+'22'.repeat(20)]),
  bool:ethers.AbiCoder.defaultAbiCoder().decode(['bool'],'0x'+'0'.repeat(63)+'1')[0],
  symbol:ethers.decodeBytes32String('0x55534454'+'00'.repeat(28)),
 }));
 assert.equal(sample.unit,'1000001');assert.equal(sample.formatted,'1.000000000000000001');assert.equal(sample.bool,true);assert.equal(sample.symbol,'USDT');assert.equal(sample.allowance,'0xdd62ed3e'+'0'.repeat(24)+'11'.repeat(20)+'0'.repeat(24)+'22'.repeat(20));
 await f.page.locator('#connect-wallet').click();await f.page.locator('.fst-wallet-dialog').waitFor({state:'visible',timeout:1500});await f.page.keyboard.press('Escape');await f.page.locator('.fst-wallet-dialog').waitFor({state:'detached',timeout:1500});
 assert.equal(await f.page.evaluate(()=>window.__ethersEvaluations),1,'all route changes must share one vendor evaluation');
 assert.equal(await f.page.evaluate(()=>typeof globalThis.ethereum),'undefined');
 assert.deepEqual(f.rpc.filter(call=>/send|sign|approve|requestAccounts/i.test(call.method)),[]);
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.critical,[]);
 assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
}
for(const route of [...routes,{...routes[0],name:'default empty hash',hash:''},{...routes[0],name:'unknown hash fallback',hash:'#/unknown'},{...routes[0],name:'swap query suffix',hash:'#/swap?from=test'},...['__proto__','constructor','toString'].map(name=>({...routes[0],name:'prototype hash '+name,hash:'#/'+name}))])test(`cold ${route.name} downloads only its current-route import closure and is interactive`,async t=>{
 const f=await fixture(t,route),allowed=routeBudget(f.manifest,route.source);
 const extras=[...new Set(f.requested)].filter(file=>!allowed.has(file));
 assert.deepEqual(extras,[],'unvisited routes must not compete for cold-start bandwidth');
 for(const file of staticClosure(f.manifest,[entry(f.manifest,route.source)]))assert.ok(f.requested.includes(file),'the selected route must load its complete actual import closure');
 await assertLibraryAndControls(f);
});
test('a cold swap opens previously unrequested pool and analysis modules on later hash navigation without reloading or duplicating vendor',async t=>{
 const f=await fixture(t),initial=routeBudget(f.manifest,routes[0].source);
 assert.deepEqual([...new Set(f.requested)].filter(file=>!initial.has(file)),[]);
 await f.page.evaluate(()=>{window.__documentToken={};window.__sameDocument=window.__documentToken;});
 for(const next of [routes[3],routes[1],routes[2],routes[4],routes[5],routes[0]]){
  const before=f.requested.length;
  await f.page.evaluate(hash=>{window.__priorMain=document.querySelector('#root main');location.hash=hash;},next.hash);
  await f.ready(next,true);
  const allowed=routeBudget(f.manifest,next.source);
  assert.deepEqual([...new Set(f.requested.slice(before))].filter(file=>!allowed.has(file)),[],'only the newly selected route may add requests');
  assert.equal(await f.page.evaluate(()=>window.__sameDocument===window.__documentToken),true,'hash navigation must keep the live document');
  await assertLibraryAndControls(f);
 }
 await f.page.locator('#swap-currency-input .open-currency-select-button').click();
 await f.page.locator('.fst-common-token').filter({hasText:/^USDC$/}).click();
 assert.equal(await f.page.locator('#swap-currency-input .token-symbol-container').textContent(),'USDC');
 assert.equal(await f.page.locator('#swap-currency-output input').evaluate(input=>input.readOnly),true);
});
