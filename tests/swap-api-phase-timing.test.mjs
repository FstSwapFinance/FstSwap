import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine,createApi} from '../server/fstswap-service.mjs';
import {measurePhase,countTiming} from '../server/swap-timing.mjs';
const a='0x'+'11'.repeat(20),b='0x'+'22'.repeat(20),input={chainId:56,tokenIn:a,tokenOut:b,amountIn:'100',slippageBps:50,singleHop:false};
async function serve(t,engine,pool={health:()=>({providers:[]})}){
 const server=createApi({engine,pool});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 return body=>fetch('http://127.0.0.1:'+server.address().port+'/api/swap/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
}
test('the real API emits named engine phases while preserving its quote DTO',async t=>{
 const now=Date.now(),block={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+Math.floor(now/1000).toString(16)};
 const pool={run:(fn,signal)=>fn(async payload=>payload.method==='eth_getBlockByNumber'?block:'0x',{id:'same'},signal),health:()=>({providers:[]})};
 const engine=createEngine(pool,{warmup:{enabled:false},readConfig:async()=>({version:'1.11'}),readPolicy:async()=>({checkedAt:now,assertFresh(){}}),calculate:async()=>({out:200n})});
 const post=await serve(t,engine,pool),response=await post(input),body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.quote,{out:{$bigint:'200'}});
 const timing=response.headers.get('server-timing');for(const phase of ['total','context','config','policy','route','canonical','encode'])assert.match(timing,new RegExp('(?:^|, )'+phase+';dur='));
 assert.doesNotMatch(timing,/https|private|0x/);
});
test('overlapping API requests keep their metrics isolated and rejected work still has timing',async t=>{
 const post=await serve(t,{quote:async value=>measurePhase('route',async()=>{countTiming('rpc_calls',Number(value.amountIn));await new Promise(r=>setImmediate(r));if(value.amountIn==='2')throw Object.assign(Error('private upstream detail'),{code:'TAX_UNVERIFIED'});return{accepted:true};})});
 const [one,two]=await Promise.all([post({...input,amountIn:'1'}),post({...input,amountIn:'2'})]);
 assert.equal(one.status,200);assert.equal(two.status,422);assert.deepEqual(await two.json(),{error:'TAX_UNVERIFIED'});
 assert.match(one.headers.get('server-timing'),/rpc_calls;desc="1"/);assert.match(two.headers.get('server-timing'),/rpc_calls;desc="2"/);
 assert.match(two.headers.get('server-timing'),/route;dur=/);assert.doesNotMatch(two.headers.get('server-timing'),/private|upstream/);
});
