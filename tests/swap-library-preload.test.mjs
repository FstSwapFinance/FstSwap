import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const origin='https://fst-library.test',root=new URL('../',import.meta.url);
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>browser?.close());
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};

async function fixture(t,{early=true,failFirst=false}={}){
 const context=await browser.newContext(),page=await context.newPage(),vendor=deferred();
 const errors=[],vendorRequests=[];let requests=0;
 t.after(async()=>{vendor.resolve();await context.close();});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(origin+'/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><head>'+(early?'<script async data-fst-library="ethers" onload="this.dataset.fstLibraryState=\'loaded\'" onerror="this.dataset.fstLibraryState=\'error\'" src="/assets/vendor/ethers.umd.min.js"></script>':'')+'</head><body>library fixture</body>'});
  if(path==='/assets/vendor/ethers.umd.min.js'||path==='/assets/vendor/ethers-6.15.0-fst.min.js'){
   const n=++requests;await vendor.promise;
   if(failFirst&&n===1)return route.fulfill({status:503,body:'unavailable'});
   const raw=await readFile(new URL(path.slice(1),root),'utf8');vendorRequests.push({path,bytes:Buffer.byteLength(raw)});
   return route.fulfill({contentType:'application/javascript',body:'globalThis.__vendorExecutions=(globalThis.__vendorExecutions||0)+1;\n'+raw});
  }
  try{return route.fulfill({contentType:'application/javascript',body:await readFile(new URL(path.slice(1),root))});}
  catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{globalThis.libraryModule=await import('/src/swap-aggregator.mjs');});
 return{page,errors,vendorRequests,release:vendor.resolve,get requests(){return requests;}};
}

test('an in-flight parser-discovered ethers script is reused by concurrent real library loaders',async t=>{
 const f=await fixture(t);
 await f.page.evaluate(()=>{globalThis.loading=Promise.all([libraryModule.loadSwapLibrary(),libraryModule.loadSwapLibrary()]);});
 f.release();await f.page.evaluate(()=>loading);
 assert.equal(await f.page.evaluate(()=>__vendorExecutions),1,'the real vendor must execute exactly once');
 assert.equal(f.requests,1,'the parser-discovered transport must not be duplicated');
 assert.equal(await f.page.evaluate(()=>typeof ethers.Interface),'function');
 assert.deepEqual(f.errors,[]);
});

test('a failed early script is retried immediately when the page library consumer arrives later',async t=>{
 const f=await fixture(t,{failFirst:true});f.release();
 await f.page.waitForFunction(()=>document.querySelector('[data-fst-library="ethers"]')?.dataset.fstLibraryState==='error');
 await f.page.evaluate(()=>libraryModule.loadSwapLibrary());
 assert.equal(await f.page.evaluate(()=>__vendorExecutions),1);
 assert.equal(f.requests,2);
 assert.deepEqual(f.errors,[]);
});

test('failed in-flight library work releases the shared promise so a later retry can load the real vendor',async t=>{
 const f=await fixture(t,{failFirst:true});
 await f.page.evaluate(()=>{globalThis.failed=libraryModule.loadSwapLibrary().then(()=>false,()=>true);});
 f.release();
 assert.equal(await f.page.evaluate(()=>failed),true);
 await f.page.evaluate(()=>libraryModule.loadSwapLibrary());
 assert.equal(await f.page.evaluate(()=>__vendorExecutions),1);
 assert.equal(f.requests,2);
 assert.deepEqual(f.errors,[]);
});

test('pages without an early script still load once and an already initialized vendor is reused',async t=>{
 const f=await fixture(t,{early:false});f.release();
 await f.page.evaluate(()=>Promise.all([libraryModule.loadSwapLibrary(),libraryModule.loadSwapLibrary()]));
 await f.page.evaluate(()=>libraryModule.loadSwapLibrary());
 assert.equal(f.requests,1);assert.equal(await f.page.evaluate(()=>__vendorExecutions),1);
 assert.deepEqual(f.errors,[]);
});

// This acceptance budget catches a fallback accidentally returning to the full
// 517 KB vendor, even if the published HTML's primary script remains lean.
test('fallback without a parser script loads only the slim versioned library and exposes all required ABI utilities',async t=>{
 const f=await fixture(t,{early:false});f.release();
 await f.page.evaluate(()=>libraryModule.loadSwapLibrary());
 assert.deepEqual(f.vendorRequests.map(row=>row.path),['/assets/vendor/ethers-6.15.0-fst.min.js']);
 assert.ok(f.vendorRequests[0].bytes<100000,'fallback must respect the same cold-start library budget as the primary hash asset');
 assert.deepEqual(await f.page.evaluate(()=>['Interface','AbiCoder','getAddress','parseUnits','formatUnits','decodeBytes32String'].map(name=>typeof ethers[name])),Array(6).fill('function'));
 assert.equal(f.requests,1);assert.equal(await f.page.evaluate(()=>__vendorExecutions),1);assert.deepEqual(f.errors,[]);
});
