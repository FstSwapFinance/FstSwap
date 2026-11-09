import { safeLogoUrl } from './token-catalog.mjs';
const placeholders=new WeakMap();
// Preserve template dimensions and overlap; failures restore the original placeholder.
export function tokenLogo(token,sample) {
 if(!sample)return null;
 if(token?.address)sample.dataset.tokenAddress=token.address.toLowerCase();
 const fallback=(placeholders.get(sample)||sample).cloneNode(true);
 if(token?.address)fallback.dataset.tokenAddress=token.address.toLowerCase();
 const src=safeLogoUrl(token?.logoURI);
 if(!src)return placeholders.has(sample)?fallback:null;
 const img=document.createElement('img');
 for(const attr of ['class','style','width','height','data-token-address'])if(sample.hasAttribute(attr))img.setAttribute(attr,sample.getAttribute(attr));
 img.style.objectFit='contain';img.style.borderRadius='50%';img.style.flexShrink='0';
 img.width=parseInt(sample.getAttribute('width'))||24;img.height=parseInt(sample.getAttribute('height'))||24;
 img.alt=(token.symbol||'Token')+' logo';img.decoding='async';img.referrerPolicy='no-referrer';
 placeholders.set(img,fallback);
 img.addEventListener('error',()=>img.replaceWith(fallback.cloneNode(true)),{once:true});img.src=src;return img;
}
export function applyTokenLogo(sample,token){const img=tokenLogo(token,sample);if(img&&sample)sample.replaceWith(img);return img;}
