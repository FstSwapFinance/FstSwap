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
 if(off.some(key=>!['fst','pancake','v3'].includes(key))||new Set(off).size!==off.length)throw invalid();
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

const canceled=()=>new DOMException('Submission read canceled','AbortError');
function checkSignal(signal){if(signal?.aborted)throw canceled();}
function boundedRead(work,signal,timeoutMs=15000){
 return new Promise((resolve,reject)=>{
  let timer;
  const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);fn(value);};
  const onAbort=()=>finish(reject,canceled());
  signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>finish(reject,Object.assign(Error('提交前读取超时，请重新获取报价'),{code:'SWAP_RPC'})),timeoutMs);
  Promise.resolve(work).then(value=>finish(resolve,value),error=>finish(reject,error));
  if(signal?.aborted)onAbort();
 });
}

// One operation, one fresh pinned block. Only deterministic calls at that block
// share completed values; canonical rechecks, nonce and latest gas never do.
export function createSubmissionReadContext(request,{clock=Date.now,signal}={}){
 const controller=new AbortController(),active=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const reads=new Map();let header;
 const call=payload=>{checkSignal(active);return boundedRead(Promise.resolve().then(()=>request(payload,{signal:active})),active);};
 async function block(){
  checkSignal(active);
  if(!header){
   const pending=call({method:'eth_getBlockByNumber',params:['latest',false]}).then(value=>{
    if(!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value?.number||'')||!/^0x[0-9a-f]{64}$/i.test(value?.hash||'')||!/^0x[0-9a-f]+$/i.test(value?.timestamp||'')||Math.abs(clock()/1000-Number(BigInt(value.timestamp)))>120)throw invalid();
    return Object.freeze({...value});
   });
   header=pending;pending.catch(()=>{if(header===pending)header=null;});
  }
  return header;
 }
 async function read(payload){
  checkSignal(active);
  if(payload.method==='eth_getBlockByNumber'&&payload.params?.[0]==='latest')return block();
  if(payload.method!=='eth_call')return call(payload);
  if(!Array.isArray(payload.params)||payload.params.length!==2)throw invalid();
  const pinned=await block();checkSignal(active);
  const tag=payload.params[1];
  if(tag!=='latest'&&tag!==pinned.number)return call(payload);
  const input={...payload,params:[{...payload.params[0]},pinned.number]},key=JSON.stringify(input);
  if(!reads.has(key)){
   if(reads.size>=256)throw invalid();
   const pending=call(input);reads.set(key,pending);
   pending.catch(()=>{if(reads.get(key)===pending)reads.delete(key);});
  }
  return reads.get(key);
 }
 return{read,block,signal:active,dispose(){controller.abort();reads.clear();header=null;}};
}

// Independent read-only work starts together. Configuration, pool admission and
// simulation remain hard gates; only the existing gas defaults may be used.
export async function prepareSwapSubmission({check,allowance,simulate,estimate,gasPrice,minimum,signal}){
 if(typeof minimum!=='bigint'||minimum<=0n||[check,allowance,simulate,estimate,gasPrice].some(fn=>typeof fn!=='function'))throw invalid();
 checkSignal(signal);
 const results=await boundedRead(Promise.allSettled([check,allowance,simulate,estimate,gasPrice].map(fn=>Promise.resolve().then(()=>fn({signal})))),signal);
 checkSignal(signal);
 const [validated,approved,simulated,estimated,priced]=results;
 if(validated.status==='rejected')throw validated.reason;
 if(approved.status==='rejected')throw approved.reason;
 const policy=validated.value.policy;policy.assertFresh();
 if(approved.value===true)return{policy,needsApproval:true};
 if(simulated.status==='rejected')throw simulated.reason;
 if(typeof simulated.value!=='bigint'||simulated.value<minimum)throw Object.assign(Error('链上仿真未满足最少到账约束'),{code:'UNSAFE_QUOTE'});
 return{policy,needsApproval:false,simulated:simulated.value,
  gasLimit:estimated.status==='fulfilled'?BigInt(estimated.value)*13n/10n:900000n,
  gasPrice:priced.status==='fulfilled'?BigInt(priced.value):3000000000n};
}
