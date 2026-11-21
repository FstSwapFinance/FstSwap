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

test('an early vendor that times out must remain single execution when a consumer retries',async t=>{
 const f=await fixture(t);await f.page.clock.install();
 await f.page.evaluate(()=>{globalThis.firstLoad=libraryModule.loadSwapLibrary().then(()=>true,()=>false);});
 await f.page.clock.fastForward(8001);assert.equal(await f.page.evaluate(()=>firstLoad),false);
 await f.page.evaluate(()=>{globalThis.retryLoad=libraryModule.loadSwapLibrary().then(()=>true,()=>false);});
 f.release();const loaded=await f.page.evaluate(()=>retryLoad);
 console.log(JSON.stringify({scope:'Real Chromium DOM, real vendor, browser clock advances only the eight-second loader timeout; HTTP gate holds both tasks',loaded,requests:f.requests,errors:f.errors,executions:await f.page.evaluate(()=>globalThis.__vendorExecutions)}));
 assert.equal(f.requests,1,'retrying while the original classic script is still pending must not download/evaluate a second copy');
 assert.deepEqual(f.errors,[]);assert.equal(loaded,true);
});
