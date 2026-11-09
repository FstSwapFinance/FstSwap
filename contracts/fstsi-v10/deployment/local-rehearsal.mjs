// Local-only rehearsal. Uses Anvil unlocked simulation accounts, never private keys or a public write RPC.
import { readFileSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';
const rpc='http://127.0.0.1:8547';
if(new URL(rpc).hostname!=='127.0.0.1') throw Error('local only');
const provider=new ethers.JsonRpcProvider(rpc,56,{staticNetwork:true});
if(!(await provider.send('web3_clientVersion',[])).toLowerCase().includes('anvil'))throw Error('Anvil required');
const manifest=JSON.parse(readFileSync(new URL('./mainnet-manifest.json',import.meta.url),'utf8'));
const owner=manifest.owner;
await provider.send('anvil_impersonateAccount',[owner]);await provider.send('anvil_setBalance',[owner,'0x3635c9adc5dea00000']);
const admin=await provider.getSigner(owner), actor=admin;
const txs=[];
async function deploy(name,args){const a=manifest.contracts[name];const contract=await new ethers.ContractFactory(a.abi,a.bytecode,actor).deploy(...args);const rc=await contract.deploymentTransaction().wait();txs.push({step:name,hash:rc.hash,address:await contract.getAddress(),gasUsed:rc.gasUsed.toString()});return contract;}
const router=await deploy('AggregatedRouterV10',[manifest.dependencies.fstWbnb,manifest.feeReceiver,manifest.platformFeeBps,owner]);
const routerAddress=await router.getAddress(), adapters={};
for(const [key,name] of [['fst','FstSwapAdapter56'],['pancake','PancakeAdapter56'],['biswap','BiSwapAdapter56'],['v3','PancakeV3Adapter']]){
 const args=key==='v3'?[routerAddress,manifest.dependencies.wbnb,manifest.dependencies.v3Quoter]:[routerAddress];
 adapters[key]=await(await deploy(name,args)).getAddress();
 const receipt=await(await router.connect(admin).setAdapter(adapters[key],true)).wait();txs.push({step:'register-'+key,hash:receipt.hash,gasUsed:receipt.gasUsed.toString()});
}
const config={router:routerAddress,adapters};
if((await router.VERSION())!=='1.11'||(await router.owner())!==owner||(await router.feeReceiver())!==manifest.feeReceiver)throw Error('configuration mismatch');
const account=await actor.getAddress();
const output={environment:'LOCAL ANVIL ONLY — not mainnet',rpc,config,account,owner,feeReceiver:manifest.feeReceiver,transactions:txs,engine:await router.routeEngine()};
writeFileSync('tests/walk-out/v10-fees-local-rehearsal.json',JSON.stringify(output,null,2)+'\n');
writeFileSync('tests/walk-out/v10-fees-local-config.json',JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({environment:output.environment,config,account,totalDeploymentGas:txs.reduce((a,t)=>a+BigInt(t.gasUsed),0n).toString()},null,2));
