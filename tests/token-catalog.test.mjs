import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyList, safeLogoUrl, migrateDefaultSource } from '../token-catalog.mjs';
const token={chainId:56,address:'0x55d398326f99059fF775485246999027B3197955',symbol:'USDT',name:'Tether',decimals:18,logoURI:'https://example.org/usdt.png'};
const list={name:'FstSwap',timestamp:'2022-3-1T23:20:45.887Z',version:{major:2,minor:0,patch:21},tokens:[token],logoURI:'https://example.org/logo.png',keywords:['defi']};
test('legacy format retains token identity and normalizes timestamp without dropping precision',()=>{
 const v=legacyList(list);assert.deepEqual(Object.keys(v),['name','logoURI','keywords','timestamp','tokens','version']);
 assert.deepEqual(v.tokens,[token]);assert.equal(v.timestamp,'2022-03-01T23:20:45.887Z');assert.equal(v.version.patch,21);
});
test('logo URI rejects active content and credentials',()=>{
 for(const u of ['javascript:alert(1)','data:image/svg+xml,a','https://user:pass@example.org/a','http://example.org/a','//example.org/a'])assert.equal(safeLogoUrl(u),'');
 assert.equal(safeLogoUrl(token.logoURI),token.logoURI);assert.equal(safeLogoUrl('assets/tokens/fist.png'),'assets/tokens/fist.png');
});
test('default-list migration preserves opt-out and custom entries',()=>{
 const custom={...token,address:'0x1111111111111111111111111111111111111111'};
 const raw=JSON.stringify({lists:{old:{list,active:false},extra:{list,active:true}},custom:[custom]});
 const migrated=JSON.parse(migrateDefaultSource(raw,['old'],'new',list));
 assert.equal(migrated.lists.new.active,false);assert.equal(migrated.lists.old,undefined);assert.equal(migrated.lists.extra.active,true);assert.deepEqual(migrated.custom,[custom]);
});
test('an older offline snapshot cannot replace a newer cached list',async()=>{
 const {preferNewerList}=await import('../token-catalog.mjs');
 const newer={...list,version:{major:2,minor:1,patch:0}};
 assert.equal(preferNewerList(newer,list),newer);assert.equal(preferNewerList(list,newer),newer);
});
