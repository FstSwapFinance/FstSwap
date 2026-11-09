import { legacyList, safeLogoUrl } from '../src/token-catalog.mjs';
export function prepareCatalogUpdate(current,draft,now=new Date().toISOString()) {
 const old=legacyList(current),next=legacyList(draft);
 if(next.tokens.some(t=>t.chainId!==56))throw Error('只允许添加 BSC 主网（56）代币');
 for(const t of next.tokens)if(t.logoURI&&(!safeLogoUrl(t.logoURI)||!t.logoURI.startsWith('https://')))throw Error('Logo 必须使用不含凭据的 HTTPS 图片地址');
 if(next.logoURI&&(!safeLogoUrl(next.logoURI)||!next.logoURI.startsWith('https://')))throw Error('列表 Logo 必须使用 HTTPS 地址');
 return {...next,timestamp:now,version:{...old.version,patch:old.version.patch+1}};
}
export async function saveCatalog(api,baseSha,draft) {
 if(typeof baseSha!=='string'||!baseSha)throw Error('请先载入 GitHub 最新列表');
 const current=await api.read();if(current.sha!==baseSha)throw Error('GitHub 列表已被修改，请重新载入并合并改动');
 const list=prepareCatalogUpdate(current.list,draft);
 const result=await api.write(baseSha,list);
 return {...result,list};
}
