import {fileURLToPath} from 'node:url';
// Independent acceptance: execute the actual frozen HTML/generated runtime with
// local read fixtures. Service clocks, 6500ms timeout and 30000ms cooldown stay
// real. No provider, native wallet connection, signature or transaction exists.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {validateServiceQuote} from '../src/swap-service-client.mjs';
import {FSTSWAP_CONFIG} from '../src/fstswap-config.mjs';
import {SWAP_ADAPTERS} from '../src/swap-aggregator.mjs';
const root=new URL('../',import.meta.url),origin='https://fstswap-live.vercel.app';
const output=fileURLToPath(new URL('../ops/evidence/maintenance/pair-price-recovery',import.meta.url));
const U='0x55d398326f99059ff775485246999027b3197955',F='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',C='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const W='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',A='0x'+'aa'.repeat(20),POOL='0x'+'44'.repeat(20);
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$bigint:String(x)}:x);
function wire(request,out=4000000n){
 const at=Date.now(),amount=BigInt(request.amountIn),fee=amount*30n/10000n,min=out*(10000n-BigInt(request.slippageBps))/10000n,P=SWAP_ADAPTERS.pancake.adapter;
 const leg={adapter:P,kind:'v2',path:[request.tokenIn,request.tokenOut],tokenIn:request.tokenIn,tokenOut:request.tokenOut,amountIn:amount-fee,out,weightBps:10000,poolIds:[POOL]};
 const stage={tokenIn:request.tokenIn,tokenOut:request.tokenOut,out,legs:[leg]};
 const data={schema:1,chainId:56,router:FSTSWAP_CONFIG.router,input:{...request},blockNumber:'0x10',blockHash:'0x'+'ab'.repeat(32),quotedAt:at,expiresAt:at+15000,
  config:{version:'2.1.0',platformFeeBps:30,feeReceiver:A,wbnb:W,defaultFeeToken:U,feeConfigVersion:5n,adaptersOff:[]},
  quote:{kind:'fstswap',tokenIn:request.tokenIn,tokenOut:request.tokenOut,amountIn:amount,out,minimum:min,lpFee:fee,feeToken:request.tokenIn,feeMode:'input',configVersion:5n,impact:0,poolCheckedAt:at,
   stages:[{tokenIn:request.tokenIn,tokenOut:request.tokenOut,minOut:min,branches:[{adapter:P,kind:0,weightBps:10000,path:[request.tokenIn,request.tokenOut],v3Path:'0x'}]}],
   segments:[{from:request.tokenIn,to:request.tokenOut,amountIn:amount-fee,out,minimum:min,impact:0,legs:[leg],routeStages:[stage]}]}};
 validateServiceQuote(data,request,{router:FSTSWAP_CONFIG.router,adapters:SWAP_ADAPTERS,expectedVersion:FSTSWAP_CONFIG.version});
 return data;
}
let browser;
before(async()=>{await mkdir(output,{recursive:true});browser=await chromium.launch({headless:true});});
after(async()=>browser?.close());
async function fixture(t,name){
 // Freeze one complete published generation before navigation. Later build
 // work cannot silently mix a newly emitted entry into this fixture's HTML.
 const manifestBytes=await readFile(new URL('src/fst-runtime-manifest.json',root)),manifest=JSON.parse(manifestBytes);
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const html=await readFile(new URL('index.html',root));
 const expectedAssets=new Map([...manifest.files,...manifest.cacheAssets,...(manifest.mutableAssets||[])].map(a=>[a.path,a.sha256]));
 const frozenAssets=new Map([['index.html',html]]);
 for(const [relative,sha] of expectedAssets){const bytes=await readFile(new URL(relative,root));assert.equal(digest(bytes),sha,'frozen asset must match manifest: '+relative);frozenAssets.set(relative,bytes);}
 const identity={manifestSHA256:digest(manifestBytes),htmlSHA256:digest(html),entries:structuredClone(manifest.entries)};
 const context=await browser.newContext({viewport:{width:430,height:932},locale:'en-US'}),page=await context.newPage();
 const posts=[],errors=[],critical=[],rpc=[],raw=[],requests=[],resourceHashes=[],hashChecks=[];let closing=false;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin)requests.push(u.pathname);});
 page.on('response',r=>{
  if(['script','stylesheet','document'].includes(r.request().resourceType())&&r.status()>=400)critical.push({url:r.url(),status:r.status()});
  const url=new URL(r.url()),relative=url.pathname==='/'?'index.html':url.pathname.slice(1),expected=relative==='index.html'?identity.htmlSHA256:expectedAssets.get(relative);
  if(url.origin===origin&&expected)hashChecks.push((async()=>{const bytes=await r.body();resourceHashes.push({path:relative,sha256:digest(bytes),expectedSHA256:expected,bytes:bytes.length});})());
 });
 await page.addInitScript(()=>{
  localStorage.setItem('swap_language','en');localStorage.setItem('fstswap_wallet_choice','disconnected');
  localStorage.setItem('swap_settings_v2',JSON.stringify({slippageBps:50,singleHop:true}));
  window.__pairReads=[];window.__priceChanges=[];
  const fetch=window.fetch;
  window.fetch=function(...args){
   const [url,init]=args;if(!String(url).includes('/api/swap/quote'))return fetch.apply(this,args);
   const number=window.__pairReads.filter(e=>e.phase==='start').length+1;
   window.__pairReads.push({number,phase:'start',at:performance.now(),body:JSON.parse(init.body),fresh:init.headers['x-fstswap-fresh']==='1'});
   init.signal.addEventListener('abort',()=>window.__pairReads.push({number,phase:'abort',at:performance.now(),reason:init.signal.reason?.name}),{once:true});
   return fetch.apply(this,args).then(r=>{window.__pairReads.push({number,phase:'headers',at:performance.now(),status:r.status});return r;},e=>{window.__pairReads.push({number,phase:'reject',at:performance.now(),name:e.name});throw e;});
  };
  let prior;new MutationObserver(()=>{const value=document.querySelector('#swap-page button.kePVKR')?.textContent||null;if(value!==prior){prior=value;window.__priceChanges.push({at:performance.now(),value});}}).observe(document,{subtree:true,childList:true,characterData:true});
 });
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fstswap-time-nonce,x-fstswap-fresh','access-control-expose-headers':'x-fstswap-time-nonce,x-fstswap-server-time'};
  const reply=o=>route.fulfill(o).catch(e=>{if(!closing&&!/closed|Invalid InterceptionId|already handled/i.test(e.message))throw e;});
  if(url.pathname.startsWith('/api/swap/')){
   if(request.method()==='OPTIONS')return reply({status:204,headers});
   if(url.pathname.endsWith('/health'))return reply({status:200,headers,json:{ready:true}});
   if(url.pathname.endsWith('/quote')){
    const gate=deferred(),post={index:posts.length,at:Date.now(),body:request.postDataJSON(),nonce:request.headers()['x-fstswap-time-nonce'],fresh:request.headers()['x-fstswap-fresh']==='1',gate};posts.push(post);
    const result=await gate.promise;
    if(post.nonce){headers['x-fstswap-time-nonce']=post.nonce;headers['x-fstswap-server-time']=String(Date.now());}
    return reply({status:result.status,headers,contentType:'application/json',body:encode(result.data)});
   }
   return reply({status:400,headers,json:{error:'Unexpected disconnected balance request'}});
  }
  if(url.origin!==origin){
   let body;try{body=request.postDataJSON();}catch{}
   if(body?.jsonrpc==='2.0'){
    rpc.push(body);const result=body.method==='eth_blockNumber'?'0x100':body.method==='eth_chainId'?'0x38':body.method==='eth_getBlockByNumber'?{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}:'0x'+'00'.repeat(96);
    return reply({status:200,headers,json:{jsonrpc:'2.0',id:body.id,result}});
   }
   return reply({status:503,headers,body:'local fixture only'});
  }
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(/^src\/.*\.(?:js|mjs)$/.test(relative)&&!relative.startsWith('src/fst-runtime-'))raw.push(relative);
  try{return reply({body:frozenAssets.get(relative)??await readFile(new URL(relative,root)),contentType:/\.(js|mjs)$/.test(relative)?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.svg')?'image/svg+xml':relative.endsWith('.png')?'image/png':'text/html'});}catch{return reply({status:404,body:''});}
 });
 t.after(async()=>{
  const reads=await page.evaluate(()=>({reads:window.__pairReads,prices:window.__priceChanges,hidden:document.hidden,online:navigator.onLine,hash:location.hash,price:document.querySelector('#swap-page button.kePVKR')?.textContent||null})).catch(()=>null);
  await Promise.all(hashChecks);
  await writeFile(output+'/'+name+'.json',JSON.stringify({name,app:manifest.entries.app,identity,resourceHashes,scope:'real generated HTML/modules, local API fixtures, real service clocks/timeouts/cooldown; lifecycle hidden emulated only where stated, offline uses browser network state; no wallet',reads,posts:posts.map(({gate,...p})=>p),errors,critical,rpc:rpc.map(p=>p.method),raw,requests},null,2)+'\n');
  closing=true;for(const p of posts)p.gate.resolve({status:503,data:{error:'fixture cleanup'}});await context.close();
 });
 await page.goto(origin+'/#/swap',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#swap-currency-input')&&typeof ethers?.Interface==='function'&&!document.querySelector('main[inert]'));
 const waitPost=async count=>{const until=Date.now()+2000;while(posts.length<count&&Date.now()<until)await new Promise(r=>setTimeout(r,20));assert.equal(posts.length,count,'expected exactly '+count+' physical quote POSTs');};
 const respond=(n,out=4000000n)=>{posts[n].gate.resolve({status:200,data:wire(posts[n].body,out)});};
 const fail=async()=>{await waitPost(1);posts[0].gate.resolve({status:503,data:{error:'SERVICE_UNAVAILABLE'}});await page.waitForFunction(()=>window.__pairReads.some(r=>r.number===1&&r.phase==='headers'&&r.status===503));await page.evaluate(()=>Promise.resolve());return Date.now();};
 const cooldownTrace=()=>page.evaluate(()=>{
  const reads=window.__pairReads,failed=reads.find(r=>r.number===1&&(r.phase==='headers'&&r.status===503||r.phase==='reject'&&r.name==='TimeoutError'));
  return{failedAt:failed?.at,starts:reads.filter(r=>r.phase==='start').map(r=>({number:r.number,at:r.at}))};
 });
 const assertCooldown=async()=>{
  const trace=await cooldownTrace();assert.ok(Number.isFinite(trace.failedAt));
  for(const start of trace.starts.filter(r=>r.number>1))assert.ok(start.at-trace.failedAt>=30000,'every recovery POST must preserve the full original 30000ms cooldown on the browser monotonic clock');
  return trace;
 };
 const waitCooldownBoundary=async()=>{
  await page.evaluate(async()=>{
   const failed=window.__pairReads.find(r=>r.number===1&&(r.phase==='headers'&&r.status===503||r.phase==='reject'&&r.name==='TimeoutError'));
   if(!failed)throw Error('Missing first browser failure sample');
   const remaining=failed.at+29900-performance.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
  });
  // If a busy test runner observes this boundary late, inspect the timestamped
  // browser requests instead of subtracting a late Node Date.now observation.
  await assertCooldown();
 };
 const waitPrice=async text=>{await page.waitForFunction(text=>document.querySelector('#swap-page button.kePVKR')?.textContent===text,text,{timeout:2000});};
 const noPrice=async()=>assert.equal(await page.locator('#swap-page button.kePVKR').count(),0,'no rejected, pending or expired quote may be displayed');
 const audit=async()=>{
  assert.equal(await page.evaluate(()=>typeof globalThis.ethereum),'undefined');assert.deepEqual(errors,[]);assert.deepEqual(critical,[]);assert.deepEqual(raw,[]);
  assert.deepEqual(rpc.filter(r=>/sign|send|approve|requestAccounts/i.test(r.method)),[]);
  assert.ok(requests.includes('/'+manifest.entries.app));
  const actualEntries=await page.locator('script[type=module][src]').evaluateAll(nodes=>nodes.map(n=>new URL(n.src).pathname.slice(1)));
  for(const entry of Object.values(identity.entries))assert.ok(actualEntries.includes(entry),'actual HTML module entry must match the fixture-frozen manifest URL');
  await Promise.all(hashChecks);
  for(const row of resourceHashes)assert.equal(row.sha256,row.expectedSHA256,'browser response bytes must match frozen manifest: '+row.path);
  for(const entry of Object.values(identity.entries))assert.ok(resourceHashes.some(r=>r.path===entry),'the browser must actually receive each manifest entry');
 };
 return{page,context,posts,waitPost,respond,fail,waitPrice,noPrice,audit,assertCooldown,waitCooldownBoundary};
}
const until=async at=>{const ms=at-Date.now();if(ms>0)await new Promise(r=>setTimeout(r,ms));};
test('independent published DOM recovery and cancellation boundaries',{concurrency:14},async t=>{
 await Promise.all([
  t.test('HTTP failure respects real 30s cooldown then sends fresh valid POST and displays price',async t=>{
   const f=await fixture(t,'http-failure-recovery');await f.fail();await f.noPrice();
   await f.waitCooldownBoundary();await f.noPrice();
   await f.waitPost(2);await f.assertCooldown();assert.ok(f.posts[1].fresh);assert.match(f.posts[1].nonce,/^[0-9a-f]{32}$/);
   assert.equal(f.posts[1].body.amountIn,'1000000000000000000');f.respond(1);await f.waitPrice('1 FIST = 0.25 USDT');await f.audit();
  }),
  t.test('real 6500ms timeout settles before original 30s cooldown and a new valid POST',async t=>{
   const f=await fixture(t,'timeout-recovery');await f.waitPost(1);
   await f.page.waitForFunction(()=>window.__pairReads.some(r=>r.number===1&&r.phase==='reject'&&r.name==='TimeoutError'),null,{timeout:7500});
   const timed=await f.page.evaluate(()=>{const a=window.__pairReads;return{start:a.find(r=>r.number===1&&r.phase==='start').at,end:a.find(r=>r.number===1&&r.phase==='reject').at};});
   assert.ok(timed.end-timed.start>=6450&&timed.end-timed.start<7300,'the unmodified 6500ms timeout must fire');
   await f.waitCooldownBoundary();await f.noPrice();
   await f.waitPost(2);await f.assertCooldown();assert.ok(f.posts[1].fresh);f.respond(1,2000000n);await f.waitPrice('1 FIST = 0.5 USDT');await f.audit();
  }),
  ...['hidden','offline'].map(mode=>t.test(mode+' cancels queued recovery; resuming starts only the current pair',async t=>{
   const f=await fixture(t,mode+'-pause'),failedAt=await f.fail();
   if(mode==='hidden')await f.page.evaluate(()=>{window.__fixtureHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__fixtureHidden});document.dispatchEvent(new Event('visibilitychange'));});
   else{await f.context.setOffline(true);await f.page.waitForFunction(()=>navigator.onLine===false);}
   await until(failedAt+31500);assert.equal(f.posts.length,1);await f.noPrice();
   if(mode==='hidden')await f.page.evaluate(()=>{window.__fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});else{await f.context.setOffline(false);await f.page.waitForFunction(()=>navigator.onLine===true);}
   await f.waitPost(2);f.respond(1);await f.waitPrice('1 FIST = 0.25 USDT');await f.audit();
  })),
  t.test('changing token during cooldown replaces old retry ownership',async t=>{
   const f=await fixture(t,'token-cooldown'),failedAt=await f.fail();
   await f.page.locator('#swap-currency-input .open-currency-select-button').click();await f.page.locator('.fst-common-token').filter({hasText:/^USDC$/}).click();
   assert.equal(await f.page.locator('#swap-currency-input .token-symbol-container').textContent(),'USDC');
   await f.waitCooldownBoundary();await f.noPrice();await f.waitPost(2);await f.assertCooldown();
   assert.equal(f.posts[1].body.tokenIn,C);assert.equal(f.posts[1].body.tokenOut,F);assert.ok(f.posts[1].fresh);f.respond(1,2000000n);await f.waitPrice('1 FIST = 0.5 USDC');await f.audit();
  }),
  t.test('hash navigation removes queued recovery and a new visit does not revive the old timer',async t=>{
   const f=await fixture(t,'route-disposal'),failedAt=await f.fail();await f.page.evaluate(()=>{location.hash='#/my';});await f.page.waitForFunction(()=>document.querySelector('#swap-nav-my')?.getAttribute('aria-current')==='page');
   await until(failedAt+31500);assert.equal(f.posts.length,1);await f.page.evaluate(()=>{location.hash='#/swap';});await f.waitPost(2);await f.noPrice();f.respond(1);await f.waitPrice('1 FIST = 0.25 USDT');await f.audit();
  }),
  t.test('pagehide removes queued recovery and pageshow resumes without the old result',async t=>{
   const f=await fixture(t,'pagehide-disposal'),failedAt=await f.fail();await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
   await until(failedAt+31500);assert.equal(f.posts.length,1);await f.noPrice();await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await f.waitPost(2);f.respond(1);await f.waitPrice('1 FIST = 0.25 USDT');await f.audit();
  }),
  t.test('late old-pair response after token selection cannot paint or schedule stale recovery',async t=>{
   const f=await fixture(t,'late-pair-response');await f.waitPost(1);await f.page.locator('#swap-currency-input .open-currency-select-button').click();await f.page.locator('.fst-common-token').filter({hasText:/^USDC$/}).click();await f.waitPost(2);
   f.respond(0);await f.page.evaluate(()=>new Promise(r=>setTimeout(r,100)));await f.noPrice();assert.equal(f.posts[1].body.tokenIn,C);f.respond(1,2000000n);await f.waitPrice('1 FIST = 0.5 USDC');await f.page.waitForTimeout(1000);assert.equal(f.posts.length,2);await f.audit();
  }),
  t.test('real slippage UI rearms the new identity without bypassing failed quote cooldown',async t=>{
   const f=await fixture(t,'slippage-during-cooldown');await f.fail();
   await f.page.locator('#open-settings-dialog-button').click();
   await f.page.locator('.llqzho .bPPnFe').nth(0).locator('.jmNfaf').first().locator('button').nth(3).click();
   assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('swap_settings_v2')).slippageBps),100);
   await f.noPrice();await f.waitCooldownBoundary();await f.waitPost(2);await f.assertCooldown();
   assert.equal(f.posts[1].body.slippageBps,100);assert.equal(f.posts[1].body.singleHop,true);assert.ok(f.posts[1].fresh);
   f.respond(1,2000000n);await f.waitPrice('1 FIST = 0.5 USDT');await f.audit();
  }),
  t.test('real singleHop UI discards the old unit price and requotes with new settings',async t=>{
   const f=await fixture(t,'single-hop-with-preview');await f.waitPost(1);f.respond(0);await f.waitPrice('1 FIST = 0.25 USDT');
   await f.page.locator('#open-settings-dialog-button').click();await f.page.locator('#toggle-disable-multihop-button').click();
   assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('swap_settings_v2')).singleHop),false);
   await f.waitPost(2);await f.noPrice();assert.equal(f.posts[1].body.singleHop,false);assert.equal(f.posts[1].body.slippageBps,50);
   f.respond(1,2000000n);await f.waitPrice('1 FIST = 0.5 USDT');await f.audit();
  }),
  ...['hidden','offline','route','pagehide'].map(mode=>t.test('in-flight '+mode+' cannot revive a late old result or its retry',async t=>{
   const f=await fixture(t,'in-flight-'+mode);await f.waitPost(1);
   if(mode==='hidden')await f.page.evaluate(()=>{window.__fixtureHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__fixtureHidden});document.dispatchEvent(new Event('visibilitychange'));});
   else if(mode==='offline'){await f.context.setOffline(true);await f.page.waitForFunction(()=>navigator.onLine===false);}
   else if(mode==='route'){await f.page.evaluate(()=>{location.hash='#/my';});await f.page.waitForFunction(()=>document.querySelector('#swap-nav-my')?.getAttribute('aria-current')==='page');}
   else await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
   // Deliver the former request even when its fetch has already been canceled.
   // A canceled response must never paint or recreate the removed retry task.
   f.respond(0);await f.page.waitForTimeout(100);await f.noPrice();
   if(mode==='route'||mode==='pagehide')assert.ok(await f.page.evaluate(()=>window.__pairReads.some(r=>r.number===1&&r.phase==='abort')));
   await f.page.waitForTimeout(mode==='offline'?31000:6100);assert.equal(f.posts.length,1);await f.noPrice();
   if(mode==='hidden')await f.page.evaluate(()=>{window.__fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
   else if(mode==='offline'){await f.context.setOffline(false);await f.page.waitForFunction(()=>navigator.onLine===true);}
   else if(mode==='route')await f.page.evaluate(()=>{location.hash='#/swap';});
   else await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
   await f.waitPost(2);await f.noPrice();f.respond(1,2000000n);await f.waitPrice('1 FIST = 0.5 USDT');await f.audit();
  })),
 ]);
});
