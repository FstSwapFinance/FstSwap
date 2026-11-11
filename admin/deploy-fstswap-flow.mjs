// User-started sequence. Only submitted hashes advance automatically; an
// uncertain wallet request is retained and can never trigger another send.
const fail=(code,message)=>Object.assign(new Error(message),{code});
export async function runDeploymentSequence({next,pending,intent,prepare,send,confirm,complete,signal,maxSteps=9}){
 const seen=new Set();
 const running=()=>{if(signal?.aborted)throw new DOMException('Deployment stopped','AbortError');};
 while(true){
  running();const step=next();if(!step){await complete();return;}
  if(seen.has(step.key)||seen.size>=maxSteps)throw fail('DEPLOYMENT_STATE','部署进度未更新，已停止后续签名');
  seen.add(step.key);
  let submission=pending();
  if(submission&&submission.step!==step.key)throw fail('DEPLOYMENT_STATE','已保存的交易步骤与当前进度不一致');
  if(!submission){
   if(intent())throw fail('UNKNOWN_SUBMISSION','钱包尚未返回本笔结果，页面不会重复发送。请先在钱包处理该请求。');
   const prepared=await prepare(step);running();submission=await send(prepared,{signal});
  }
  if(!/^0x[0-9a-f]{64}$/i.test(submission?.hash||''))throw fail('UNKNOWN_SUBMISSION','钱包未返回交易结果，页面不会重复发送。');
  running();const receipt=await confirm(step,submission.hash);running();
  if(!receipt?.verified)throw fail('DEPLOYMENT_FAILED','本笔部署未成功，后续签名已停止');
 }
}
