import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {quoteFstRoutes,FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {SWAP_ADAPTERS,SWAP_ABI,swapActiveRouter} from '../src/swap-aggregator.mjs?v=mainnet-20261113-50';

globalThis.ethers=ethers;
const IN=FST_FEE_ASSETS.USDT,OUT=FST_FEE_ASSETS.USDC,BLOCK='0x123';
const router=new ethers.Interface(SWAP_ABI);
const quoter=new ethers.Interface(['function quoteExactIn(bytes,uint256) returns(uint256)']);
const multicall=new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const turn=()=>new Promise(resolve=>setImmediate(resolve));

// Only the external multicall RPC is controlled. Route construction, ABI
// decoding, cache association, tax funding and result selection remain real.
function fixture({revertLane,laneCount=170,quotePipeline,configVersion='2.0.0',taxModel}={}){
 const pools=new Map(),models=new Map(),calls=[];
 const add=(lane,depth,token0,token1,kind,adapter)=>{
  const address=addr(10000+lane*3+depth),fee=100;
  const pool={address,adapter,token0,token1,kind,fee,reserves:[1000000n,1000000n],sqrt:2n**96n};
  pools.set(address,pool);
  const path=kind==='v3'?'0x'+token0.slice(2)+fee.toString(16).padStart(6,'0')+token1.slice(2):[token0,token1].join(':');
  models.set(kind+':'+path,{lane,depth});
 };
 for(let lane=1;lane<=laneCount;lane++){
  const a=addr(20000+lane),b=addr(30000+lane);
  add(lane,0,IN,a,'v2',SWAP_ADAPTERS.fst.adapter);
  if(configVersion==='2.1.0')add(lane,1,a,b,'v2',SWAP_ADAPTERS.fst.adapter);
  else add(lane,1,a,b,'v3',SWAP_ADAPTERS.v3.adapter);
  add(lane,2,b,OUT,'v2',SWAP_ADAPTERS.pancake.adapter);
 }
 const policy={pools,blockNumber:BLOCK,allowsRoute:()=>true,assertFresh(){}};
 const transferTaxes=new Map([...pools.values()].flatMap(p=>[p.token0,p.token1]).map(token=>[token,{kind:'none'}]));
 if(taxModel===null)transferTaxes.delete(IN);
 else if(taxModel)transferTaxes.set(IN,taxModel);
 let active=0,maxActive=0;
 const request=async({method,params})=>{
  assert.equal(method,'eth_call');assert.equal(params[1],BLOCK);
  assert.equal(params[0].to.toLowerCase(),'0xca11bde05977b3631167028862be2a173976ca11');
  const [requireSuccess,batch]=multicall.decodeFunctionData('tryAggregate',params[0].data);
  assert.equal(requireSuccess,false);assert.ok(batch.length>0&&batch.length<=80);
  const decoded=batch.map(call=>{
   const kind=call.target.toLowerCase()===swapActiveRouter().toLowerCase()?'v2':'v3';
   const abi=kind==='v2'?router:quoter,tx=abi.parseTransaction({data:call.callData});
   const path=kind==='v2'?[...tx.args[2]].map(x=>x.toLowerCase()).join(':'):tx.args[0].toLowerCase();
   const model=models.get(kind+':'+path);assert.ok(model,'only policy-admitted lane pools may be quoted');
   const amount=tx.args[1],expectedInput=BigInt(model.depth===0?10000:model.depth*10000+model.lane);
   assert.equal(amount,expectedInput,`lane ${model.lane} depth ${model.depth} must consume its own preceding output`);
   assert.ok(calls.every(c=>c.depth>=model.depth||c.settled),'dependent depth must wait for every previous-depth RPC');
   return{...model,kind,abi,method:tx.name,amount};
  });
  assert.ok(decoded.every(d=>d.depth===decoded[0].depth),'a physical batch contains only one dependency depth');
  let resolve,reject;
  const gate=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const record={depth:decoded[0].depth,decoded,settled:false,release:mode=>resolve(mode),reject};
  calls.push(record);active++;maxActive=Math.max(maxActive,active);
  try{
   const mode=await gate;
   const entries=decoded.map(d=>d.depth===0&&d.lane===revertLane?[false,'0x']:[true,d.abi.encodeFunctionResult(d.method,[d.kind==='v2'?[d.amount,BigInt((d.depth+1)*10000+d.lane)]:BigInt((d.depth+1)*10000+d.lane)])]);
   return multicall.encodeFunctionResult('tryAggregate',[mode==='short'?entries.slice(1):entries]);
  }finally{record.settled=true;active--;}
 };
 return{calls,get active(){return active;},get maxActive(){return maxActive;},
  quote:()=>quoteFstRoutes(request,{from:IN,to:OUT,amount:10000n,policy,configVersion,transferTaxes,quotePipeline})};
}

test('a complete pipeline result replaces all three amount RPCs and preserves candidate quantities',async()=>{
 const baseline=fixture({laneCount:4}),before=observe(baseline.quote());
 await drain(baseline,before);assert.ifError(before.error);assert.equal(baseline.calls.length,3);
 let invocations=0;
 const fast=fixture({laneCount:4,quotePipeline:async({routes,splits,amount,blockNumber})=>{
  invocations++;assert.equal(amount,10000n);assert.equal(blockNumber,BLOCK);assert.deepEqual(splits,[]);
  return{routeOutputs:routes.map((legs,n)=>legs.map((_,depth)=>BigInt((depth+1)*10000+n+1))),splitOutputs:[]};
 }});
 const after=observe(fast.quote());await drain(fast,after);assert.ifError(after.error);
 assert.equal(invocations,1);assert.equal(fast.calls.length,0);
 const wire=q=>JSON.stringify(q,(_,v)=>typeof v==='bigint'?v.toString():v);
 assert.equal(wire(after.value),wire(before.value));
});

test('an incomplete pipeline result cannot prime even its successful prefix',async()=>{
 let invocations=0;
 const f=fixture({laneCount:4,quotePipeline:async()=>{
  invocations++;return{routeOutputs:[[5000n,6000n,7000n],[],[],[]],splitOutputs:[]};
 }});
 const state=observe(f.quote());await drain(f,state);assert.ifError(state.error);
 assert.equal(invocations,1);assert.equal(f.calls.length,3);assert.equal(state.value.out,30004n);
});

test('unverified and pair-tax models cannot enter the zero-tax pipeline',async()=>{
 const quotePipeline=()=>assert.fail('nonstandard transfer-tax model reached the pipeline');
 const unknown=fixture({laneCount:4,configVersion:'2.1.0',taxModel:null,quotePipeline});
 await assert.rejects(unknown.quote(),{code:'TAX_UNVERIFIED'});
 assert.equal(unknown.calls.length,0);
 const pair=fixture({laneCount:4,configVersion:'2.1.0',taxModel:{kind:'pair',pair:addr(55),buyBps:300n,sellBps:300n},quotePipeline});
 const quote=observe(pair.quote());await drain(pair,quote);assert.ifError(quote.error);
 assert.equal(pair.calls.length,3);assert.equal(quote.value.out,30004n);
});

function observe(promise){
 const state={settled:false};
 state.done=promise.then(value=>{state.value=value;state.settled=true;},error=>{state.error=error;state.settled=true;});
 return state;
}

// Always release outstanding RPC gates, including when a red assertion fails.
async function drain(f,state){
 for(let n=0;n<40&&!state.settled;n++){
  f.calls.filter(c=>!c.settled).forEach(c=>c.release());
  await turn();
 }
 assert.ok(state.settled,'quote must settle after every controlled RPC is released');
 await state.done;
}

test('same-depth batches overlap at most two RPCs and retain all mixed V2/V3 lane mappings',async()=>{
 const f=fixture(),state=observe(f.quote());
 try{
  await turn();
  assert.equal(f.calls.length,2,'two independent first-depth batches should start before either response');
  assert.equal(f.active,2);
  f.calls[1].release();await turn();
  assert.ok(f.calls.every(c=>c.depth===0),'the unresolved first batch blocks every dependent depth');
  assert.ok(f.active<=2);
 }finally{await drain(f,state);}
 assert.ifError(state.error);
 const q=state.value;
 assert.equal(f.maxActive,2);assert.equal(f.calls.length,9);
 assert.equal(f.calls.flatMap(c=>c.decoded).length,510);
 for(const depth of [0,1,2]){
  const batches=f.calls.filter(c=>c.depth===depth);
  assert.deepEqual(batches.map(c=>c.decoded.length),[80,80,10]);
  assert.deepEqual(batches.flatMap(c=>c.decoded.map(d=>d.lane)),Array.from({length:170},(_,n)=>n+1),'batch boundaries preserve request order');
 }
 assert.equal(q.candidates.length,170);assert.equal(q.out,30170n);
 assert.deepEqual(q.legs.map(l=>[l.kind,l.amountIn,l.grossOut,l.out]),[
  ['v2',10000n,10170n,10170n],['v3',10170n,20170n,20170n],['v2',20170n,30170n,30170n],
 ]);
 for(const candidate of q.candidates){
  const lane=Number(candidate.out-30000n);
  assert.deepEqual(candidate.legs.map(l=>l.poolIds[0]),[addr(10000+lane*3),addr(10001+lane*3),addr(10002+lane*3)]);
  assert.deepEqual(candidate.legs.map(l=>l.amountIn),[10000n,BigInt(10000+lane),BigInt(20000+lane)]);
 }
});

test('a reverted subcall drops only its route while concurrent valid lane quotes remain exact',async()=>{
 const f=fixture({revertLane:81}),state=observe(f.quote());
 await drain(f,state);
 assert.ifError(state.error);
 assert.equal(f.maxActive,2);assert.equal(f.calls.length,9);
 assert.equal(f.calls.flatMap(c=>c.decoded).length,508,'the failed first hop must not request either dependent hop');
 assert.equal(state.value.candidates.length,169);assert.equal(state.value.out,30170n);
 assert.ok(state.value.candidates.every(c=>c.out!==30081n));
 assert.ok(f.calls.filter(c=>c.depth>0).every(c=>c.decoded.every(d=>d.lane!==81)));
});

test('an incomplete physical batch waits for its started sibling before rejecting the whole quote',async()=>{
 const f=fixture(),state=observe(f.quote());
 try{
  await turn();assert.equal(f.calls.length,2);
  f.calls[0].release('short');await turn();
  assert.equal(state.settled,false,'an incomplete batch cannot reject while a started sibling is unresolved');
  assert.equal(f.calls[1].settled,false);
 }finally{await drain(f,state);}
 assert.match(state.error?.message||'',/报价返回不完整/);
 assert.equal(state.value,undefined,'partial cached outputs cannot be published as a trusted route');
 assert.ok(f.calls.every(c=>c.depth===0),'no dependent amount may be quoted after an incomplete layer');
 assert.ok(f.calls.every(c=>c.settled));
});

test('concurrent RPC rejections are all observed before quote failure escapes',async()=>{
 const f=fixture(),state=observe(f.quote());
 try{
  await turn();assert.equal(f.calls.length,2);
  f.calls[0].reject(Error('first physical batch rejected'));await turn();
  assert.equal(state.settled,false,'quote failure must wait for the other started RPC');
  f.calls[1].reject(Error('second physical batch rejected'));await turn();
 }finally{await drain(f,state);}
 assert.match(state.error?.message||'',/physical batch rejected/);
 assert.equal(state.value,undefined);
 assert.ok(f.calls.every(c=>c.depth===0));assert.ok(f.calls.every(c=>c.settled));
});
