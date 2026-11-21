import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createApi,quoteInput} from '../server/fstswap-service.mjs';
import {createServiceClient} from '../src/swap-service-client.mjs';
import {SWAP_ADAPTERS,swapActiveRouter} from '../src/swap-aggregator.mjs';

const source=readFileSync(new URL('../src/swap-view.mjs',import.meta.url),'utf8');
const inputError=source.slice(source.indexOf('  function inputError()'),source.indexOf('  function needsApproval()'));
const Z='0x'+'00'.repeat(20),U='0x55d398326f99059ff775485246999027b3197955';

test('a real API price rejection reaches the client and the view as price protection, without fallback',async t=>{
 // The actual quote engine's structured throw is covered by
 // fstswap-value-rejection.test.mjs. Here the seam starts at that exception;
 // HTTP encoding, client decoding and the view's inputError function are real.
 const server=createApi({pool:{health:()=>({providers:[]})},engine:{quote(input){
  quoteInput(input);
  throw Object.assign(Error('minimum below independent reference'),{code:'POOL_LIQUIDITY',reason:'price',retryable:false});
 }}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const responses=[];
 const client=createServiceClient({base:'http://127.0.0.1:'+server.address().port+'/api/swap',fetchImpl:async(url,options)=>{
  const response=await fetch(url,options);responses.push({status:response.status,body:await response.clone().json()});return response;
 }});
 let rejection;
 await assert.rejects(client.quote({tokenIn:Z,tokenOut:U,amountIn:1000000000000000n,slippageBps:50,singleHop:false},{router:swapActiveRouter(),adapters:SWAP_ADAPTERS}),error=>{
  rejection=error;return error.code==='POOL_LIQUIDITY'&&error.reason==='price'&&error.retryable===false;
 });
 assert.deepEqual(responses,[{status:422,body:{error:'POOL_LIQUIDITY',reason:'price'}}]);
 assert.equal(client.available(),true,'a structured rejection must not become null and open browser RPC fallback');
 const state={amount:'0.001',quoteError:rejection.code,quoteErrorReason:rejection.reason,quote:null,balances:{}};
 const context={state,settings:{singleHop:false},SWAP_V10_MISSING:{code:'V10_NOT_DEPLOYED'},
  inT:()=>({key:'bnb',address:null,symbol:'BNB'}),outT:()=>({key:'usdt',address:U,symbol:'USDT'}),T:label=>label,tr:(zh)=>zh};
 vm.createContext(context);vm.runInContext(inputError,context);
 assert.equal(context.inputError(),'成交下限偏离参考价超过 2%，请减少金额或滑点');
 assert.notEqual(context.inputError(),'没有符合流动性要求的交易路线');
 context.tr=(_zh,en)=>en;
 assert.equal(context.inputError(),'Minimum value deviates over 2%; reduce amount or slippage');
});
