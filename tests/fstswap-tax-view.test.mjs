// Isolated actual details renderer + official template. All amounts are fixtures;
// this test has no network, wallet provider, signature or transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {TPL} from '../src/swap-official-tpl.mjs';
const source=await readFile(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const details=source.slice(source.indexOf('  function detailsEl(q)'),source.indexOf('  const formatImpact'));
const inputError=source.slice(source.indexOf('  function inputError()'),source.indexOf('  function needsApproval()'));
const token='0x8a25a5929a18c132eaf47a2b497c86ad00ea5b9e',u='0x55d398326f99059ff775485246999027b3197955',zero='0x'+'00'.repeat(20);
test('unverified tax has a specific input rejection instead of a false no-liquidity label',()=>{
 const context={state:{amount:'1',quoteError:'TAX_UNVERIFIED'},settings:{singleHop:false},SWAP_V10_MISSING:{code:'missing'},inT:()=>({symbol:'USDT'}),outT:()=>({symbol:'FSTSI'}),T:x=>x,tr:(zh,en)=>zh};
 vm.createContext(context);vm.runInContext(inputError,context);
 assert.equal(context.inputError(),'无法可靠确认代币转账税，暂停报价');
 context.tr=(_zh,en)=>en;assert.equal(context.inputError(),'Transfer tax cannot be verified; quote unavailable');
});
test('tax rows stay separate from AMM impact and minimum without changing the ordinary details layout',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 const result=await page.evaluate(({source,html,token,u,zero})=>{
  const part=(_name,selector)=>{const template=document.createElement('template');template.innerHTML=html;return template.content.querySelector(selector).cloneNode(true);};
  const unit={address:token,symbol:'FSTSI',decimals:18};
  const render=new Function('part','routeSymbols','formatImpact','fmtTokens','minOut','outT','settings','TOKENS','ZERO','tr','q',source+';return detailsEl(q);');
  const make=(leg)=>render(part,()=>['USDT','FSTSI'],()=> '0.00%',amount=>String(amount),q=>q.minimum,()=>unit,{slippageBps:50},{fstsi:unit},zero,(zh)=>zh,{impact:0,minimum:19245n,segments:[{legs:[leg]}]});
  const tax=make({tokenIn:u,tokenOut:token,amountIn:9970n,poolAmountIn:9970n,grossOut:19940n,out:19342n,transferInBps:0,transferOutBps:300});
  const normal=make({tokenIn:u,tokenOut:token,amountIn:9970n,poolAmountIn:9970n,grossOut:19940n,out:19940n,transferInBps:0,transferOutBps:0});
  return{taxText:tax.querySelector('[data-transfer-tax]').textContent,taxRows:tax.children.length,normalRows:normal.children.length,normalTax:normal.querySelector('[data-transfer-tax]'),text:tax.textContent};
 },{source:details,html:TPL.swap_quoted,token,u,zero});
 assert.match(result.taxText,/转账税（已计入）.*598 FSTSI.*3\.00%/);
 assert.equal(result.taxRows,result.normalRows+1);assert.equal(result.normalTax,null);
 assert.match(result.text,/0\.00%/);assert.match(result.text,/19245 FSTSI/);
});
