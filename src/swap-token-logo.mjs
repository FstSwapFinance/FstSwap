import { safeLogoUrl } from './token-catalog.mjs';
import { TOKEN_LOGO_MIRRORS } from './swap-token-logo-cache.mjs';
const placeholders=new WeakMap();
export function tokenLogoSources(token) {
 const source=safeLogoUrl(token?.logoURI);if(!source)return[];
 const cached=TOKEN_LOGO_MIRRORS[`${token?.chainId??56}:${String(token?.address||'').toLowerCase()}`];
 return cached?.source===source?[cached.path,source]:[source];
}
// Preserve template dimensions and overlap; failures restore the original placeholder.
export function tokenLogo(token,sample,{loading='eager'}={}) {
 if(!sample)return null;
 if(token?.address)sample.dataset.tokenAddress=token.address.toLowerCase();
 const fallback=(placeholders.get(sample)||sample).cloneNode(true);
 if(token?.address)fallback.dataset.tokenAddress=token.address.toLowerCase();
 const sources=tokenLogoSources(token),src=sources.shift();
 if(!src)return placeholders.has(sample)?fallback:null;
 const img=document.createElement('img');
 for(const attr of ['class','style','width','height','data-token-address'])if(sample.hasAttribute(attr))img.setAttribute(attr,sample.getAttribute(attr));
 img.style.objectFit='contain';img.style.borderRadius='50%';img.style.flexShrink='0';
 img.width=parseInt(sample.getAttribute('width'))||24;img.height=parseInt(sample.getAttribute('height'))||24;
 img.alt=(token.symbol||'Token')+' logo';img.decoding='async';img.loading=loading;img.referrerPolicy='no-referrer';
 placeholders.set(img,fallback);
 img.addEventListener('error',()=>{const next=sources.shift();if(next)img.src=next;else img.replaceWith(fallback.cloneNode(true));});img.src=src;return img;
}
export function applyTokenLogo(sample,token,options){const img=tokenLogo(token,sample,options);if(img&&sample)sample.replaceWith(img);return img;}
