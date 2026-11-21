import {cp,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export async function runtimeFixture(t,{prefix='fst-runtime-fixture-',nodeModules=true}={}){
 const dir=await mkdtemp(path.join(tmpdir(),prefix));t.after(()=>rm(dir,{recursive:true,force:true}));
 await cp(new URL('src/',root),path.join(dir,'src'),{recursive:true});await cp(new URL('index.html',root),path.join(dir,'index.html'));
 await mkdir(path.join(dir,'tools/runtime'),{recursive:true});await cp(new URL('assets/vendor/',root),path.join(dir,'assets/vendor'),{recursive:true});
 for(const file of ['build.mjs','package.json','package-lock.json','compatibility.json','ethers-entry.mjs'])await cp(new URL('tools/runtime/'+file,root),path.join(dir,'tools/runtime',file));
 if(nodeModules)await symlink(fileURLToPath(new URL('tools/runtime/node_modules/',root)),path.join(dir,'tools/runtime/node_modules'),'dir');
 return dir;
}
