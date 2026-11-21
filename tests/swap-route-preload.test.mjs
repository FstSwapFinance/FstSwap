import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),head=html.split('</head>')[0];
const manifest=JSON.parse(readFileSync(new URL('../src/fst-runtime-manifest.json',import.meta.url),'utf8'));
const owned=[...head.matchAll(/<script data-fst-runtime-preloads>([\s\S]*?)<\/script>/g)];
const role={swap:'src/swap-view.mjs',pages:'src/swap-pages.mjs',pool:'src/swap-pool.mjs'};
function entry(source){const file=manifest.files.find(file=>file.entryPoint?.split('?')[0]===source);assert.ok(file,'the published import graph must identify the real route entry');return file.path;}
function closure(seeds){
 const files=new Map(manifest.files.map(file=>[file.path,file])),seen=new Set();
 const visit=key=>{if(seen.has(key))return;seen.add(key);const file=files.get(key);assert.ok(file,'every selected module must belong to the published graph');for(const item of file.imports)if(!item.external&&item.kind!=='dynamic-import')visit(item.path);};
 for(const seed of seeds)visit(seed);return seen;
}
function expected(source){
 // Follow the emitted dependency graph independently. In particular, never use
 // manifest.routePreloads or the production hash-name lookup to form the oracle.
 return closure([manifest.entries.boot,manifest.entries.app,entry('src/swap-service-client.mjs'),entry(source)]);
}
function execute(hash){
 assert.equal(owned.length,1,'one owned parser-time bootstrap must select preloads');
 assert.ok(owned[0].index<head.indexOf('<link rel="stylesheet"'),'route discovery must happen before blocking stylesheets');
 const links=[...head.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(match=>({href:match[1],attrs:{}})),events=new Map();
 const context={location:{hash},document:{head:{appendChild(link){links.push(link);}},createElement(tag){assert.equal(tag,'link');return{attrs:{},setAttribute(name,value){this.attrs[name]=value;}};}},addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);}};
 vm.createContext(context);vm.runInContext(owned[0][1],context,{timeout:1000});
 return{links,change(hash){context.location.hash=hash;for(const handler of events.get('hashchange')||[])handler();}};
}
function exactLinks(actual,wanted){
 const paths=actual.map(link=>link.href);
 assert.equal(paths.length,new Set(paths).size,'visiting a route must not add duplicate preload links');
 assert.deepEqual(new Set(paths),wanted,'only the selected route and its static dependencies may load');
 assert.ok(paths.every(path=>/^src\/fst-runtime-(?:app|boot|chunk)-[A-Z0-9]{8}\.mjs$/.test(path)),'the bootstrap must preload emitted URLs rather than rediscover a native source graph');
 assert.equal(paths.filter(path=>path===manifest.entries.boot).length,1);
 assert.equal(paths.filter(path=>path===manifest.entries.app).length,1);
}
for(const [hash,source]of [
 ['',role.swap],['#/swap',role.swap],['#/pool',role.pool],['#/add/v2/BNB/FIST',role.pool],['#/remove/v2/BNB/FIST',role.pool],['#/my',role.pages],['#/analysis/0xabc/0xdef',role.pages],['#/unknown',role.swap],
 ['#/__proto__',role.swap],['#/constructor',role.swap],['#/toString',role.swap],['#/swap?from=test',role.swap],
])test((hash||'empty hash')+' executes the current-route preload closure before styles without loading unrelated pages',()=>{
 const f=execute(hash);exactLinks(f.links,expected(source));
 const priority=closure([manifest.entries.boot]);
 for(const link of f.links){assert.equal(link.rel,'modulepreload');assert.equal(link.attrs['data-fst-runtime-preload'],'');assert.equal(link.attrs.fetchpriority,priority.has(link.href)?'high':undefined);}
 assert.ok(f.links.length<manifest.files.length,'a cold route must not request the complete multi-page graph');
});
test('repeated hash events reuse existing links and a newly visited route adds exactly its missing dependency closure',()=>{
 const f=execute('#/swap'),all=expected(role.swap);exactLinks(f.links,all);
 const count=f.links.length;for(let i=0;i<4;i++)f.change('#/swap');assert.equal(f.links.length,count);
 for(const [hash,source]of [['#/pool',role.pool],['#/analysis/a/b',role.pages],['#/my',role.pages],['#/add/v2/a/b',role.pool],['#/remove/v2/a/b',role.pool],['#/swap',role.swap],['#/constructor',role.swap]]){
  const before=new Set(f.links.map(link=>link.href)),needed=expected(source),missing=[...needed].filter(path=>!before.has(path));
  f.change(hash);const added=f.links.filter(link=>!before.has(link.href));assert.deepEqual(new Set(added.map(link=>link.href)),new Set(missing));
  for(const path of needed)all.add(path);exactLinks(f.links,all);
 }
});
