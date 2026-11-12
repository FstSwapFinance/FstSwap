import * as esbuild from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const EXPECTED_ESBUILD='0.28.2';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=value=>value.split(path.sep).join('/');
const vendorPlugin={name:'keep-wallet-and-chart-lazy',setup(build){
  build.onResolve({filter:/assets\/(?:official\/)?vendor\//},args=>({path:args.path,external:true}));
}};
const fileExists=async file=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function approvedCompatibility(root) {
  const source=JSON.parse(await readFile(path.join(root,'tools/runtime/compatibility.json'),'utf8'));
  const previous=source.previousRelease,files=previous?.files;
  if(source.schema!==1||!/^\d+$/.test(previous?.release||'')||!/^[0-9a-f]{40}$/.test(previous?.sourceCommit||'')||!/^[0-9a-f]{64}$/.test(previous?.sourceManifestSHA256||'')||!Array.isArray(files)||!files.length||files.length>12)throw Error('Invalid runtime compatibility metadata');
  const seen=new Set();
  for(const file of files){
    if(!/^src\/fst-runtime-(?:app|boot|chunk)-[A-Z0-9]{8}\.mjs$/.test(file.path||'')||!/^[0-9a-f]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<1||seen.has(file.path))throw Error('Invalid runtime compatibility asset');
    seen.add(file.path);const bytes=await fileExists(path.join(root,file.path));
    if(!bytes||bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Missing or changed approved runtime compatibility asset: '+file.path);
  }
  return previous;
}
function publishedHtml(html,manifest) {
  // Discover the small quote graph before UI/vendor bandwidth competes for it.
  const byPath=new Map(manifest.files.map(file=>[file.path,file])),seen=new Set(),ordered=[];
  const visit=file=>{if(seen.has(file.path))return;seen.add(file.path);for(const item of file.imports)if(!item.external&&item.kind!=='dynamic-import')visit(byPath.get(item.path));ordered.push(file);};
  visit(byPath.get(manifest.entries.boot));const earlyPaths=new Set(ordered.map(file=>file.path));
  visit(byPath.get(manifest.entries.app));for(const file of manifest.files)visit(file);
  const preload=ordered.map(file=>`  <link rel="modulepreload" href="${file.path}"${earlyPaths.has(file.path)?' fetchpriority="high"':''} />`).join('\n');
  const early=`  <!-- fst-runtime-preloads:start -->\n${preload}\n  <script type="module" async src="${manifest.entries.boot}"></script>\n  <!-- fst-runtime-preloads:end -->\n`;
  html=html.replace(/  <!-- fst-runtime-preloads:start -->[\s\S]*?  <!-- fst-runtime-preloads:end -->\n/,'');
  html=html.replace(/^  <link rel="modulepreload"[^\n]*\n/gm,'').replace(/^  <script>\(function\(\)\{var route=[^\n]*\n/gm,'');
  const vendor=manifest.cacheAssets.find(asset=>asset.source==='assets/vendor/ethers.umd.min.js');
  const library=`  <script async data-fst-library="ethers" fetchpriority="high" onload="this.dataset.fstLibraryState='loaded'" onerror="this.dataset.fstLibraryState='error'" src="${vendor.path}"></script>`;
  html=html.replace(/^  <(?:link rel="preload" as="script" href="assets\/vendor\/ethers\.umd\.min\.js" \/>|script async data-fst-library="ethers"[^\n]*)$/m,library);
  for(const asset of manifest.cacheAssets.filter(asset=>asset.source.endsWith('.css'))){
    const name=path.basename(asset.source,'.css').replace(/^swap-/,'');
    const original=asset.source.replaceAll('.','\\.');
    const stylesheet=new RegExp(`(<link rel="stylesheet" href=")(?:${original}(?:\\?[^"<>]*)?|src/fst-style-${name}-[A-F0-9]{16}\\.css)(")`);
    html=html.replace(stylesheet,'$1'+asset.path+'$2');
  }
  if(!html.includes(library))throw Error('Missing owned ethers HTML script');
  html=html.replace(library,early+library);
  return html.replace(/  <script type="module" src="(?:src\/app\.js[^"<>]*|src\/fst-runtime-app-[A-Z0-9]+\.mjs)"><\/script>/,`  <script type="module" src="${manifest.entries.app}"></script>`);
}

export async function buildRuntime({root=fileURLToPath(new URL('../../',import.meta.url)),check=false}={}) {
  root=await realpath(path.resolve(root));
  if(esbuild.version!==EXPECTED_ESBUILD)throw Error(`Expected esbuild ${EXPECTED_ESBUILD}; run npm ci --prefix tools/runtime`);
  // These exact previous-release bytes let already-open tabs finish a delayed
  // dynamic import. Never silently admit other historical or intermediate chunks.
  const previous=await approvedCompatibility(root);
  const build=await esbuild.build({absWorkingDir:root,entryPoints:{'fst-runtime-app':'src/app.js','fst-runtime-boot':'src/swap-boot.mjs'},outdir:'src',entryNames:'[name]-[hash]',chunkNames:'fst-runtime-chunk-[hash]',outExtension:{'.js':'.mjs'},bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,metafile:true,plugins:[vendorPlugin],logLevel:'silent'});
  const outputs=new Map(build.outputFiles.map(file=>[slash(path.relative(root,file.path)),file.contents]));
  for(const file of previous.files)if(outputs.has(file.path)&&sha(outputs.get(file.path))!==file.sha256)throw Error('Conflicting current and compatibility runtime bytes: '+file.path);
  const cacheAssets=[];
  for(const source of ['assets/vendor/ethers.umd.min.js','src/swap-official.css','src/swap-manage.css','src/swap-ui.css']){
    const bytes=await readFile(path.join(root,source)),sha256=sha(bytes),short=sha256.slice(0,16).toUpperCase();
    const file=source.endsWith('.js')?`assets/vendor/fst-ethers-${short}.js`:`src/fst-style-${path.basename(source,'.css').replace(/^swap-/,'')}-${short}.css`;
    cacheAssets.push({source,path:file,sha256,bytes:bytes.length});outputs.set(file,bytes);
  }
  const files=Object.entries(build.metafile.outputs).map(([file,info])=>({path:slash(file),sha256:sha(outputs.get(slash(file))),bytes:info.bytes,imports:info.imports.map(i=>({path:slash(i.path),kind:i.kind,external:!!i.external})),inputs:Object.keys(info.inputs).sort(),...(info.entryPoint?{entryPoint:info.entryPoint}:{})})).sort((a,b)=>a.path.localeCompare(b.path));
  const sourcePaths=[...new Set([...Object.keys(build.metafile.inputs).map(file=>file.split('?')[0]),...cacheAssets.map(asset=>asset.source),'tools/runtime/build.mjs','tools/runtime/compatibility.json','tools/runtime/package.json','tools/runtime/package-lock.json'])].sort();
  const sources=await Promise.all(sourcePaths.map(async file=>({path:file,sha256:sha(await readFile(path.join(root,file)))})));
  const {files:compatibilityAssets,...compatibility}=previous;
  const manifest={schema:1,esbuildVersion:esbuild.version,entries:{boot:files.find(f=>f.entryPoint==='src/swap-boot.mjs')?.path,app:files.find(f=>f.entryPoint==='src/app.js')?.path},files,cacheAssets,compatibility,compatibilityAssets,sources};
  if(!manifest.entries.boot||!manifest.entries.app||files.length>12)throw Error('Unexpected published runtime entry graph');
  const manifestPath='src/fst-runtime-manifest.json';outputs.set(manifestPath,Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  const html=await readFile(path.join(root,'index.html'),'utf8');outputs.set('index.html',Buffer.from(publishedHtml(html,manifest)));
  const approved=new Set(compatibilityAssets.map(file=>file.path));
  const stale=(await readdir(path.join(root,'src'))).filter(file=>/^fst-runtime-.*\.mjs$/.test(file)&&!outputs.has('src/'+file)&&!approved.has('src/'+file));
  const different=[];
  for(const [file,body]of outputs){const current=await fileExists(path.join(root,file));if(!current||!Buffer.from(body).equals(current))different.push(file);}
  if(check){if(different.length||stale.length)throw Error('Runtime artifacts are stale: '+[...different,...stale.map(file=>'src/'+file)].join(', '));}
  else{
    await mkdir(path.join(root,'src'),{recursive:true});
    for(const [file,body]of outputs)await writeFile(path.join(root,file),body);
    for(const file of stale)await unlink(path.join(root,'src',file));
  }
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const check=process.argv.includes('--check');
  try{const manifest=await buildRuntime({check});console.log(JSON.stringify({mode:check?'verified':'generated',files:manifest.files.length,entries:manifest.entries}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
