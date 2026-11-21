import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as service from '../src/swap-service-client.mjs';

const upstream='https://logo-api.fstswap.si/api/swap';
const vercelHosts=['fstswap-live.vercel.app','fstswap-live-3jnn41nga-haocutbabas.vercel.app','fstswap-live-git-codex-quote-wallet-haocutbabas.vercel.app'];
const originalHosts=['127.0.0.1','localhost','fstswap.pro','www.fstswap.pro'];
test('approved Vercel aliases use the same-origin read API while original hosts retain the independent API',()=>{
 assert.equal(typeof service.serviceBaseForHost,'function');
 for(const host of vercelHosts)assert.equal(service.serviceBaseForHost(host),'/api/swap',host);
 for(const host of originalHosts)assert.equal(service.serviceBaseForHost(host),upstream,host);
});
test('unknown hosts and lookalike suffixes cannot enable the quote service',()=>{
 assert.equal(typeof service.serviceBaseForHost,'function');
 for(const host of [undefined,null,'','example.test','other.vercel.app','not-fstswap-live.vercel.app','fstswap-live.vercel.app.evil.test','fstswap-live-abc.vercel.app.evil.test','fstswap-live-.vercel.app','fstswap-live_abc.vercel.app','fstswap.pro.evil.test','www.fstswap.pro.evil.test','localhost.evil.test','127.0.0.1.evil.test'])assert.equal(service.serviceBaseForHost(host),'',String(host));
});
test('RPC and router overrides independently disable both same-origin and independent service hosts',()=>{
 assert.equal(typeof service.serviceBaseForHost,'function');
 for(const host of [...vercelHosts,...originalHosts]){
  for(const options of [{rpcOverride:true},{routerOverride:true},{rpcOverride:true,routerOverride:true}])assert.equal(service.serviceBaseForHost(host,options),'',host+JSON.stringify(options));
  assert.equal(service.serviceBaseForHost(host,{rpcOverride:false,routerOverride:false}),vercelHosts.includes(host)?'/api/swap':upstream);
 }
});

const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const actions=['health','quote','balances'];
test('Vercel forwards only three exact read API paths and never RPC, wallet send, or an arbitrary path',()=>{
 const rewrites=config.rewrites??[];
 assert.deepEqual(rewrites.map(row=>row.source).sort(),actions.map(action=>'/api/swap/'+action).sort());
 for(const action of actions){const rule=rewrites.find(row=>row.source==='/api/swap/'+action);assert.equal(rule.destination,upstream+'/'+action);}
 for(const path of ['/api/swap/rpc','/api/swap/send','/api/swap/eth_sendTransaction','/api/swap/quote/extra','/api/swap/health/extra','/api/swap','/rpc'])assert.equal(rewrites.some(row=>row.source===path),false,path);
});
test('all proxied API paths explicitly disable browser, CDN, and Vercel rewrite caching',()=>{
 for(const action of actions){
  const path='/api/swap/'+action,headers=Object.fromEntries((config.headers??[]).filter(row=>row.source===path||row.source==='/api/swap/:path*').flatMap(row=>row.headers).map(h=>[h.key.toLowerCase(),h.value]));
  for(const key of ['cache-control','cdn-cache-control','vercel-cdn-cache-control'])assert.match(headers[key]??'',/(?:^|,)\s*no-store\s*(?:,|$)/i,path+':'+key);
  assert.equal(headers['x-vercel-enable-rewrite-caching'],'0',path);
 }
 assert.equal(config.framework,null);assert.equal(config.installCommand,'');assert.equal(config.buildCommand,'');assert.equal(config.outputDirectory,'.');
});

const a='0x55d398326f99059ff775485246999027b3197955',b='0xc9882def23bc42d53895b8361d0b1edc7570bc6a',router='0x'+'33'.repeat(20),adapter='0x'+'44'.repeat(20);
const input={tokenIn:a,tokenOut:b,amountIn:1000000000000000001n,slippageBps:0,singleHop:false},binding={router,adapters:{fst:{adapter}}};
const wire=value=>JSON.stringify(value,(_,x)=>typeof x==='bigint'?{$bigint:x.toString()}:x);
const quote=()=>({schema:1,chainId:56,router,blockNumber:'0x1',blockHash:'0x'+'ab'.repeat(32),quotedAt:9500,expiresAt:20000,input:{chainId:56,...input,amountIn:input.amountIn.toString()},config:{version:'1.11',platformFeeBps:30,feeReceiver:a,wbnb:b,defaultFeeToken:a,feeConfigVersion:1n,adaptersOff:[]},quote:{kind:'v10',method:'swapTokenToToken',first:{adapter,path:[a,b]},amountIn:input.amountIn,out:5n,lpFee:3000000000000000n,feeToken:a,impact:0,poolCheckedAt:5000}});
test('same-origin quote requests preserve credentials omission, exact integers, and fresh cache bypass',async()=>{
 assert.equal(typeof service.serviceBaseForHost,'function');
 let calls=0;const client=service.createServiceClient({base:service.serviceBaseForHost(vercelHosts[0]),clock:()=>10000,fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'/api/swap/quote');assert.equal(init.method,'POST');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');
  const body=JSON.parse(init.body);assert.equal(body.amountIn,input.amountIn.toString());assert.equal(body.slippageBps,0);return new Response(wire(quote()));
 }});
 assert.equal((await client.quote(input,binding)).quote.amountIn,input.amountIn);assert.ok(await client.quote(input,binding));assert.equal(calls,1);
 assert.ok(await client.quote(input,{...binding,fresh:true}));assert.equal(calls,2);
});
test('same-origin response transport never relaxes chain, router, input, or expiry validation',async()=>{
 assert.equal(typeof service.serviceBaseForHost,'function');
 for(const change of [q=>q.chainId=97,q=>q.router=a,q=>q.input.amountIn='1',q=>q.expiresAt=9999]){
  const value=quote();change(value);
  const client=service.createServiceClient({base:service.serviceBaseForHost(vercelHosts[0]),clock:()=>10000,fetchImpl:async()=>new Response(wire(value))});
  assert.equal(await client.quote(input,binding),null);
 }
});
