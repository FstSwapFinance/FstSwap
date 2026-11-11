// Fresh configuration and full pool discovery are independent reads. A remote
// quote may provide only provisional settings; chain equality is mandatory.
const invalid=()=>Object.assign(Error('链上配置已变化，请重新获取报价'),{code:'UNSAFE_QUOTE'});
const address=(value,allowZero=false)=>{
 if(typeof value!=='string'||!/^0x[0-9a-f]{40}$/i.test(value)||!allowZero&&/^0x0{40}$/i.test(value))throw invalid();
 return value.toLowerCase();
};
function snapshot(config){
 if(!config||!['2.0.0','2.1.0'].includes(config.version)||typeof config.feeConfigVersion!=='bigint'||config.feeConfigVersion<=0n||!Number.isInteger(config.platformFeeBps)||config.platformFeeBps<0||config.platformFeeBps>100||!Array.isArray(config.adaptersOff))throw invalid();
 const off=[...config.adaptersOff];
 if(off.some(key=>!['fst','pancake','biswap','v3'].includes(key))||new Set(off).size!==off.length)throw invalid();
 return {version:config.version,feeConfigVersion:config.feeConfigVersion,platformFeeBps:config.platformFeeBps,
  defaultFeeToken:address(config.defaultFeeToken,true),feeReceiver:address(config.feeReceiver),wbnb:address(config.wbnb),adaptersOff:off.sort()};
}
const stamp=config=>JSON.stringify(snapshot(config),(_,v)=>typeof v==='bigint'?v.toString():v);
export async function recheckSwapQuote({quote,readConfig,readPolicy}) {
 let config,policy;
 if(quote?.kind==='fstswap'&&['2.0.0','2.1.0'].includes(quote.serviceMeta?.config?.version)){
  const provisional=snapshot(quote.serviceMeta.config),expected=stamp(provisional);
  [config,policy]=await Promise.all([readConfig(),readPolicy(provisional)]);
  if(stamp(config)!==expected)throw invalid();
 }else{
  config=await readConfig();policy=await readPolicy(config);
 }
 policy.assertFresh();return{config,policy};
}
