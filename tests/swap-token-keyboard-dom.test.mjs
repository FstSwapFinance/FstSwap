import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const root=new URL('../',import.meta.url),origin='https://fst-keyboard.test';
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,{width,route,selector}){
 const context=await browser.newContext({viewport:{width,height:932},locale:'en-US'}),page=await context.newPage(),errors=[];t.after(()=>context.close());page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('fstswap_wallet_choice','disconnected');localStorage.setItem('swap_language','en');});
 await page.route('**/*',async request=>{
  const url=new URL(request.request().url());if(url.origin!==origin)return request.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'offline fixture'});
  const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
  try{return request.fulfill({body:await readFile(new URL(path,root)),contentType:/\.(mjs|js)$/.test(path)?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.svg')?'image/svg+xml':'text/html'});}catch{return request.fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/'+route,{waitUntil:'networkidle'});await page.locator(selector).click();await page.locator('#token-search-input').focus();
 await page.setViewportSize({width,height:480});await page.waitForTimeout(100);
 return{page,errors};
}
for(const width of[320,521])for(const scenario of[
 {name:'swap input',route:'#/swap',selector:'#swap-currency-input .open-currency-select-button'},
 {name:'swap output',route:'#/swap',selector:'#swap-currency-output .open-currency-select-button'},
 {name:'liquidity input',route:'#/add/v2/0x55d398326f99059ff775485246999027b3197955/0xc9882def23bc42d53895b8361d0b1edc7570bc6a',selector:'#add-liquidity-input-tokena .open-currency-select-button'},
])test(`${width}px ${scenario.name} retains visible selectable rows while its search keyboard is open`,async t=>{
 const{page,errors}=await fixture(t,{width,...scenario});
 const state=await page.evaluate(()=>{
  const dialog=document.querySelector('.fst-token-dialog'),host=document.querySelector('.fst-token-results'),bounds=host.getBoundingClientRect();
  const rows=[...host.querySelectorAll('[role=button]')];return{compact:dialog.classList.contains('fst-keyboard-open'),focused:document.activeElement?.id==='token-search-input',
   visible:rows.filter(el=>{const r=el.getBoundingClientRect();return r.height>=40&&r.top>=bounds.top&&r.bottom<=bounds.bottom;}).length,
   rowDisplays:rows.slice(0,3).map(el=>getComputedStyle(el).display)};
 });
 assert.equal(state.compact,true);assert.equal(state.focused,true);assert.ok(state.visible>=3,JSON.stringify(state));
 const bnb=page.locator('.fst-token-results [role=button]').filter({hasText:/^BNBBSC$/});await bnb.click();
 assert.equal(await page.locator('reach-portal').count(),0);
 if(scenario.name==='liquidity input')await page.waitForFunction(()=>location.hash.startsWith('#/add/v2/BNB/'));
 await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('BNB'),scenario.selector);
 assert.match(await page.locator(scenario.selector).textContent(),/BNB/);
 await page.locator(scenario.selector).click();await page.locator('#token-search-input').focus();await page.waitForTimeout(50);
 assert.equal(await page.locator('.fst-token-dialog').evaluate(el=>el.classList.contains('fst-keyboard-open')),true);
 await page.locator('.fst-keyboard-dismiss').click();await page.setViewportSize({width,height:932});await page.waitForTimeout(50);
 assert.equal(await page.locator('.fst-token-dialog').evaluate(el=>el.classList.contains('fst-keyboard-open')),false,'restored viewport must exit the compressed layout');
 await page.keyboard.press('Escape');assert.equal(await page.locator('reach-portal').count(),0);assert.deepEqual(errors,[]);
});
