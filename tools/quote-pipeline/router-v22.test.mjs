import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEVM} from '@ethereumjs/evm';
import {createCustomCommon, Mainnet, Hardfork} from '@ethereumjs/common';
import {Account, createAddressFromString, hexToBytes, bytesToHex} from '@ethereumjs/util';
import solc from 'solc';
import {ethers} from 'ethers';

const BNCB = '0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const FIST = '0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A';
const PANCAKE = '0x1b81D678ffb9C0263b24A97847620C99d213eB14';
const AMOUNT = 100_000n;
const FEE = AMOUNT * 30n / 10000n;
const OTHER = '0x' + '33'.repeat(20);
const addr = byte => '0x' + byte.repeat(20);
const owner = addr('11'), payer = addr('12'), recipient = addr('13'), feeReceiver = addr('14');
const factory = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const deployer = addr('22'), quoter = addr('23');
const bncbPool = addr('24'), bridgePool = addr('25'), directPool = addr('26'), splitPool = addr('27');
const TIMER = 1800000000n;
const localContracts = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {FstSwap} from "FstSwap.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address feeFrom;
    bool inboundTax;
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value:amount}("");
        require(ok);
    }
    function mint(address who,uint256 amount) external { balanceOf[who] += amount; }
    function tax(address account,bool inbound) external { feeFrom = account; inboundTax = inbound; }
    function approve(address who,uint256 amount) external returns(bool) { allowance[msg.sender][who] = amount; return true; }
    function transfer(address who,uint256 amount) external returns(bool) { _transfer(msg.sender,who,amount); return true; }
    function transferFrom(address from,address who,uint256 amount) external returns(bool) { allowance[from][msg.sender] -= amount; _transfer(from,who,amount); return true; }
    function _transfer(address from,address to,uint256 amount) private {
        balanceOf[from] -= amount;
        uint256 withheld = (inboundTax ? to == feeFrom : from == feeFrom) ? amount / 100 : 0;
        balanceOf[to] += amount - withheld;
    }
}
contract MockPool {
    function pay(address token,address to,uint256 amount) external { MockERC20(token).transfer(to,amount); }
}
contract MockFactory {
    address constant BNCB = ${BNCB};
    address constant USDT = ${USDT};
    address constant WBNB = ${WBNB};
    function getPool(address a,address b,uint24 fee) external pure returns(address) {
        if (fee != 2500 && fee != 500) return address(0);
        if ((a == BNCB && b == WBNB) || (a == WBNB && b == BNCB)) return fee == 2500 ? ${bncbPool} : ${splitPool};
        if ((a == WBNB && b == USDT) || (a == USDT && b == WBNB)) return ${bridgePool};
        if ((a == BNCB && b == USDT) || (a == USDT && b == BNCB)) return ${directPool};
        if ((a == BNCB && b == ${OTHER}) || (a == ${OTHER} && b == BNCB)) return ${directPool};
        if ((a == WBNB && b == ${OTHER}) || (a == ${OTHER} && b == WBNB)) return ${splitPool};
        if ((a == BNCB && b == ${FIST}) || (a == ${FIST} && b == BNCB)) return ${directPool};
        return address(0);
    }
}
contract MockPancake {
    struct Swap { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 minOut; uint160 priceLimit; }
    function factory() external pure returns(address) { return ${factory}; }
    function deployer() external pure returns(address) { return ${deployer}; }
    function WETH9() external pure returns(address) { return ${WBNB}; }
    function exactInputSingle(Swap calldata params) external payable returns(uint256 received) {
        require(params.deadline >= block.timestamp);
        address pool = MockFactory(${factory}).getPool(params.tokenIn,params.tokenOut,params.fee);
        if (msg.value > 0) {
            require(params.tokenIn == ${WBNB} && msg.value == params.amountIn);
            MockERC20(params.tokenIn).deposit{value:msg.value}();
            MockERC20(params.tokenIn).transfer(pool,params.amountIn);
        } else {
            MockERC20(params.tokenIn).transferFrom(msg.sender,pool,params.amountIn);
        }
        received = params.amountIn * 99 / 100;
        require(received >= params.minOut);
        MockPool(pool).pay(params.tokenOut,params.recipient,received);
    }
}
`;

const source = name => readFileSync(new URL('../../contracts/fstswap-v22/src/' + name, import.meta.url), 'utf8');
const routerSource = source('FstSwap.sol');
const fixtureSource = localContracts + `contract TestFstSwap is FstSwap {
        constructor(address receiver,uint16 bps,address owner) FstSwap(receiver,bps,owner) {}
        function _bncbIdentityVerified() internal pure override returns(bool) { return true; }
      }`;
const input = {
    language:'Solidity',
    sources:{
        'FstSwap.sol':{content:routerSource},
        'PancakeV3Adapter.sol':{content:source('PancakeV3Adapter.sol')},
        'Fixtures.sol':{content:fixtureSource},
    },
    settings:{optimizer:{enabled:true,runs:100}, viaIR:true, evmVersion:'paris',
              outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}},
};
const ozRoot = new URL('../../contracts/v10/lib/openzeppelin-contracts/', import.meta.url);
const compiled = JSON.parse(solc.compile(JSON.stringify(input), {import:path => {
    if (!path.startsWith('@openzeppelin/')) return {error:'Unknown import ' + path};
    return {contents:readFileSync(new URL(path.slice('@openzeppelin/'.length), ozRoot), 'utf8')};
}}));
const errors = (compiled.errors || []).filter(error => error.severity === 'error');
assert.equal(errors.length,0,errors.map(error => error.formattedMessage).join('\n'));
const artifacts = Object.assign({}, ...Object.values(compiled.contracts));
for (const name of ['FstSwap','PancakeV3Adapter']) {
    assert.ok(artifacts[name].evm.deployedBytecode.object.length / 2 <= 24_576, name+' exceeds EIP-170');
}
const router = new ethers.Interface(artifacts.FstSwap.abi);
const token = new ethers.Interface(artifacts.MockERC20.abi);
const common = createCustomCommon({chainId:56}, Mainnet, {hardfork:Hardfork.Shanghai});
const path = (from,to,fee=2500) => ethers.solidityPacked(['address','uint24','address'],[from,fee,to]);
const price = amount => amount*99n/100n;
const asAddress = address => createAddressFromString(address);

async function fixture({mockIdentity=true}={}) {
    const evm = await createEVM({common});
    for (const by of [owner,payer,recipient,feeReceiver,WBNB]) {
        await evm.stateManager.putAccount(asAddress(by), new Account(0n,10n**24n));
    }
    for (const [artifact, targets] of [
        ['MockERC20',[USDT,WBNB,BNCB,OTHER]],
        ['MockPool',[bncbPool,bridgePool,directPool,splitPool]],
        ['MockFactory',[factory]],
        ['MockPancake',[PANCAKE,quoter]],
    ]) {
        for (const address of targets) {
            await evm.stateManager.putCode(asAddress(address),hexToBytes('0x' + artifacts[artifact].evm.deployedBytecode.object));
        }
    }
    const block = {header:{number:135271783n,coinbase:asAddress(owner),timestamp:TIMER,difficulty:0n,
        prevRandao:new Uint8Array(32),gasLimit:30_000_000n,baseFeePerGas:0n,getBlobGasPrice:()=>undefined}};
    async function call(to,data,{by=payer,value=0n}={}) {
        return evm.runCall({caller:asAddress(by), ...(to?{to:asAddress(to)}:{}), data:hexToBytes(data), gasLimit:20_000_000n, block, value});
    }
    function success(result) {
        assert.equal(result.execResult.exceptionError,undefined,'EVM error: '+bytesToHex(result.execResult.returnValue));
        return bytesToHex(result.execResult.returnValue);
    }
    async function create(name,args) {
        const artifact = artifacts[name], iface = new ethers.Interface(artifact.abi);
        const result = await call(null, '0x'+artifact.evm.bytecode.object+iface.encodeDeploy(args).slice(2),{by:owner});
        success(result);
        return result.createdAddress.toString();
    }
    async function write(to,iface,method,args,by=owner) {
        return success(await call(to,iface.encodeFunctionData(method,args),{by}));
    }
    async function balance(asset,account) {
        return token.decodeFunctionResult('balanceOf',await write(asset,token,'balanceOf',[account]))[0];
    }
    const address = await create(mockIdentity?'TestFstSwap':'FstSwap',[feeReceiver,30,owner]);
    const adapter = await create('PancakeV3Adapter',[address,WBNB,quoter]);
    await write(address,router,'setAdapter',[adapter,1,true]);
    for (const asset of [USDT,WBNB,BNCB,OTHER]) {
        for (const target of [payer,bncbPool,bridgePool,directPool,splitPool]) {
            await write(asset,token,'mint',[target,AMOUNT*10n]);
        }
        await write(asset,token,'approve',[address,AMOUNT],payer);
    }
    const stage = (tokenIn,tokenOut,minOut=1n,fee=2500) => ({
        tokenIn,tokenOut,minOut,branches:[{adapter,kind:1,weightBps:10000,path:[],
            v3Path:path(tokenIn===ethers.ZeroAddress?WBNB:tokenIn,tokenOut===ethers.ZeroAddress?WBNB:tokenOut,fee)}],
    });
    async function trade(stages,{minOut=1n,feeToken=USDT,expires=TIMER+60n,configVersion=2n,value=0n}={}) {
        return call(address,router.encodeFunctionData('swapExactInput',[
            {tokenIn:stages[0].tokenIn,tokenOut:stages.at(-1).tokenOut,amountIn:AMOUNT,minOut,recipient,
                deadline:expires,feeToken,configVersion},stages,
        ]),{value});
    }
    const native = async account => (await evm.stateManager.getAccount(asAddress(account))).balance;
    return {address,adapter,balance,native,write,stage,trade,success};
}

test('V2.2 buys BNCB through WBNB and remits the input fee exactly once',async()=>{
    const f = await fixture();
    const out = price(price(AMOUNT-FEE));
    const before = await f.balance(BNCB,bncbPool);
    const result = await f.trade([f.stage(USDT,WBNB),f.stage(WBNB,BNCB,out)],{minOut:out});
    assert.equal(router.decodeFunctionResult('swapExactInput',f.success(result))[0],out);
    assert.equal(await f.balance(BNCB,recipient),out);
    assert.equal(await f.balance(BNCB,bncbPool),before-out);
    assert.equal(await f.balance(BNCB,f.address),0n);
    assert.equal(await f.balance(USDT,feeReceiver),FEE);
});

test('V2.2 sells BNCB through WBNB and charges the fee from realized USDT',async()=>{
    const f = await fixture();
    const gross = price(price(AMOUNT));
    const fee = gross*30n/10000n;
    const before = await f.balance(BNCB,bncbPool);
    const result = await f.trade([f.stage(BNCB,WBNB),f.stage(WBNB,USDT,gross)],{minOut:gross-fee});
    assert.equal(router.decodeFunctionResult('swapExactInput',f.success(result))[0],gross-fee);
    assert.equal(await f.balance(USDT,recipient),gross-fee);
    assert.equal(await f.balance(USDT,feeReceiver),fee);
    assert.equal(await f.balance(BNCB,bncbPool),before+AMOUNT);
    assert.equal(await f.balance(BNCB,f.address),0n);
    assert.equal(await f.balance(BNCB,f.adapter),0n);
});

function expectRevert(result, signature) {
    assert.equal(result.execResult.exceptionError?.error,'revert');
    assert.equal(bytesToHex(result.execResult.returnValue),ethers.id(signature).slice(0,10));
}

test('native BNB to BNCB delivers directly and pays one native fee',async()=>{
    const f = await fixture();
    const received = price(AMOUNT-FEE);
    const beforeFee = await f.native(feeReceiver);
    const result = await f.trade([f.stage(ethers.ZeroAddress,BNCB,received)],{
        minOut:received,feeToken:ethers.ZeroAddress,value:AMOUNT,
    });
    assert.equal(router.decodeFunctionResult('swapExactInput',f.success(result))[0],received);
    assert.equal(await f.balance(BNCB,recipient),received);
    assert.equal(await f.balance(BNCB,f.address),0n);
    assert.equal(await f.native(feeReceiver),beforeFee+FEE);
});

test('BNCB to native BNB unwraps only current proceeds and deducts the realized fee',async()=>{
    const f = await fixture();
    const gross = price(AMOUNT);
    const fee = gross*30n/10000n;
    const beforeFee = await f.native(feeReceiver);
    const beforeRecipient = await f.native(recipient);
    const result = await f.trade([f.stage(BNCB,ethers.ZeroAddress,gross)],{
        minOut:gross-fee,feeToken:ethers.ZeroAddress,
    });
    assert.equal(router.decodeFunctionResult('swapExactInput',f.success(result))[0],gross-fee);
    assert.equal(await f.native(recipient),beforeRecipient+gross-fee);
    assert.equal(await f.native(feeReceiver),beforeFee+fee);
    assert.equal(await f.balance(BNCB,f.address),0n);
    assert.equal(await f.balance(BNCB,f.adapter),0n);
});

test('the live BNCB identity guard rejects unproven proxy code before accepting payment',async()=>{
    const f = await fixture({mockIdentity:false});
    const identity = await f.write(f.address,router,'bncbIdentityVerified',[]);
    assert.equal(router.decodeFunctionResult('bncbIdentityVerified',identity)[0],false);
    expectRevert(await f.trade([f.stage(USDT,BNCB)]),'BncbIdentityChanged()');
    assert.equal(await f.balance(USDT,payer),10n*AMOUNT);
    assert.equal(await f.balance(USDT,feeReceiver),0n);
});

test('BNCB stays outside the fee whitelist and general V3 asset policy',async()=>{
    const f = await fixture();
    for (const asset of [USDT,WBNB,BNCB,OTHER]) {
        const [feeToken] = router.decodeFunctionResult('isFeeToken',await f.write(f.address,router,'isFeeToken',[asset]));
        const [tradeToken] = router.decodeFunctionResult('isV3TradeToken',await f.write(f.address,router,'isV3TradeToken',[asset]));
        assert.equal(feeToken,[USDT,WBNB].includes(asset));
        assert.equal(tradeToken,asset===BNCB);
    }
});

test('BNCB V3 is constrained to its single endpoint stage and ordinary settlement routes remain available',async()=>{
    const f = await fixture();
    const split = f.stage(WBNB,BNCB);
    split.branches[0].weightBps = 5000;
    split.branches.push({...split.branches[0],v3Path:path(WBNB,BNCB,500)});
    for (const stages of [
        [f.stage(USDT,BNCB),f.stage(BNCB,WBNB)],
        [f.stage(USDT,WBNB),split],
        [f.stage(USDT,WBNB),f.stage(WBNB,OTHER)],
        [f.stage(USDT,WBNB),f.stage(WBNB,OTHER),f.stage(OTHER,BNCB)],
    ]) expectRevert(await f.trade(stages),'DirectRouteRequired()');
    expectRevert(await f.trade([f.stage(FIST,BNCB)],{feeToken:FIST}),'DirectRouteRequired()');
    assert.equal(await f.balance(USDT,feeReceiver),0n);
    f.success(await f.trade([f.stage(USDT,WBNB)]));
    assert.equal(await f.balance(USDT,feeReceiver),FEE);
});

test('V2 routes cannot use BNCB as an endpoint or hide it as an intermediate path token',async()=>{
    const f = await fixture();
    await f.write(f.address,router,'setAdapter',[f.adapter,0,true]);
    for (const p of [[USDT,BNCB],[BNCB,USDT],[USDT,BNCB,WBNB]]) {
        const stage = {tokenIn:p[0],tokenOut:p.at(-1),minOut:1n,
            branches:[{adapter:f.adapter,kind:0,weightBps:10000,path:p,v3Path:'0x'}]};
        expectRevert(await f.trade([stage],{configVersion:3n}),'DirectRouteRequired()');
    }
});

test('buy reverts on a BNCB pool output tax even when user minimum would have tolerated it',async()=>{
    const f = await fixture();
    await f.write(BNCB,token,'tax',[bncbPool,false]);
    const before = await f.balance(BNCB,bncbPool);
    expectRevert(await f.trade([f.stage(USDT,WBNB),f.stage(WBNB,BNCB)]),'TransferMismatch()');
    assert.equal(await f.balance(BNCB,bncbPool),before);
    assert.equal(await f.balance(BNCB,recipient),0n);
    assert.equal(await f.balance(USDT,feeReceiver),0n);
});

test('sell atomically rejects BNCB tax on payer, adapter or pool funding',async()=>{
    for (const [edge,signature] of [['address','TransferMismatch()'],['adapter','PartialInput()'],['pool','TransferMismatch()']]) {
        const f = await fixture();
        const taxed = edge==='pool'?bncbPool:f[edge];
        const before = await f.balance(BNCB,bncbPool);
        await f.write(BNCB,token,'tax',[taxed,true]);
        expectRevert(await f.trade([f.stage(BNCB,WBNB),f.stage(WBNB,USDT)]),signature);
        assert.equal(await f.balance(BNCB,payer),10n*AMOUNT);
        assert.equal(await f.balance(BNCB,bncbPool),before);
        assert.equal(await f.balance(USDT,recipient),0n);
    }
});

test('a stage floor, final minimum, expired deadline and stale configuration each revert the whole trade',async()=>{
    const f = await fixture();
    const expected = price(price(AMOUNT-FEE));
    for (const [stages,options,signature] of [
        [[f.stage(USDT,WBNB,AMOUNT),f.stage(WBNB,BNCB)],{},'BelowMinimum()'],
        [[f.stage(USDT,WBNB),f.stage(WBNB,BNCB)],{minOut:expected+1n},'BelowMinimum()'],
        [[f.stage(USDT,WBNB),f.stage(WBNB,BNCB)],{expires:TIMER-1n},'Expired()'],
        [[f.stage(USDT,WBNB),f.stage(WBNB,BNCB)],{configVersion:1n},'FeeConfigurationChanged()'],
    ]) expectRevert(await f.trade(stages,options),signature);
    assert.equal(await f.balance(BNCB,recipient),0n);
    assert.equal(await f.balance(USDT,feeReceiver),0n);
    assert.equal(await f.balance(USDT,payer),10n*AMOUNT);
});
