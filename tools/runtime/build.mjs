import * as esbuild from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const EXPECTED_ESBUILD='0.28.2',EXPECTED_ETHERS='6.15.0';
const ETHERS_EXPORTS=['Interface','AbiCoder','getAddress','parseUnits','formatUnits','decodeBytes32String'];
const ETHERS_ALIAS='assets/vendor/ethers-6.15.0-fst.min.js',ETHERS_LICENSE='assets/vendor/ethers-6.15.0-fst.LICENSE.txt';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=value=>value.split(path.sep).join('/');
const vendorPlugin={name:'keep-wallet-and-chart-lazy',setup(build){
  build.onResolve({filter:/assets\/(?:official\/)?vendor\//},args=>({path:args.path,external:true}));
}};
const fileExists=async file=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const approvedPath=value=>/^(?:src\/fst-runtime-(?:app|boot|chunk)-[A-Z0-9]{8}\.mjs|src\/fst-style-(?:official|manage|ui)-[A-F0-9]{16}\.css|assets\/vendor\/fst-ethers-[A-F0-9]{16}\.js)$/.test(value||'');
async function approvedCompatibility(root) {
  const source=JSON.parse(await readFile(path.join(root,'tools/runtime/compatibility.json'),'utf8'));
  if(source.schema!==2||!Array.isArray(source.retainedReleases)||source.retainedReleases.length>3)throw Error('Invalid runtime compatibility metadata');
  const releases=[source.previousRelease,...source.retainedReleases],seenReleases=new Set(),assets=new Map();
  for(const release of releases){
    const files=release?.files;
    if(!/^\d+$/.test(release?.release||'')||seenReleases.has(release.release)||!/^[0-9a-f]{40}$/.test(release?.sourceCommit||'')||!/^[0-9a-f]{64}$/.test(release?.sourceManifestSHA256||'')||!Array.isArray(files)||!files.length||files.length>16)throw Error('Invalid runtime compatibility metadata');
    seenReleases.add(release.release);const local=new Set();
    for(const file of files){
      if(!approvedPath(file.path)||!/^[0-9a-f]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<1||local.has(file.path))throw Error('Invalid runtime compatibility asset');
      local.add(file.path);const previous=assets.get(file.path);
      if(previous&&(previous.sha256!==file.sha256||previous.bytes!==file.bytes))throw Error('Conflicting approved runtime compatibility bytes: '+file.path);
      assets.set(file.path,file);
    }
  }
  for(const file of assets.values()){
    const bytes=await fileExists(path.join(root,file.path));
    if(!bytes||bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Missing or changed approved runtime compatibility asset: '+file.path);
  }
  const metadata=release=>{const {files,...data}=release;return data;};
  return{metadata:{...metadata(source.previousRelease),retainedReleases:source.retainedReleases.map(metadata)},files:[...assets.values()]};
}
function preloadRoutes(files,entries){
  const byPath=new Map(files.map(file=>[file.path,file]));
  const visit=(file,seen,ordered)=>{if(seen.has(file.path))return;seen.add(file.path);for(const item of file.imports)if(!item.external&&item.kind!=='dynamic-import')visit(byPath.get(item.path),seen,ordered);ordered.push(file.path);};
  const routeSource={swap:'src/swap-view.mjs',analysis:'src/swap-pages.mjs',my:'src/swap-pages.mjs',pool:'src/swap-pool.mjs',add:'src/swap-pool.mjs',remove:'src/swap-pool.mjs'};
  const routeEntries=Object.fromEntries(Object.entries(routeSource).map(([route,source])=>[route,files.find(file=>file.entryPoint?.split('?')[0]===source)]));
  if(Object.values(routeEntries).some(file=>!file))throw Error('Missing route runtime entry');
  const seen=new Set(),common=[];visit(byPath.get(entries.boot),seen,common);const priority=[...common];visit(byPath.get(entries.app),seen,common);
  const selectedEntries=new Set(Object.values(routeEntries).map(file=>file.path));
  // The app's tiny service re-export is common; wallet/chart vendors stay lazy.
  for(const item of byPath.get(entries.app).imports)if(!item.external&&item.kind==='dynamic-import'&&!selectedEntries.has(item.path))visit(byPath.get(item.path),seen,common);
  const routes={};for(const [route,file]of Object.entries(routeEntries)){const paths=[...common];visit(file,new Set(seen),paths);routes[route]=paths;}
  return{routes,priority};
}
function preloadBootstrap(manifest){
  const routes=JSON.stringify(manifest.routePreloads),priority=JSON.stringify(manifest.preloadPriority);
  // This parser-time script runs before blocking stylesheets and vendor loading.
  // Route changes append only the new closure. Imports keep a single module URL.
  return `  <script data-fst-runtime-preloads>(function(){var routes=${routes},priority=new Set(${priority}),seen=new Set();function preload(){var name=(location.hash||'#/swap').replace(/^#\\//,'').split('/')[0].split('?')[0]||'swap';(Object.hasOwn(routes,name)?routes[name]:routes.swap).forEach(function(href){if(seen.has(href))return;seen.add(href);var link=document.createElement('link');link.rel='modulepreload';link.href=href;link.setAttribute('data-fst-runtime-preload','');if(priority.has(href))link.setAttribute('fetchpriority','high');document.head.appendChild(link);});}preload();addEventListener('hashchange',preload);})();</script>`;
}
function publishedHtml(html,manifest) {
  const early=`  <!-- fst-runtime-preloads:start -->\n${preloadBootstrap(manifest)}\n  <script type="module" async src="${manifest.entries.boot}"></script>\n  <!-- fst-runtime-preloads:end -->\n`;
  html=html.replace(/  <!-- fst-runtime-preloads:start -->[\s\S]*?  <!-- fst-runtime-preloads:end -->\n/,'');
  html=html.replace(/^  <link rel="modulepreload"[^\n]*\n/gm,'').replace(/^  <script>\(function\(\)\{var route=[^\n]*\n/gm,'');
  const vendor=manifest.cacheAssets.find(asset=>asset.kind==='generated-ethers');
  const library=`  <script async data-fst-library="ethers" fetchpriority="high" onload="this.dataset.fstLibraryState='loaded'" onerror="this.dataset.fstLibraryState='error'" src="${vendor.path}"></script>`;
  html=html.replace(/^  <(?:link rel="preload" as="script" href="assets\/vendor\/ethers\.umd\.min\.js" \/>|script async data-fst-library="ethers"[^\n]*)$/m,library);
  for(const asset of manifest.cacheAssets.filter(asset=>asset.source.endsWith('.css'))){
    const name=path.basename(asset.source,'.css').replace(/^swap-/,''),original=asset.source.replaceAll('.','\\.');
    const stylesheet=new RegExp(`(<link rel="stylesheet" href=")(?:${original}(?:\\?[^"<>]*)?|src/fst-style-${name}-[A-F0-9]{16}\\.css)(")`);
    html=html.replace(stylesheet,'$1'+asset.path+'$2');
  }
  if(!html.includes(library))throw Error('Missing owned ethers HTML script');
  html=html.replace(library,early+library);
  return html.replace(/  <script type="module" src="(?:src\/app\.js[^"<>]*|src\/fst-runtime-app-[A-Z0-9]+\.mjs)"><\/script>/,`  <script type="module" src="${manifest.entries.app}"></script>`);
}
async function vendorLicenses(root,metafile){
  const packages=new Set();
  for(const output of Object.values(metafile.outputs))for(const [input,value]of Object.entries(output.inputs)){
    if(value.bytesInOutput<=0||input==='tools/runtime/ethers-entry.mjs')continue;
    const owner=input.match(/^(tools\/runtime\/node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1];
    if(!owner)throw Error('Untracked contributing vendor source: '+input);
    packages.add(owner);
  }
  const notices=[],sources=[],bodies=[Buffer.from('FstSwap browser ABI and units utility bundle.\nComplete licenses of dependencies contributing code follow.\n')];
  for(const directory of [...packages].sort()){
    const pkgSource=directory+'/package.json',pkg=JSON.parse(await readFile(path.join(root,pkgSource),'utf8'));
    let source,bytes;
    for(const name of ['LICENSE','LICENSE.md','LICENSE.txt','LICENCE','LICENCE.md']){const candidate=directory+'/'+name,body=await fileExists(path.join(root,candidate));if(body){source=candidate;bytes=body;break;}}
    if(!source)throw Error('Missing license for contributing vendor package: '+pkg.name);
    notices.push({name:pkg.name,version:pkg.version,license:pkg.license,source,sha256:sha(bytes)});sources.push(pkgSource,source);
    bodies.push(Buffer.from('\n================================================================\n'+pkg.name+' '+pkg.version+'\nLicense: '+String(pkg.license)+'\nSource: '+source+'\n\n'),bytes);
  }
  const bytes=Buffer.concat(bodies),asset={kind:'generated-ethers-license',path:ETHERS_LICENSE,sha256:sha(bytes),bytes:bytes.length,packages:notices};
  return{bytes,asset,sources};
}
async function buildEthers(root){
  const packageSource='tools/runtime/node_modules/ethers/package.json';
  const pkg=JSON.parse(await readFile(path.join(root,packageSource),'utf8')),tools=JSON.parse(await readFile(path.join(root,'tools/runtime/package.json'),'utf8'));
  if(pkg.version!==EXPECTED_ETHERS||tools.dependencies?.ethers!==EXPECTED_ETHERS)throw Error('Expected pinned ethers '+EXPECTED_ETHERS+'; run npm ci --prefix tools/runtime');
  const build=await esbuild.build({absWorkingDir:root,entryPoints:['tools/runtime/ethers-entry.mjs'],outfile:ETHERS_ALIAS,bundle:true,format:'iife',globalName:'ethers',platform:'browser',target:'es2022',minify:true,legalComments:'eof',footer:{js:'/*! Complete dependency licenses: '+path.basename(ETHERS_LICENSE)+' */'},preserveSymlinks:true,write:false,metafile:true,logLevel:'silent'});
  const bytes=build.outputFiles[0].contents,sha256=sha(bytes),file=`assets/vendor/fst-ethers-${sha256.slice(0,16).toUpperCase()}.js`,license=await vendorLicenses(root,build.metafile);
  const asset={kind:'generated-ethers',source:'tools/runtime/ethers-entry.mjs',package:'ethers',version:EXPECTED_ETHERS,exports:ETHERS_EXPORTS,path:file,sha256,bytes:bytes.length,license:ETHERS_LICENSE};
  return{bytes,asset,license,alias:{kind:'generated-ethers-alias',source:asset.source,path:ETHERS_ALIAS,sha256,bytes:bytes.length},sourcePaths:[...Object.keys(build.metafile.inputs),packageSource,...license.sources]};
}
export async function buildRuntime({root=fileURLToPath(new URL('../../',import.meta.url)),check=false}={}) {
  root=await realpath(path.resolve(root));
  if(esbuild.version!==EXPECTED_ESBUILD)throw Error(`Expected esbuild ${EXPECTED_ESBUILD}; run npm ci --prefix tools/runtime`);
  const previous=await approvedCompatibility(root),vendor=await buildEthers(root);
  const build=await esbuild.build({absWorkingDir:root,entryPoints:{'fst-runtime-app':'src/app.js','fst-runtime-boot':'src/swap-boot.mjs'},outdir:'src',entryNames:'[name]-[hash]',chunkNames:'fst-runtime-chunk-[hash]',outExtension:{'.js':'.mjs'},bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,metafile:true,plugins:[vendorPlugin],logLevel:'silent'});
  const outputs=new Map(build.outputFiles.map(file=>[slash(path.relative(root,file.path)),file.contents]));
  const files=Object.entries(build.metafile.outputs).map(([file,info])=>({path:slash(file),sha256:sha(outputs.get(slash(file))),bytes:info.bytes,imports:info.imports.map(i=>({path:slash(i.path),kind:i.kind,external:!!i.external})),inputs:Object.keys(info.inputs).sort(),...(info.entryPoint?{entryPoint:info.entryPoint}:{})})).sort((a,b)=>a.path.localeCompare(b.path));
  const cacheAssets=[vendor.asset],mutableAssets=[vendor.alias,vendor.license.asset];outputs.set(vendor.asset.path,vendor.bytes);outputs.set(vendor.alias.path,vendor.bytes);outputs.set(vendor.license.asset.path,vendor.license.bytes);
  for(const source of ['src/swap-official.css','src/swap-manage.css','src/swap-ui.css']){
    const bytes=await readFile(path.join(root,source)),sha256=sha(bytes),short=sha256.slice(0,16).toUpperCase(),file=`src/fst-style-${path.basename(source,'.css').replace(/^swap-/,'')}-${short}.css`;
    cacheAssets.push({source,path:file,sha256,bytes:bytes.length});outputs.set(file,bytes);
  }
  for(const file of previous.files)if(outputs.has(file.path)&&sha(outputs.get(file.path))!==file.sha256)throw Error('Conflicting current and compatibility runtime bytes: '+file.path);
  const sourcePaths=[...new Set([...Object.keys(build.metafile.inputs).map(file=>file.split('?')[0]),...vendor.sourcePaths,...cacheAssets.map(asset=>asset.source),'tools/runtime/build.mjs','tools/runtime/compatibility.json','tools/runtime/package.json','tools/runtime/package-lock.json'])].sort();
  const sources=await Promise.all(sourcePaths.map(async file=>({path:file,sha256:sha(await readFile(path.join(root,file)))})));
  const entries={boot:files.find(f=>f.entryPoint==='src/swap-boot.mjs')?.path,app:files.find(f=>f.entryPoint==='src/app.js')?.path};
  if(!entries.boot||!entries.app||files.length>12)throw Error('Unexpected published runtime entry graph');
  const preloads=preloadRoutes(files,entries),manifest={schema:1,esbuildVersion:esbuild.version,entries,files,cacheAssets,mutableAssets,routePreloads:preloads.routes,preloadPriority:preloads.priority,compatibility:previous.metadata,compatibilityAssets:previous.files,sources};
  outputs.set('src/fst-runtime-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  const html=await readFile(path.join(root,'index.html'),'utf8');outputs.set('index.html',Buffer.from(publishedHtml(html,manifest)));
  const approved=new Set(previous.files.map(file=>file.path)),stale=[];
  for(const [dir,pattern]of [['src',/^(?:fst-runtime-(?:app|boot|chunk)-[A-Z0-9]{8}\.mjs|fst-style-(?:official|manage|ui)-[A-F0-9]{16}\.css)$/],['assets/vendor',/^fst-ethers-[A-F0-9]{16}\.js$/]]){
    for(const name of await readdir(path.join(root,dir))){const file=dir+'/'+name;if(pattern.test(name)&&!outputs.has(file)&&!approved.has(file))stale.push(file);}
  }
  const different=[];for(const [file,body]of outputs){const current=await fileExists(path.join(root,file));if(!current||!Buffer.from(body).equals(current))different.push(file);}
  if(check){if(different.length||stale.length)throw Error('Runtime artifacts are stale: '+[...different,...stale].join(', '));}
  else{for(const [file,body]of outputs){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),body);}for(const file of stale)await unlink(path.join(root,file));}
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const check=process.argv.includes('--check');try{const manifest=await buildRuntime({check});console.log(JSON.stringify({mode:check?'verified':'generated',files:manifest.files.length,vendor:manifest.cacheAssets[0].bytes,routePreloads:Object.fromEntries(Object.entries(manifest.routePreloads).map(([key,files])=>[key,files.length])),entries:manifest.entries}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
