import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
test('published styles keep their original bytes and generated vendor hash URLs are immutable while the fallback alias revalidates',async()=>{
 const m=JSON.parse(await readFile(new URL('src/fst-runtime-manifest.json',root),'utf8'));
 assert.ok(Array.isArray(m.cacheAssets));assert.deepEqual(m.cacheAssets.map(a=>a.source).sort(),['tools/runtime/ethers-entry.mjs','src/swap-manage.css','src/swap-official.css','src/swap-ui.css'].sort());
 const html=await readFile(new URL('index.html',root),'utf8');
 for(const asset of m.cacheAssets){
  const published=await readFile(new URL(asset.path,root));
  if(asset.kind==='generated-ethers')assert.equal(asset.source,'tools/runtime/ethers-entry.mjs');
  else{const original=await readFile(new URL(asset.source,root));assert.deepEqual(published,original,'publishing must not modify styles');}
  assert.equal(hash(published),asset.sha256);assert.notEqual(asset.path,asset.source);assert.ok(asset.path.includes(asset.sha256.slice(0,16).toUpperCase()));assert.ok(html.includes('"'+asset.path+'"'));
  if(asset.source.endsWith('.css'))assert.equal(new URL('../assets/official/media/test.woff2',new URL(asset.path,'https://fst.test/')).href,'https://fst.test/assets/official/media/test.woff2');
 }
 const vendor=m.cacheAssets.find(a=>a.kind==='generated-ethers');assert.match(html,new RegExp('<script[^>]+fetchpriority="high"[^>]+src="'+vendor.path.replaceAll('.','\\.')+'"'));
 const config=JSON.parse(await readFile(new URL('vercel.json',root),'utf8')),immutable=config.headers.filter(r=>r.headers.some(h=>h.key==='Cache-Control'&&h.value.includes('immutable'))).map(r=>r.source);
 assert.ok(immutable.includes('/assets/vendor/fst-ethers-:hash.js'));assert.ok(immutable.includes('/src/fst-style-:file.css'));assert.equal(immutable.includes('/assets/vendor/ethers.umd.min.js'),false);assert.equal(immutable.includes('/assets/vendor/ethers-6.15.0-fst.min.js'),false);assert.equal(immutable.includes('/src/:path*'),false);
});
