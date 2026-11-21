import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,cp,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {buildRuntime} from '../tools/runtime/build.mjs';
import {runtimeFixture} from './runtime-build-fixture.mjs';

const root=new URL('../',import.meta.url),hash=value=>createHash('sha256').update(value).digest('hex');
const compatibility=JSON.parse(await readFile(new URL('tools/runtime/compatibility.json',root),'utf8')),approved=compatibility.previousRelease;
const approvedAssets=[...new Map([approved,...compatibility.retainedReleases].flatMap(r=>r.files).map(f=>[f.path,f])).values()];
async function fixture(t){
 const dir=await runtimeFixture(t,{prefix:'fst-approved-runtime-'});
 return{dir,build:options=>buildRuntime({root:dir,...options})};
}
async function oldBytesRemain(dir){
 for(const asset of approvedAssets){const bytes=await readFile(path.join(dir,asset.path));assert.equal(hash(bytes),asset.sha256,'previous published chunks must remain byte-for-byte');}
}

test('building the current cohort retains exactly the approved previous release without preloading it',async t=>{
 const f=await fixture(t),m=await f.build();await oldBytesRemain(f.dir);
 assert.deepEqual(m.compatibilityAssets,approvedAssets);assert.equal(m.compatibility.sourceCommit,approved.sourceCommit);assert.equal(m.compatibility.sourceManifestSHA256,approved.sourceManifestSHA256);
 const html=await readFile(path.join(f.dir,'index.html'),'utf8');assert.match(html,/data-fst-runtime-preloads/);
 for(const route of Object.values(m.routePreloads))assert.ok(route.every(p=>m.files.some(f=>f.path===p)));
 const current=new Set(m.files.map(file=>file.path)),oldOnly=new Set(approvedAssets.filter(file=>!current.has(file.path)).map(file=>file.path));
 for(const file of m.files)for(const imported of file.imports)if(!imported.external)assert.equal(oldOnly.has(imported.path),false,'current app must not import a previous client or wallet singleton');
 assert.ok(oldOnly.size>0);await f.build({check:true});
});

test('unpublished stale chunks are still rejected and removed while approved old chunks remain',async t=>{
 const f=await fixture(t);await f.build();const stale=path.join(f.dir,'src/fst-runtime-chunk-STALE123.mjs');await writeFile(stale,'export {};\n');
 await assert.rejects(f.build({check:true}),/Runtime artifacts are stale:.*STALE123/);assert.equal(await readFile(stale,'utf8'),'export {};\n');
 await f.build();await assert.rejects(readFile(stale),{code:'ENOENT'});await oldBytesRemain(f.dir);
});

test('missing or changed approved files fail the generator before it writes a new HTML',async t=>{
 for(const mutation of ['missing','changed']){
  const f=await fixture(t),asset=approved.files.find(file=>file.path.includes('fst-runtime-app-'));
  const html=await readFile(path.join(f.dir,'index.html'),'utf8');
  if(mutation==='missing')await rm(path.join(f.dir,asset.path));else await writeFile(path.join(f.dir,asset.path),'export const unexpected=true;\n');
  await assert.rejects(f.build({check:true}),/compatibility/i);await assert.rejects(f.build(),/compatibility/i);
  assert.equal(await readFile(path.join(f.dir,'index.html'),'utf8'),html,'invalid old bytes must not be silently replaced or published');
 }
});

test('an old published tab can finish its delayed pool import after a new build',async t=>{
 const f=await fixture(t);await f.build();
 const oldManifest=JSON.parse(execFileSync('git',['show',approved.sourceCommit+':src/fst-runtime-manifest.json'],{cwd:fileURLToPath(root),encoding:'utf8'}));
 const oldHtml=execFileSync('git',['show',approved.sourceCommit+':index.html'],{cwd:fileURLToPath(root)});
 const pool=oldManifest.files.find(file=>file.entryPoint?.includes('swap-pool.mjs'));assert.ok(pool);
 let releasePool;const poolGate=new Promise(resolve=>releasePool=resolve),requests=[],errors=[];
 const browser=await chromium.launch({headless:true});t.after(async()=>{releasePool();await browser.close();});
 const context=await browser.newContext({viewport:{width:430,height:932},locale:'en-US'}),page=await context.newPage(),origin='https://fst-runtime-compat.test';
 await page.addInitScript(()=>{localStorage.setItem('swap_language','en');localStorage.setItem('fstswap_wallet_choice','disconnected');});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"OFFLINE_FIXTURE"}'});
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:oldHtml});
  const relative=url.pathname.slice(1);if(relative===pool.path)await poolGate;
  try{
   let bytes;try{bytes=await readFile(path.join(f.dir,relative));}catch{if(relative.startsWith('src/fst-runtime-'))throw Error('Missing old runtime');bytes=await readFile(new URL(relative,root));}
   requests.push({path:relative,status:200});return route.fulfill({body:bytes,contentType:/\.(?:mjs|js)$/.test(relative)?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.png')?'image/png':relative.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
  }catch{requests.push({path:relative,status:404});return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/#/swap',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#swap-currency-input')&&!document.querySelector('main[inert]'),null,{timeout:5000});
 await page.locator('#pool-nav-link').click();releasePool();
 await page.waitForFunction(()=>location.hash==='#/pool'&&document.querySelector('#root main')?.textContent.includes('Connect to a wallet to view your liquidity.'),null,{timeout:5000});
 assert.ok(requests.some(request=>request.path===pool.path&&request.status===200));assert.deepEqual(requests.filter(request=>request.path.startsWith('src/fst-runtime-')&&request.status!==200),[]);assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>typeof globalThis.ethereum),'undefined');
});
