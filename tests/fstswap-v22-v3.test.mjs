import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {buildFstQuote, fstServiceQuote, quoteFstRoutes, FST_FEE_ASSETS} from '../src/swap-fstswap.mjs';
import {validateServiceQuote} from '../src/swap-service-client.mjs';
import {SWAP_ABI, SWAP_ADAPTERS, swapActiveRouter} from '../src/swap-aggregator.mjs';
import {BNCB_BEACON, BNCB_IMPLEMENTATION, readTransferTaxes} from '../src/swap-transfer-tax.mjs';

globalThis.ethers = ethers;
const BNCB = '0x4902c5ebc598265ed2212b559b042de8a5eeec3f';
const {USDT, USDC, WBNB} = FST_FEE_ASSETS;
const blockNumber = '0x8101567';
const address = byte => '0x' + byte.repeat(20);
const multicall = new ethers.Interface(['function tryAggregate(bool,(address target,bytes callData)[]) view returns((bool success,bytes returnData)[])']);
const quoteV2 = new ethers.Interface(SWAP_ABI);
const quoteV3 = new ethers.Interface(['function quoteExactIn(bytes,uint256) returns(uint256)']);

const profile = {
 token: BNCB, kind: 'verified-erc20', blockNumber,
 codeHash: 'cab8def0d66267b06413aa602595cddeef26d118e1aa3ce8795139a4b518aa7d',
 beaconCodeHash: '8fcfd53bedda9ff9f8b672da979fc5b8b563a3b61dcf9b32c5c075390000312f',
 implementationCodeHash: '814fc45a704716dbda5b91791b69b7780924f66ae604606d670bded136bc339c',
};

function fixture({bncbPoolKind = 'v3', peer = WBNB} = {}) {
 const pool = (token0, token1, kind, id) => ({token0, token1, kind,
  adapter:SWAP_ADAPTERS[kind === 'v3' ? 'v3' : 'pancake'].adapter,
  address:address(id),fee:2500,sqrt:2n**96n,reserves:[10n**24n,10n**24n]});
 const first = pool(USDT, peer, 'v2', '11');
 const second = pool(peer, BNCB, bncbPoolKind, '22');
 const pools = new Map([first, second].map(entry => [entry.address,entry]));
 const policy = {pools,blockNumber,allowsRoute:() => true,assertFresh(){}};
 const transferTaxes = new Map([USDT,peer,BNCB].map(token => [token,{kind:'none'}]));
 const request = async ({method,params}) => {
  assert.equal(method,'eth_call');
  assert.equal(params[1],blockNumber);
  const [,calls] = multicall.decodeFunctionData('tryAggregate',params[0].data);
  const results = calls.map(call => {
   const v3 = call.target.toLowerCase() === SWAP_ADAPTERS.v3.adapter.toLowerCase();
   const codec = v3 ? quoteV3 : quoteV2;
   const parsed = codec.parseTransaction({data:call.callData});
   const amount = parsed.args[1], output = amount * 99n / 100n;
   return [true,codec.encodeFunctionResult(parsed.name,[v3 ? output : [amount,output]])];
  });
  return multicall.encodeFunctionResult('tryAggregate',[results]);
 };
 return (from,to,amount,configVersion='2.2.0') => quoteFstRoutes(request,{from,to,amount,configVersion,policy,transferTaxes});
}

test('2.2 builds the BNCB V3 principal pool route with a USDT bridge in both directions', async () => {
 const find = fixture();
 assert.deepEqual((await find(USDT,BNCB,10000n)).legs.map(leg=>leg.kind),['v2','v3']);
 assert.deepEqual((await find(BNCB,USDT,10000n)).legs.map(leg=>leg.kind),['v3','v2']);
 await assert.rejects(find(USDT,BNCB,10000n,'2.1.0'),{code:'NO_ROUTE'});
});

test('2.2 does not use a V2 BNCB edge or an unapproved V3 pairing', async () => {
 await assert.rejects(fixture({bncbPoolKind:'v2'})(USDT,BNCB,10000n),{code:'NO_ROUTE'});
 await assert.rejects(fixture({peer:USDC})(USDT,BNCB,10000n),{code:'NO_ROUTE'});
});

test('the versioned wire format keeps BNCB proof, fee and minimum output bound to its quote', async () => {
 const config = {version:'2.2.0',platformFeeBps:30,feeReceiver:address('aa'),wbnb:WBNB,defaultFeeToken:USDT,feeConfigVersion:4n,adaptersOff:[]};
 const input = {chainId:56,tokenIn:USDT,tokenOut:BNCB,amountIn:'10000',slippageBps:50,singleHop:false};
 const find = fixture();
 const computed = await buildFstQuote({...input,amountIn:10000n,config,findRoute:(from,to,amount)=>find(from,to,amount)});
 computed.quoteModel = 'net-transfer-v1';
 computed.taxProfiles = [profile];
 const quote = fstServiceQuote(computed,{slippageBps:50,poolCheckedAt:10000});
 const body = {schema:1,chainId:56,router:swapActiveRouter(),input,config,quote,blockNumber,blockHash:'0x'+'ab'.repeat(32),quotedAt:10000,expiresAt:25000};
 const options = {router:swapActiveRouter(),adapters:SWAP_ADAPTERS,clock:() => 11000,expectedVersion:'2.2.0'};
 assert.equal(validateServiceQuote(body,input,options),body);
 assert.equal(quote.lpFee,30n);
 assert.equal(quote.minimum,quote.out*9950n/10000n);
 for (const invalid of [[],[{...profile,blockNumber:'0x8101566'}],[{...profile,implementationCodeHash:'00'.repeat(32)}]]) {
  quote.taxProfiles = invalid;
  assert.throws(() => validateServiceQuote(body,input,options),{code:'TAX_UNVERIFIED'});
 }
 quote.taxProfiles = [profile];
 config.version = '2.1.0';
 assert.throws(() => validateServiceQuote(body,input,{...options,expectedVersion:'2.1.0'}),{code:'TAX_UNVERIFIED'});
});

test('an unverified implementation produces no ordinary zero-tax model', async () => {
 const calls = [];
 const request = async payload => {
  calls.push(payload);
  assert.equal(payload.params[1],blockNumber);
  return payload.method==='eth_getCode'?'0x6080':'0x'+'1'.padStart(64,'0');
 };
 await assert.rejects(readTransferTaxes(request,{tokens:[BNCB],blockNumber,version:'2.1.0'}),{code:'TAX_UNVERIFIED'});
 assert.equal(calls.length,0);
 await assert.rejects(readTransferTaxes(request,{tokens:[BNCB],blockNumber,version:'2.2.0'}),{code:'TAX_UNVERIFIED'});
 assert.deepEqual(calls.filter(call=>call.method==='eth_getCode').map(call=>call.params[0]),[BNCB,BNCB_BEACON,BNCB_IMPLEMENTATION]);
 assert.deepEqual(calls.at(-1).params,[{to:BNCB_BEACON,data:'0x5c60da1b'},blockNumber]);
});
