import http from 'node:http';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {saveCatalog} from './token-admin-core.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.env.TOKEN_ADMIN_PORT||8130);
const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]),csrf=randomBytes(32).toString('hex');
const endpoint='https://api.github.com/repos/FstSwapFinance/FstSwap/contents/tokens.json';
const exec=promisify(execFile);
let saving=false;
async function credential(){
 if(process.env.GITHUB_TOKEN)return process.env.GITHUB_TOKEN.trim();
 try {return (await exec(process.env.GH_BIN||'gh',['auth','token','--hostname','github.com'],{timeout:5000})).stdout.trim();}catch{return '';}
}
async function github(method,body){
 const token=await credential();if(method!=='GET'&&!token)throw Error('未配置 GitHub 授权；请在本机完成 gh auth login 后重试');
 let res;try{res=await fetch(endpoint+(method==='GET'?'?ref=main':''),{method,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Error(method==='PUT'?'保存结果未知，请刷新 GitHub 列表核对，不要直接重复提交':'GitHub 连接失败，请重试');}
 if(!res.ok)throw Error(res.status===409||res.status===422?'GitHub 文件已变更或分支受保护，请刷新核对':`GitHub 请求失败（${res.status}），请检查仓库权限`);
 return res.json();
}
const api={read:async()=>{const r=await github('GET');return {sha:r.sha,list:JSON.parse(Buffer.from(r.content,'base64').toString('utf8'))}},write:async(sha,list)=>{
 const r=await github('PUT',{branch:'main',sha,message:`chore(tokens): update catalog to ${list.version.major}.${list.version.minor}.${list.version.patch}`,content:Buffer.from(JSON.stringify(list,null,4)+'\n').toString('base64')});
 return {sha:r.content.sha,commit:r.commit.sha,url:r.commit.html_url};
}};
const files=new Map([['/','token-admin.html'],['/token-admin.html','token-admin.html'],['/token-admin.css','token-admin.css'],['/token-admin.mjs','token-admin.mjs'],['/token-catalog.mjs','token-catalog.mjs'],['/swap-token-lists.mjs','swap-token-lists.mjs']]);
function reply(res,status,value,type='application/json'){const body=type==='application/json'?JSON.stringify(value):value;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});res.end(body);}
export function validOrigin(req){return hosts.has(req.headers.host)&&(!req.headers.origin||req.headers.origin===`http://${req.headers.host}`);}
http.createServer(async(req,res)=>{
 try {
  if(!validOrigin(req))return reply(res,403,{error:'来源不允许'});
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/api/status')return reply(res,200,{repository:'FstSwapFinance/FstSwap',branch:'main',path:'tokens.json',configured:Boolean(await credential()),csrf});
  if(req.method==='GET'&&path==='/api/list')return reply(res,200,await api.read());
  if(req.method==='POST'&&path==='/api/save'){
   if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-csrf-token']!==csrf)return reply(res,403,{error:'请重新打开后台页面'});
   if(saving)return reply(res,409,{error:'已有保存操作，请等待核验'});
   saving=true;
   try{
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2_000_000)throw Error('列表文件过大');}
    const {sha,list}=JSON.parse(body),result=await saveCatalog(api,sha,list);
    try{
     await writeFile(resolve(root,'tokens.json.tmp'),JSON.stringify(result.list,null,4)+'\n');await rename(resolve(root,'tokens.json.tmp'),resolve(root,'tokens.json'));
     await writeFile(resolve(root,'swap-default-tokens.mjs.tmp'),'// Default list offline snapshot.\nexport default '+JSON.stringify(result.list,null,2)+';\n');await rename(resolve(root,'swap-default-tokens.mjs.tmp'),resolve(root,'swap-default-tokens.mjs'));
    }catch{result.warning='GitHub 已保存，本地副本更新失败；请重新下载 tokens.json';}
    return reply(res,200,result);
   }finally{saving=false;}
  }
  if(req.method==='GET'&&files.has(path)){const f=files.get(path),type=f.endsWith('.mjs')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';return reply(res,200,await readFile(resolve(root,f)),type);}
  return reply(res,404,{error:'Not found'});
 }catch(e){reply(res,400,{error:e.message||'操作失败'});}
}).listen(port,'127.0.0.1',()=>console.log(`代币管理后台 http://127.0.0.1:${port} · FstSwapFinance/FstSwap/main/tokens.json`));
