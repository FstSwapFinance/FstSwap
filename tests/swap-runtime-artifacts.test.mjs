import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,cp,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {runtimeFixture} from './runtime-build-fixture.mjs';
const root=new URL('../',import.meta.url),text=p=>readFile(new URL(p,root),'utf8');
async function manifest(){let raw;try{raw=await text('src/fst-runtime-manifest.json');}catch{assert.fail('Published runtime manifest must exist');}return JSON.parse(raw);}
test('published HTML starts the hash early quote graph before CSS and loads one async ethers script',async()=>{
 const html=await text('index.html'),css=html.indexOf('<link rel="stylesheet"'),entries=[...html.matchAll(/<script type="module"(?: async)? src="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(entries.length,2,'early quote and app must be separate published module entries');
 const m=await manifest();assert.deepEqual(entries,[m.entries.boot,m.entries.app]);
 const source=html.match(/<script data-fst-runtime-preloads>([\s\S]*?)<\/script>/);assert.ok(source&&source.index<css,'route preload discovery must precede blocking CSS');
 const links=[],ctx={location:{hash:'#/swap'},document:{head:{appendChild:link=>links.push(link.href)},createElement:()=>({setAttribute(){}})},addEventListener(){}};vm.createContext(ctx);vm.runInContext(source[1],ctx);
 assert.ok(html.indexOf('fst-runtime-preloads:start')<html.indexOf('data-fst-library="ethers"'),'quote discovery precedes the large optional transaction library');
 assert.deepEqual(links,m.routePreloads.swap);
 assert.equal((html.match(/<script\b[^>]*data-fst-library="ethers"/g)||[]).length,1);
 assert.match(html,/<script async data-fst-library="ethers"[^>]*onload=[^>]+onerror=[^>]+src="assets\/vendor\/fst-ethers-[A-F0-9]{16}\.js"/);
 assert.doesNotMatch(html,/<link rel="preload" as="script" href="assets\/vendor\/ethers/);
});
test('published runtime uses one source identity and early quote has no UI/template dependency',async()=>{
 const m=await manifest(),files=new Map(m.files.map(f=>[f.path,f]));
 assert.equal(m.schema,1);assert.equal(m.esbuildVersion,'0.28.2');assert.ok(m.files.length<=12);
 for(const f of m.files){assert.match(f.path,/^src\/fst-runtime-(?:app|boot|chunk)-[A-Z0-9]{8}\.mjs$/);const body=await readFile(new URL(f.path,root));assert.equal(createHash('sha256').update(body).digest('hex'),f.sha256);}
 for(const source of m.sources){const body=await readFile(new URL(source.path,root));assert.equal(createHash('sha256').update(body).digest('hex'),source.sha256);}
 const visit=(key,seen=new Set())=>{if(seen.has(key))return seen;seen.add(key);for(const i of files.get(key).imports)if(!i.external&&i.kind!=='dynamic-import')visit(i.path,seen);return seen;};
 const early=[...visit(m.entries.boot)].flatMap(k=>files.get(k).inputs);
 assert.ok(early.some(x=>x.includes('swap-service-client.mjs')));assert.ok(early.some(x=>x.includes('swap-service-clock.mjs')));
 assert.equal(early.filter(x=>/swap-(?:official-tpl|manage-tpl|shell|view|pool|pages)\.mjs/.test(x)).length,0);
 const serviceFiles=m.files.filter(f=>f.inputs.some(x=>x.includes('swap-service-client.mjs')));assert.equal(serviceFiles.length,1,'UI and early quote share the same client/cache/clock output');
 const externals=m.files.flatMap(f=>f.imports).filter(i=>i.external);
 assert.ok(externals.some(i=>i.path.includes('ethereum-provider')&&i.kind==='dynamic-import'));assert.ok(externals.some(i=>i.path.includes('qrcode-')&&i.kind==='dynamic-import'));assert.ok(externals.some(i=>i.path.includes('lightweight-charts')&&i.kind==='dynamic-import'));
});
test('offline generator verifies exact generated files and immutable caching is limited to hash runtime assets',async()=>{
 assert.doesNotThrow(()=>execFileSync(process.execPath,['tools/runtime/build.mjs','--check'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
 const config=JSON.parse(await text('vercel.json'));assert.equal(config.installCommand,'');assert.equal(config.buildCommand,'');
 const immutable=config.headers.filter(row=>row.headers.some(h=>h.key==='Cache-Control'&&h.value.includes('immutable')));
 assert.ok(immutable.some(row=>row.source.startsWith('/src/fst-runtime-')));assert.ok(immutable.every(row=>row.source.startsWith('/src/fst-runtime-')||row.source==='/src/fst-style-:file.css'||row.source==='/assets/vendor/fst-ethers-:hash.js'||row.source==='/assets/token-logos/:path*'));
 assert.ok(config.headers.find(row=>row.source==='/api/swap/:path*').headers.every(h=>!h.value.includes('immutable')));
 const current=await readdir(new URL('../src/',import.meta.url)),m=await manifest();assert.deepEqual(current.filter(x=>/^fst-runtime-.*\.mjs$/.test(x)).sort(),[...new Set([...m.files,...m.compatibilityAssets].filter(f=>/^src\/fst-runtime-.*\.mjs$/.test(f.path)).map(f=>f.path.slice(4)))].sort());
});
test('generator is reproducible across directories and detects source-only drift or abandoned chunks without writing',async t=>{
 const {buildRuntime}=await import('../tools/runtime/build.mjs');
 const temp=await runtimeFixture(t,{prefix:'fst-runtime-generation-'});
 const first=await buildRuntime({root:temp});assert.deepEqual(first,await manifest());
 await buildRuntime({root:temp,check:true});
 const stale=path.join(temp,'src/fst-runtime-chunk-STALE123.mjs');await writeFile(stale,'export {};\n');
 await assert.rejects(buildRuntime({root:temp,check:true}),/Runtime artifacts are stale:.*STALE123/);assert.equal(await readFile(stale,'utf8'),'export {};\n','check does not delete stale output');await rm(stale);
 const boot=path.join(temp,'src/swap-boot.mjs');await writeFile(boot,(await readFile(boot,'utf8'))+'\n// Source-only drift must fail even if minification leaves output identical.\n');
 const before=await readFile(path.join(temp,'src/fst-runtime-manifest.json'),'utf8');await assert.rejects(buildRuntime({root:temp,check:true}),/Runtime artifacts are stale:/);assert.equal(await readFile(path.join(temp,'src/fst-runtime-manifest.json'),'utf8'),before);
});

test('fresh offline install reproduces the vendor, module graph and HTML from the pinned lockfile',async t=>{
 const temp=await runtimeFixture(t,{prefix:'fst-runtime-clean-install-',nodeModules:false});
 execFileSync('npm',['ci','--ignore-scripts','--offline','--no-audit','--no-fund'],{cwd:path.join(temp,'tools/runtime'),encoding:'utf8',timeout:60000});
 assert.doesNotThrow(()=>execFileSync(process.execPath,[path.join(temp,'tools/runtime/build.mjs'),'--check'],{encoding:'utf8',timeout:60000}));
});
