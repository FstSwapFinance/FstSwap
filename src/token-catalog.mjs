import { validateTokenList } from './swap-token-lists.mjs?v=manage-20261110-1';
export const TOKEN_LIST_SOURCE='https://raw.githubusercontent.com/FstSwapFinance/FstSwap/main/tokens.json';
export function legacyList(value) {
 const v=validateTokenList(value);
 return {name:v.name,logoURI:v.logoURI||'',keywords:Array.isArray(v.keywords)?v.keywords:[],timestamp:v.timestamp,
 tokens:v.tokens.map(t=>({chainId:t.chainId,address:t.address,name:t.name,symbol:t.symbol,decimals:t.decimals,...(t.logoURI?{logoURI:t.logoURI}:{})})),version:v.version};
}
export function safeLogoUrl(value) {
 if(typeof value!=='string')return '';
 if(/^assets\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..'))return value;
 try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function migrateDefaultSource(raw,oldUrls,newUrl,fallback) {
 try {const v=JSON.parse(raw);if(!v||typeof v.lists!=='object'||Array.isArray(v.lists))return raw;
 const old=oldUrls.map(u=>v.lists[u]).find(Boolean);
 if(!v.lists[newUrl]&&old)v.lists[newUrl]={list:fallback,active:old.active===true};
 for(const u of oldUrls)if(u!==newUrl)delete v.lists[u];return JSON.stringify(v);
 }catch{return raw;}
}
export function preferNewerList(current,incoming) {
 if(!current)return incoming;
 for(const k of ['major','minor','patch']){const d=incoming.version[k]-current.version[k];if(d)return d>0?incoming:current;}
 return incoming;
}
