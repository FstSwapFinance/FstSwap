import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url),view=await readFile(new URL('src/swap-view.mjs',root),'utf8'),pool=await readFile(new URL('src/swap-pool.mjs',root),'utf8');
const tag=view.match(/swap-shell\.mjs(\?[^"']+)/)[1];
const swapSettings=view.slice(view.indexOf('  function renderSettings()'),view.indexOf('  const closeSettings ='));
const poolSettings=pool.slice(pool.indexOf('function bindSettings('),pool.indexOf('// —— 代币选择弹窗',pool.indexOf('function bindSettings(')));
const bottom=view.slice(view.indexOf('  function renderBottom()'),view.indexOf('  function renderPoolLink()'));
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t){
 const context=await browser.newContext(),page=await context.newPage(),errors=[];t.after(()=>context.close());page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
  try{return route.fulfill({contentType:'application/javascript',body:await readFile(new URL(url.pathname.slice(1),root))});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://fst-template.test/');await page.evaluate(async tag=>{globalThis.shell=await import('/src/swap-shell.mjs'+tag);},tag);
 return{page,errors};
}
test('real swap settings renderer clones its closed and opened templates and remains interactive',async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(source=>{
  const {part}=shell,state={settingsOpen:false},settings={slippageBps:50,slippageAuto:true,deadlineMinutes:30,expert:false,singleHop:false};
  const settingsWrap=document.createElement('div');document.querySelector('#root').append(settingsWrap);
  const saveSettings=()=>{},renderTrade=()=>{},renderBottom=()=>{},scheduleQuote=()=>{},cancelSubmissionWarm=()=>{},queueSubmissionWarm=()=>{};
  eval(source+'\nrenderSettings();');
 },swapSettings);
 assert.equal(await page.locator('.llqzho').count(),0);await page.locator('#open-settings-dialog-button').click();
 assert.equal(await page.locator('.llqzho').count(),1,'opening swap settings must resolve the dynamic swap_settings key');
 assert.equal(await page.locator('.llqzho input').count(),2);await page.locator('#open-settings-dialog-button').click();assert.equal(await page.locator('.llqzho').count(),0);assert.deepEqual(errors,[]);
});
test('real pool settings renderer resolves the same dynamic opened and closed template branches',async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(source=>{
  const {part,tpl}=shell,main=tpl('add');document.querySelector('#root').append(main);
  const readSettings=()=>({slippageBps:50,slippageAuto:true,deadlineMinutes:30,expert:false,singleHop:false}),saveSettings=()=>{};
  eval(source+'\nbindSettings(main);');
 },poolSettings);
 assert.equal(await page.locator('.llqzho').count(),0);await page.locator('#open-settings-dialog-button').click();
 assert.equal(await page.locator('.llqzho').count(),1,'opening pool settings must resolve the dynamic swap_settings key');
 await page.locator('#open-settings-dialog-button').click();assert.equal(await page.locator('.llqzho').count(),0);assert.deepEqual(errors,[]);
});
test('real authorization renderer resolves the approval template and returns to the enabled swap branch when sufficient',async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(source=>{
  const {part,tr,T}=shell,state={quote:{amountIn:100n},allowance:0n},wallet={account:'0x'+'11'.repeat(20)};
  const approvals={pending:()=>false},approvalIdentity=()=>({}),needsApproval=()=>state.allowance<state.quote.amountIn;
  const inT=()=>({key:'usdt',symbol:'USDT'}),inputError=()=>'',applyTokenLogo=()=>{},renderPoolLink=()=>{},openWalletModal=()=>{};
  globalThis.approvalsClicked=0;const approve=()=>approvalsClicked++,handleSwapClick=()=>{};
  let bottom=document.createElement('div');document.querySelector('#root').append(bottom);
  eval(source+'\nrenderBottom();globalThis.sufficient=()=>{state.allowance=100n;renderBottom();};');
 },bottom);
 assert.equal(await page.locator('#swap-button').isDisabled(),true);const approve=page.locator('#root button:not(#swap-button)');
 assert.equal(await approve.count(),1);assert.equal(await approve.isEnabled(),true);await approve.click();assert.equal(await page.evaluate(()=>approvalsClicked),1);
 await page.evaluate(()=>sufficient());assert.equal(await page.locator('#swap-button').isEnabled(),true);assert.equal(await page.locator('#root button:not(#swap-button)').count(),0);assert.deepEqual(errors,[]);
});
