import test from 'node:test';import assert from 'node:assert/strict';
import { prepareCatalogUpdate, saveCatalog } from '../tools/token-admin-core.mjs';
const a={chainId:56,address:'0x1111111111111111111111111111111111111111',symbol:'A',name:'Alpha',decimals:6,logoURI:'https://example.org/a.png'};
const old={name:'FSTSWAP',timestamp:'2026-11-10T00:00:00Z',version:{major:2,minor:0,patch:22},tokens:[a]};
test('admin only accepts mainnet tokens and safe logos and does not trust client version',()=>{
 const next=prepareCatalogUpdate(old,{...old,version:{major:99,minor:0,patch:0},tokens:[{...a,name:'Beta'}]},'2026-11-10T01:00:00Z');
 assert.equal(next.version.patch,23);assert.equal(next.version.major,2);assert.equal(next.tokens[0].name,'Beta');
 for(const p of [{chainId:97},{logoURI:'data:text/html,bad'},{decimals:-1}])assert.throws(()=>prepareCatalogUpdate(old,{...old,tokens:[{...a,...p}]}));
});
test('save rejects stale SHA before any write',async()=>{
 let writes=0;const api={read:async()=>({sha:'new',list:old}),write:async()=>{writes++}};
 await assert.rejects(()=>saveCatalog(api,'old',old),/已被修改/);assert.equal(writes,0);
});
test('save updates fixed list once and only reports the returned commit',async()=>{
 let writes=0;const api={read:async()=>({sha:'same',list:old}),write:async(sha,list)=>{assert.equal(sha,'same');assert.equal(list.version.patch,23);writes++;return {sha:'next',commit:'abc',url:'https://github.com/FstSwapFinance/FstSwap/commit/abc'}}};
 const result=await saveCatalog(api,'same',{...old,tokens:[{...a,name:'Beta'}]});assert.equal(writes,1);assert.equal(result.commit,'abc');
});
test('failed GitHub write is not automatically retried',async()=>{
 let writes=0;const api={read:async()=>({sha:'same',list:old}),write:async()=>{writes++;throw Error('timeout')}};
 await assert.rejects(()=>saveCatalog(api,'same',old),/timeout/);assert.equal(writes,1);
});
