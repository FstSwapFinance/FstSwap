// Explicit synthetic data for the read-only benchmark. Never imported by runtime.
import {ethers} from 'ethers';

const ZERO=ethers.ZeroAddress,UNIT=10n**18n;
const extraAbi=[
 'function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])',
 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)',
 'function decimals() view returns(uint8)','function factory() view returns(address)',
 'function getPool(address,address,uint24) view returns(address)',
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)',
 'function liquidity() view returns(uint128)',
 'function token0() view returns(address)','function token1() view returns(address)',
 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)',
 'function getEthBalance(address) view returns(uint256)',
 'function balanceOf(address) view returns(uint256)',
 'function quoteExactIn(bytes,uint256) returns(uint256)',
];
export const address=n=>'0x'+n.toString(16).padStart(40,'0');
export function benchmarkCodec(aggregator){return new ethers.Interface([...aggregator.SWAP_ABI,...extraAbi]);}

// All prices and reserves below are invented 1:1 integer-unit assets. They are
// deliberately unrelated to public token prices, balances, liquidity or yield.
export function createSyntheticServiceFixture(aggregator){
 const codec=benchmarkCodec(aggregator),U=aggregator.SWAP_TOKENS.usdt.address.toLowerCase(),F=aggregator.SWAP_TOKENS.fist.address.toLowerCase();
 const W=aggregator.SWAP_ADAPTERS.pancake.weth.toLowerCase(),fst=aggregator.SWAP_ADAPTERS.fst.adapter.toLowerCase(),pcs=aggregator.SWAP_ADAPTERS.pancake.adapter.toLowerCase();
 const block={number:'0x123456',hash:'0x'+'bc'.repeat(32),timestamp:ethers.toQuantity(Math.floor(Date.now()/1000))};
 const pairs=[{adapter:fst,tokens:[U,F].sort(),address:address(1001)},{adapter:pcs,tokens:[U,W].sort(),address:address(1002)}];
 function result(payload){
  if(payload.method==='eth_chainId')return '0x38';
  if(payload.method==='eth_getBlockByNumber')return {...block};
  if(payload.method==='eth_getBalance')return ethers.toQuantity(12n*UNIT);
  if(payload.method!=='eth_call')throw Error('Synthetic fixture forbids '+payload.method);
  const calls=codec.decodeFunctionData('tryAggregate',payload.params[0].data)[1];
  return codec.encodeFunctionResult('tryAggregate',[calls.map(call=>{
   const tx=codec.parseTransaction({data:call.callData}),a=tx.args;
   let values;
   switch(tx.name){
    case 'platformFeeBps':values=[30];break;
    case 'feeReceiver':values=[address(44)];break;
    case 'WBNB':values=[W];break;
    case 'adapters':values=[true];break;
    case 'aggregator':values=[aggregator.swapActiveRouter()];break;
    case 'VERSION':values=['2.1.0'];break;
    case 'defaultFeeToken':values=[U];break;
    case 'feeConfigVersion':values=[5n];break;
    case 'factory':values=[address(99)];break;
    case 'getPool':values=[ZERO];break;
    case 'latestRoundData':values=[1n,100000000n,0n,BigInt(block.timestamp),1n];break;
    case 'decimals':values=[8];break;
    case 'getEthBalance':values=[12n*UNIT];break;
    case 'balanceOf':values=[call.target.toLowerCase()===F?234567890n:34n*UNIT];break;
    case 'getPairInfo':{
     const tokens=[a[1].toLowerCase(),a[2].toLowerCase()].sort();
     const found=pairs.find(p=>p.adapter===a[0].toLowerCase()&&p.tokens.join(':')===tokens.join(':'));
     values=[found?.address||ZERO,...tokens,found?1000000n*UNIT:0n,found?1000000n*UNIT:0n,1n,0n];break;
    }
    case 'getAmountsOutVia':values=[[a[1],a[1]*999n/1000n]];break;
    default:throw Error('Unexpected synthetic contract method '+tx.name);
   }
   return [true,codec.encodeFunctionResult(tx.name,values)];
  })]);
 }
 return {block,result};
}

// 170 disjoint three-hop V2/V3/V2 lanes produce [80,80,10] CALL batches at
// every dependency depth. Only the external RPC is synthetic; the route
// enumeration, batching, association, tax funding and selection are production.
export function createSyntheticLaneFixture(aggregator){
 const codec=benchmarkCodec(aggregator),IN=aggregator.SWAP_TOKENS.usdt.address.toLowerCase(),OUT='0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',pools=new Map(),models=new Map();
 const add=(lane,depth,token0,token1,kind,adapter)=>{
  const pool={address:address(10000+lane*3+depth),adapter,token0,token1,kind,fee:100,reserves:[1000000n,1000000n],sqrt:2n**96n};
  pools.set(pool.address,pool);
  const path=kind==='v3'?'0x'+token0.slice(2)+'000064'+token1.slice(2):[token0,token1].join(':');
  models.set(kind+':'+path,{lane,depth});
 };
 for(let lane=1;lane<=170;lane++){
  const a=address(20000+lane),b=address(30000+lane);
  add(lane,0,IN,a,'v2',aggregator.SWAP_ADAPTERS.fst.adapter);
  add(lane,1,a,b,'v3',aggregator.SWAP_ADAPTERS.v3.adapter);
  add(lane,2,b,OUT,'v2',aggregator.SWAP_ADAPTERS.pancake.adapter);
 }
 const policy={pools,blockNumber:'0x123',allowsRoute:()=>true,assertFresh(){}};
 const transferTaxes=new Map([...pools.values()].flatMap(p=>[p.token0,p.token1]).map(token=>[token,{kind:'none'}]));
 function decode(payload){
  if(payload.method!=='eth_call'||payload.params[1]!==policy.blockNumber)throw Error('Invalid lane RPC');
  return Array.from(codec.decodeFunctionData('tryAggregate',payload.params[0].data)[1],call=>{
   const tx=codec.parseTransaction({data:call.callData}),kind=tx.name==='getAmountsOutVia'?'v2':'v3';
   const path=kind==='v2'?Array.from(tx.args[2],t=>t.toLowerCase()).join(':'):tx.args[0].toLowerCase();
   const model=models.get(kind+':'+path);
   if(!model)throw Error('Unknown synthetic lane');
   return {...model,method:tx.name,kind,amount:tx.args[1]};
  });
 }
 function encode(rows){return codec.encodeFunctionResult('tryAggregate',[rows.map(row=>{
  const output=BigInt((row.depth+1)*10000+row.lane);
  return [true,codec.encodeFunctionResult(row.method,[row.kind==='v2'?[row.amount,output]:output])];
 })]);}
 return {policy,transferTaxes,decode,encode,args:{from:IN,to:OUT,amount:10000n,policy,configVersion:'2.0.0',transferTaxes}};
}
