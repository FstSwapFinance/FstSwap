import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root));
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['Interface','AbiCoder','getAddress','parseUnits','formatUnits','decodeBytes32String'];
const manifest=async()=>JSON.parse(await read('src/fst-runtime-manifest.json'));
test('published small ethers is generated from pinned same-version six exports and both URLs have identical bytes',async()=>{
 const m=await manifest(),asset=m.cacheAssets.find(x=>x.kind==='generated-ethers');assert.ok(asset,'a generated audited ethers subset must replace the full vendor on new pages');
 assert.equal(asset.package,'ethers');assert.equal(asset.version,'6.15.0');assert.deepEqual(asset.exports,names);
 const p=JSON.parse(await read('tools/runtime/package.json')),lock=JSON.parse(await read('tools/runtime/package-lock.json'));
 assert.equal(p.dependencies.ethers,'6.15.0');assert.equal(lock.packages[''].dependencies.ethers,'6.15.0');assert.equal(lock.packages['node_modules/ethers'].version,'6.15.0');
 const bytes=await read(asset.path),alias=m.mutableAssets.find(x=>x.path==='assets/vendor/ethers-6.15.0-fst.min.js');assert.ok(alias);
 assert.equal(bytes.length,asset.bytes);assert.equal(sha(bytes),asset.sha256);assert.ok(bytes.length<100000);assert.ok(gzipSync(bytes).length<30000);
 assert.deepEqual(await read(alias.path),bytes);assert.equal(alias.sha256,asset.sha256);
 assert.equal(sha(await read('assets/vendor/ethers.umd.min.js')),'fcfd9597005606eabed524ed9f97df69dbc5cac461119a9bb8a4c6b280cfa3f1');
 const ctx={};ctx.self=ctx;ctx.window=ctx;vm.createContext(ctx);vm.runInContext(bytes.toString(),ctx,{timeout:5000});assert.deepEqual(Object.keys(ctx.ethers).sort(),[...names].sort());
});
test('route preload manifests contain only the current closure and preserve the common singleton graph',async()=>{
 const m=await manifest();assert.ok(m.routePreloads,'publish the preload closure per route');assert.deepEqual(Object.keys(m.routePreloads).sort(),['add','analysis','my','pool','remove','swap']);
 const files=new Map(m.files.map(f=>[f.path,f]));
 const visit=(p,s=new Set())=>{if(s.has(p))return s;s.add(p);for(const i of files.get(p).imports)if(!i.external&&i.kind!=='dynamic-import')visit(i.path,s);return s;};
 const sources={swap:'src/swap-view.mjs',analysis:'src/swap-pages.mjs',my:'src/swap-pages.mjs',pool:'src/swap-pool.mjs',add:'src/swap-pool.mjs',remove:'src/swap-pool.mjs'};
 const common=new Set([...visit(m.entries.boot),...visit(m.entries.app)]);
 for(const i of files.get(m.entries.app).imports)if(!i.external&&i.kind==='dynamic-import'&&!/swap-(?:view|pool|pages)\.mjs/.test(files.get(i.path)?.entryPoint||''))visit(i.path,common);
 for(const [route,source]of Object.entries(sources)){
  const entry=m.files.find(f=>f.entryPoint?.split('?')[0]===source);assert.ok(entry);const expected=visit(entry.path,new Set(common));assert.deepEqual(new Set(m.routePreloads[route]),expected,route);
 }
 assert.deepEqual(m.routePreloads.analysis,m.routePreloads.my);assert.deepEqual(m.routePreloads.pool,m.routePreloads.add);assert.deepEqual(m.routePreloads.pool,m.routePreloads.remove);
 assert.ok(m.routePreloads.swap.length<m.files.length);
 assert.equal(m.files.filter(f=>f.inputs.some(i=>i.includes('swap-service-client.mjs'))).length,1);
 const html=(await read('index.html')).toString();assert.equal((html.match(/rel="modulepreload" href=/g)||[]).length,0,'static full-route preload tags must not compete with the selected route');assert.match(html,/data-fst-runtime-preload/);assert.match(html,/hashchange/);assert.ok(html.indexOf('fst-runtime-preloads:start')<html.indexOf('<link rel="stylesheet"'));
});
test('compatibility retains Git releases 51 through 46 with source-manifest and historical blob proof',async()=>{
 const run=promisify(execFile),gitBlob=async(commit,path)=>(await run('git',['show',commit+':'+path],{cwd:fileURLToPath(root),encoding:'buffer',maxBuffer:4*1024*1024})).stdout;
 // Independent oracle: fixed shipped commits, not the generated current
 // compatibility metadata or a copy of its declared file hashes.
 const shipped=[['51','ca0b065329ff7326c711284e5db9f127dd818352'],['50','47ccfb1ed65091a649ceff450baf9a0d321384a8'],['49','6ff1c56f6cb9e0b7afce9b19bc0d7cb973e72209'],['48','d3507a30243ff243cd91dafbc30ada2f0fb02b6f'],['47','bf7594819c31ddb39d7c491bc2b315eef3efd174'],['46','43e2a07b5999e26c8e05693643a4d19dd3cf79ff']];
 const oracle=[];
 for(const [release,sourceCommit]of shipped){
  const bytes=await gitBlob(sourceCommit,'src/fst-runtime-manifest.json'),historical=JSON.parse(bytes);
  const files=[...historical.files,...(historical.cacheAssets||[])].map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes}));
  assert.equal(files.filter(f=>/^src\/fst-runtime-/.test(f.path)).length,12,release+' shipped twelve runtime modules');
  assert.equal(files.filter(f=>/^src\/fst-style-/.test(f.path)).length,3);assert.equal(files.filter(f=>/^assets\/vendor\/fst-ethers-/.test(f.path)).length,1);
  for(const file of files){const blob=await gitBlob(sourceCommit,file.path);assert.equal(sha(blob),file.sha256,'historical Git blob must agree with its own source manifest: '+release+'/'+file.path);assert.equal(blob.length,file.bytes);}
  oracle.push({release,sourceCommit,sourceManifestSHA256:sha(bytes),files});
 }
 const c=JSON.parse(await read('tools/runtime/compatibility.json'));assert.equal(c.schema,2);assert.deepEqual(c.previousRelease,oracle[0]);assert.deepEqual(c.retainedReleases,oracle.slice(1));
 const m=await manifest(),union=new Map();for(const release of oracle)for(const file of release.files){const prior=union.get(file.path);if(prior)assert.equal(prior.sha256,file.sha256,'one historical URL cannot carry different bytes');union.set(file.path,file);}
 assert.deepEqual(new Map(m.compatibilityAssets.map(f=>[f.path,f])),union,'the published compatibility asset set must equal the independent Git-derived union');
 assert.deepEqual(m.compatibility,{release:oracle[0].release,sourceCommit:oracle[0].sourceCommit,sourceManifestSHA256:oracle[0].sourceManifestSHA256,retainedReleases:oracle.slice(1).map(({release,sourceCommit,sourceManifestSHA256})=>({release,sourceCommit,sourceManifestSHA256}))});
 for(const file of union.values()){const actual=await read(file.path);assert.equal(sha(actual),file.sha256,'retained URL must still serve its actual historical Git bytes: '+file.path);assert.equal(actual.length,file.bytes);}
});
test('unknown hash route names, including inherited property names, preload only the swap fallback',async()=>{
 const m=await manifest(),html=(await read('index.html')).toString(),source=html.match(/<script data-fst-runtime-preloads>([\s\S]*?)<\/script>/)?.[1];assert.ok(source);
 for(const hash of ['#/__proto__','#/constructor','#/toString','#/not-a-page','#/swap?x=1','','#/']){
  const links=[],ctx={location:{hash},document:{head:{appendChild:link=>links.push(link.href)},createElement:()=>({setAttribute(){}})},addEventListener(){}};vm.createContext(ctx);
  assert.doesNotThrow(()=>vm.runInContext(source,ctx),hash);assert.deepEqual(links,m.routePreloads.swap,hash);
 }
});
test('generated small vendor publishes complete contributed dependency licenses with origin hashes',async()=>{
 const m=await manifest(),v=m.cacheAssets.find(a=>a.kind==='generated-ethers');assert.equal(v.license,'assets/vendor/ethers-6.15.0-fst.LICENSE.txt');
 const notice=m.mutableAssets.find(a=>a.path===v.license);assert.ok(notice);assert.equal(notice.kind,'generated-ethers-license');assert.deepEqual(notice.packages.map(p=>p.name).sort(),['@noble/hashes','ethers']);
 const bytes=await read(notice.path),script=(await read(v.path)).toString();assert.equal(sha(bytes),notice.sha256);assert.equal(bytes.length,notice.bytes);assert.ok(script.includes(v.license.split('/').at(-1)));
 for(const pkg of notice.packages){const original=await read(pkg.source);assert.ok(bytes.includes(original),'the complete original '+pkg.name+' license must be distributed');assert.equal(sha(original),pkg.sha256);assert.ok(m.sources.some(s=>s.path===pkg.source&&s.sha256===pkg.sha256));}
});
