import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'..');
const config=JSON.parse(readFileSync(resolve(here,'mainnet-config.json'),'utf8'));
const names=['AggregatedRouterV10','V10RouteEngine','FstSwapAdapter56','PancakeAdapter56','BiSwapAdapter56','PancakeV3Adapter'];
const contracts={};
for(const name of names){
 const file=name==='V10RouteEngine'?'AggregatedRouterV10':name;
 const a=JSON.parse(readFileSync(resolve(root,`out/${file}.sol/${name}.json`),'utf8'));
 const runtimeBytes=(a.deployedBytecode.object.length-2)/2;
 if(runtimeBytes>24576) throw Error(name+' runtime exceeds limit');
 if((a.bytecode.object.length-2)/2>49152) throw Error(name+' init exceeds limit');
 contracts[name]={abi:a.abi,bytecode:a.bytecode.object,deployedBytecode:a.deployedBytecode.object,immutableReferences:a.deployedBytecode.immutableReferences,runtimeBytes,bytecodeHash:ethers.keccak256(a.bytecode.object)};
 const metadata=typeof a.metadata==='string'?JSON.parse(a.metadata):a.metadata;
 for(const [source,details] of Object.entries(metadata.sources)){
  // Every resolved Solidity source is hashed against compiler metadata before producing a signing artifact.
  const path=resolve(root,source);
  if(ethers.keccak256(readFileSync(path))!==details.keccak256) throw Error('stale artifact: '+source);
 }
}
const sources=Object.fromEntries(readdirSync(resolve(root,'src')).filter(x=>x.endsWith('.sol')).map(name=>[name,createHash('sha256').update(readFileSync(resolve(root,'src',name))).digest('hex')]));
const manifest={schema:1,network:'BSC mainnet',chainId:56,release:'v10-fees-1.11',...config,readyForSigning:false,
 compiler:'0.8.26',optimizerRuns:1,viaIR:true,evmVersion:'paris',generatedAt:new Date().toISOString(),sources,contracts,
 dependencies:{fstWbnb:'0x0efb5FD2402A0967B92551d6AF54De148504A115',wbnb:'0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',v3Quoter:'0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'}};
if(process.argv.includes('--ready')) {
 const validation=JSON.parse(readFileSync(resolve(here,'validation.json'),'utf8'));
 if(validation.contractTests.failed!==0||validation.frontendTests.failed!==0||!validation.localRehearsal||!validation.reviewComplete) throw Error('validation incomplete');
 for(const [file,hash] of Object.entries(validation.fileHashes)) {
  if(createHash('sha256').update(readFileSync(resolve(root,'../..',file))).digest('hex')!==hash) throw Error('validation stale: '+file);
 }
 manifest.readyForSigning=true;manifest.validation=validation;
}
writeFileSync(resolve(here,'mainnet-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(names.map(n=>`${n}: ${contracts[n].runtimeBytes} bytes`).join('\n'));
