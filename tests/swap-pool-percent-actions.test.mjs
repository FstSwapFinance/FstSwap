// Execute the actual add-liquidity panel and AMM parsing functions against the
// actual template. Local DOM fixture only: no wallet, chain reads or transaction.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {TPL} from '../src/swap-official-tpl.mjs';
import * as amount from '../src/swap-amount.mjs';
import {build} from '../tools/runtime/node_modules/esbuild/lib/main.js';
const source=await readFile(new URL('../src/swap-pool.mjs',import.meta.url),'utf8');
const start=source.indexOf('  let nativeMaxJob = null;',source.indexOf('async function mountAdd('));
const end=source.indexOf('\n  function pricesEl(p)',start);
const panelCode=source.slice(start,end);
const vendor=await readFile(new URL('../assets/vendor/ethers-6.15.0-fst.min.js',import.meta.url),'utf8');
const routerAbi=Function('return '+source.match(/const ROUTER_ABI = (\[[\s\S]*?\]);/)[1])();
let browser,nativeBundle;
before(async()=>{nativeBundle=(await build({entryPoints:[new URL('../src/swap-native-max.mjs',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'NativeMax',platform:'browser',target:'es2022'})).outputFiles[0].text;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,{keys=['usdt','fist'],balances=['123456789123456789123','200000000000000000000'],connected=true,gateGas=false,estimateFails=false,approved=true}={}){
 const page=await browser.newPage();t.after(()=>page.close());await page.setContent(TPL.add);await page.addScriptTag({content:vendor});await page.addScriptTag({content:nativeBundle});
 await page.evaluate(({panelCode,template,keys,balances,connected,gateGas,estimateFails,approved,routerAbi,amountFunctions})=>{
  const TOKENS={usdt:{key:'usdt',symbol:'USDT',decimals:18,address:'0x'+'11'.repeat(20)},fist:{key:'fist',symbol:'FIST',decimals:18,address:'0x'+'22'.repeat(20)},bnb:{key:'bnb',symbol:'BNB',decimals:18,address:null}};
  const wallet={account:connected?'0x'+'aa'.repeat(20):null,provider:{request(){throw Error('No wallet calls permitted');}}};
  const st={a:keys[0],b:keys[1],field:'a',typed:'',allowance:Object.fromEntries(keys.map(k=>[k,approved?(1n<<255n):0n])),balances:Object.fromEntries(keys.map((k,n)=>[k,balances[n]==null?null:BigInt(balances[n])]))};
  const main=document.querySelector('main');
  const protoPanel=document.querySelector('#add-liquidity-input-tokena').cloneNode(true);
  const reserve=k=>k===st.a?1000n:5000n;
  const pool=()=>({pair:'fixture'}),BPS=10000n,FST_ROUTER='0x1B6C9c20693afDE803B27F8782156c0f892ABC2d',ROUTER_ABI=routerAbi,iface=abi=>new ethers.Interface(abi);
  let savedSettings={slippageBps:50,deadlineMinutes:30};const readSettings=()=>({...savedSettings});
  const popups=[],popup=value=>popups.push(value),calls=[];let releaseGas;const gate=gateGas?new Promise(r=>releaseGas=r):null;
  const swapPublicRpc=()=>async payload=>{calls.push(payload);if(payload.method==='eth_gasPrice')return '0x'+(50000000n).toString(16);if(payload.method==='eth_estimateGas'){if(gate)await gate;if(estimateFails)throw Error('TRANSFER_FROM_FAILED');return '0x'+(120000n).toString(16);}throw Error('Unexpected read');};
  const nativeBalanceFraction=NativeMax.nativeBalanceFraction;
  st.pr={reserves:{}};
  const tr=(zh,en)=>en,swapFormatUnits=ethers.formatUnits;
  const parseAmount=(value,decimals)=>{try{return ethers.parseUnits(value||'0',decimals);}catch{return 0n;}};
  const formatBalance=(v,token)=>ethers.formatUnits(v,token.decimals);
  const logoFor=()=>null;
  let pickerCalls=0;
  const openTokenPicker=()=>{pickerCalls++;};
  const part=(name,selector)=>{const t=document.createElement('template');t.innerHTML=template[name];return t.content.querySelector(selector).cloneNode(true);};
  const formatAmountInput=eval('('+amountFunctions.formatAmountInput+')');
  const limitAmountDecimals=eval('('+amountFunctions.limitAmountDecimals+')');
  const balanceFraction=amountFunctions.balanceFraction?eval('('+amountFunctions.balanceFraction+')'):undefined;
  let parsed,panelEl;
  function render(){
   for(const field of ['a','b'])document.querySelector(field==='a'?'#add-liquidity-input-tokena':'#add-liquidity-input-tokenb').replaceWith(panelEl(field));
  }
  // Lexically bind the actual production functions to the isolated fixture.
  eval(panelCode.replace('const parsed =','parsed =').replace('function panelEl(field)','panelEl = function(field)'));
  render();
  window.__poolPercent={state:()=>({field:st.field,typed:st.typed,a:String(parsed().a),b:String(parsed().b),pickerCalls,providerType:typeof window.ethereum,popups,calls: calls.map(c=>({method:c.method,tx:c.params?.[0]}))}),render,releaseGas:()=>releaseGas?.(),setSettings:value=>{savedSettings={...savedSettings,...value};},setProvider:()=>{wallet.provider={request(){throw Error('No replacement wallet');}};},setAccount:value=>{wallet.account=value;},setBalance:(key,value)=>{st.balances[key]=value==null?null:BigInt(value);}};
 },{panelCode,template:TPL,keys,balances,connected,gateGas,estimateFails,approved,routerAbi,amountFunctions:Object.fromEntries(['formatAmountInput','limitAmountDecimals','balanceFraction'].map(k=>[k,amount[k]?.toString()]))});
 return page;
}
const actions=(page,field='a')=>page.locator((field==='a'?'#add-liquidity-input-tokena':'#add-liquidity-input-tokenb')+' .fst-balance-actions button');
test('add panels expose four ordered disabled actions when disconnected or balances unavailable',async t=>{
 for(const options of [{connected:false},{balances:[null,null]},{balances:['0','0']}]){
  const page=await fixture(t,options);
  for(const field of ['a','b']){
   assert.deepEqual(await actions(page,field).allTextContents(),['25%','50%','75%','Max']);
   assert.deepEqual(await actions(page,field).evaluateAll(nodes=>nodes.map(n=>({disabled:n.disabled,type:n.type}))),Array.from({length:4},()=>({disabled:true,type:'button'})));
  }
 }
});
test('each add field uses exact balance fractions and preserves the corresponding AMM ratio',async t=>{
 for(const [field,balance] of [['a',123456789123456789123n],['b',200000000000000000000n]])for(const percent of[25,50,75,100]){
  const page=await fixture(t);assert.equal(await actions(page,field).count(),4);
  const button=page.locator((field==='a'?'#add-liquidity-input-tokena':'#add-liquidity-input-tokenb')+' .fst-balance-actions [data-percent="'+percent+'"]');
  await button.click({timeout:1000});const s=await page.evaluate(()=>window.__poolPercent.state());
  const value=balance*BigInt(percent)/100n;
  assert.equal(s[field],String(value));assert.equal(s[field==='a'?'b':'a'],String(field==='a'?value*5n:value/5n));
  assert.equal(s.field,field);assert.equal(s.pickerCalls,0);assert.equal(s.providerType,'undefined');
  assert.equal(await button.evaluate(n=>n===document.activeElement),true,'new rendered action retains keyboard focus');
 }
});
test('BNB fractions use only gas-reserved spendable balance, while Max retains all non-BNB wei',async t=>{
 const reserve=156000n*60000000n,balance=15966673100000000n;
 for(const percent of[25,50,75,100]){
  const page=await fixture(t,{keys:['bnb','fist'],balances:[String(balance),'200000000000000000000']});assert.equal(await actions(page).count(),4);
  await page.locator('#add-liquidity-input-tokena .fst-balance-actions [data-percent="'+percent+'"]').click();
  await page.waitForFunction(()=>window.__poolPercent.state().typed!=='');
  const s=await page.evaluate(()=>window.__poolPercent.state());assert.equal(s.a,String((balance-reserve)*BigInt(percent)/100n));
  const last=s.calls.filter(c=>c.method==='eth_estimateGas').at(-1).tx;assert.equal(BigInt(last.value),BigInt(s.a));
  const decoded=await page.evaluate(({abi,tx})=>{const value=new ethers.Interface(abi).parseTransaction({data:tx.data});return{name:value.name,tokenAmount:String(value.args[1])};},{abi:routerAbi,tx:last});
  assert.equal(decoded.name,'addLiquidityETH');assert.equal(decoded.tokenAmount,s.b);
 }
 const page=await fixture(t,{balances:['123456789123456789123','200000000000000000000']});assert.equal(await actions(page).count(),4);
 await page.locator('#add-liquidity-input-tokena .fst-balance-actions [data-percent="100"]').click();
 const s=await page.evaluate(()=>window.__poolPercent.state());assert.equal(s.typed,'123.456789123456789123');assert.equal(s.a,'123456789123456789123');
 assert.equal(await page.locator('#add-liquidity-input-tokena input').inputValue(),'123.4567');
});
test('zero BNB and sub-wei fractions are disabled without retaining a fixed native reserve',async t=>{
 for(const balance of['0']){
  const page=await fixture(t,{keys:['bnb','fist'],balances:[balance,'200000000000000000000']});assert.equal(await actions(page).count(),4);assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[true,true,true,true]);
 }
 const page=await fixture(t,{balances:['3','200000000000000000000']});
 assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[true,false,false,false]);
});

test('an old action cannot reuse a prior account or invalidated balance',async t=>{
 const page=await fixture(t);
 await page.evaluate(()=>window.__poolPercent.setAccount('0x'+'bb'.repeat(20)));
 await page.locator('#add-liquidity-input-tokena .fst-balance-actions [data-percent="100"]').click();
 assert.equal((await page.evaluate(()=>window.__poolPercent.state())).typed,'');
 await page.evaluate(()=>{window.__poolPercent.render();window.__poolPercent.setBalance('usdt',null);});
 await page.locator('#add-liquidity-input-tokena .fst-balance-actions [data-percent="100"]').click();
 assert.equal((await page.evaluate(()=>window.__poolPercent.state())).typed,'');
 await page.evaluate(()=>window.__poolPercent.render());
 assert.deepEqual(await actions(page).evaluateAll(nodes=>nodes.map(n=>n.disabled)),[true,true,true,true]);
});

for(const change of['account','provider','settings','typed'])test('pending native liquidity amount ignores stale '+change,async t=>{
 const page=await fixture(t,{keys:['bnb','fist'],balances:['15966673100000000','200000000000000000000'],gateGas:true});
 await page.locator('#add-liquidity-input-tokena .fst-balance-actions [data-percent="100"]').click();
 await page.waitForFunction(()=>window.__poolPercent.state().calls.some(c=>c.method==='eth_estimateGas'));
 if(change==='account')await page.evaluate(()=>window.__poolPercent.setAccount('0x'+'bb'.repeat(20)));
 if(change==='provider')await page.evaluate(()=>window.__poolPercent.setProvider());
 if(change==='settings')await page.evaluate(()=>window.__poolPercent.setSettings({slippageBps:100}));
 if(change==='typed')await page.locator('#add-liquidity-input-tokena input').fill('0.001');
 await page.evaluate(()=>window.__poolPercent.releaseGas());
 await page.waitForFunction(()=>!document.querySelector('#add-liquidity-input-tokena .fst-balance-action').disabled);
 const s=await page.evaluate(()=>window.__poolPercent.state());assert.equal(s.typed,change==='typed'?'0.001':'');assert.equal(s.popups.length,0);
});
test('native liquidity Max covers unapproved token Gas and an approved estimate failure does not fill an amount',async t=>{
 const balance=15966673100000000n;
 const page=await fixture(t,{keys:['fist','bnb'],balances:['200000000000000000000',String(balance)],approved:false,estimateFails:true});
 await page.locator('#add-liquidity-input-tokenb .fst-balance-actions [data-percent="100"]').click();
 await page.waitForFunction(()=>window.__poolPercent.state().typed!=='');
 const s=await page.evaluate(()=>window.__poolPercent.state());assert.equal(BigInt(s.b),balance-(520000n+150000n)*60000000n);
 const failed=await fixture(t,{keys:['bnb','fist'],balances:[String(balance),'200000000000000000000'],estimateFails:true});
 await failed.locator('#add-liquidity-input-tokena .fst-balance-actions [data-percent="100"]').click();
 await failed.waitForFunction(()=>window.__poolPercent.state().popups.length>0);
 assert.equal((await failed.evaluate(()=>window.__poolPercent.state())).typed,'');
});
