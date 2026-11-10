// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev kind: 0 V2 path; 1 single-pool V3 path; 2 native BNB/canonical WBNB wrap.
struct Branch { address adapter; uint8 kind; uint16 weightBps; address[] path; bytes v3Path; }
struct Stage { address tokenIn; address tokenOut; uint256 minOut; Branch[] branches; }
struct SwapParams {
    address tokenIn; address tokenOut; uint256 amountIn; uint256 minOut;
    address recipient; uint256 deadline; address feeToken; uint256 configVersion;
}
interface IFstAdapter {
    function aggregator() external view returns(address);
    function router() external view returns(address);
    function weth() external view returns(address);
    function quoter() external view returns(address);
    function swapExactTokensForTokens(address,uint256,uint256,address[] calldata,address,uint256) external returns(uint256);
    function swapExactTokensForEth(address,uint256,uint256,address[] calldata,address,uint256) external returns(uint256);
    function swapExactEthForTokens(uint256,address[] calldata,address,uint256) external payable returns(uint256);
    function executeTokenToToken(address,bytes calldata,uint256,uint256,address,uint256) external returns(uint256);
    function executeBuy(bytes calldata,uint256,address,uint256) external payable returns(uint256);
    function executeSell(address,bytes calldata,uint256,uint256,address,uint256) external returns(uint256);
}
interface IFstFactoryProvider { function factory() external view returns(address); function deployer() external view returns(address); function WETH9() external view returns(address); }
interface IFstFactory {
    function getPair(address,address) external view returns(address);
    function getPool(address,address,uint24) external view returns(address);
}
interface IFstPair {
    function token0() external view returns(address);
    function token1() external view returns(address);
    function getReserves() external view returns(uint112,uint112,uint32);
    function totalSupply() external view returns(uint256);
}
interface IFstWrapped { function deposit() external payable; function withdraw(uint256) external; }
interface IFstV2Quote { function getAmountsOut(uint256,address[] calldata) external view returns(uint256[] memory); }

/// @title FstSwap
/// @notice Exact-input BSC aggregator. One fee on the actual main-route amount.
/// Input fee assets take priority over output assets; other/other routes must
/// pass their whole budget through the configured fee asset. No separate fee swap.
contract FstSwap {
    using SafeERC20 for IERC20;
    string public constant VERSION="2.0.0";
    uint256 private constant BPS=10000;
    address public constant FIST=0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A;
    address public constant USDT=0x55d398326f99059fF775485246999027B3197955;
    address public constant WBNB=0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public constant ETH=0x2170Ed0880ac9A755fd29B2688956BD959F933F8;
    address public constant USDC=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    address public owner;
    address public pendingOwner;
    address public feeReceiver;
    uint16 public platformFeeBps;
    address public defaultFeeToken=USDT;
    uint256 public feeConfigVersion=1;
    struct AdapterInfo { bool enabled; uint8 kind; address factory; address wrapped; }
    mapping(address=>AdapterInfo) public adapterInfo;
    uint256 private locked;

    error Unauthorized(); error InvalidPath(); error NoRoute(); error Expired();
    error BelowMinimum(); error FeeRouteRequired(); error FeeConfigurationChanged();
    error InputNotConsumed(); error TransferMismatch(); error Reentrancy();
    event SwapExecuted(address indexed user,address indexed tokenIn,address indexed tokenOut,uint256 amountIn,uint256 amountOut,uint256 fee);
    event PlatformFeePaid(address indexed payer,address indexed token,uint256 amount);
    event FeeCharged(address indexed payer,address indexed token,uint256 baseAmount,uint256 amount,uint256 stage);
    event StageExecuted(uint256 indexed stage,address indexed tokenIn,address indexed tokenOut,uint256 amountIn,uint256 amountOut);
    event AdapterSet(address indexed adapter,uint8 kind,bool enabled,uint256 configVersion);
    event FeeSet(address indexed receiver,uint16 bps,uint256 configVersion);
    event DefaultFeeTokenSet(address indexed token,uint256 configVersion);
    event OwnershipTransferStarted(address indexed owner,address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner,address indexed newOwner);
    event Swept(address indexed token,address indexed to,uint256 amount);

    constructor(address receiver,uint16 bps,address owner_) {
        if(receiver==address(0)||receiver==address(this)||owner_==address(0)||bps>100) revert InvalidPath();
        feeReceiver=receiver; platformFeeBps=bps; owner=owner_;
    }
    modifier onlyOwner() { if(msg.sender!=owner) revert Unauthorized(); _; }
    modifier nonReentrant() { if(locked!=0) revert Reentrancy(); locked=1; _; locked=0; }
    function isFeeToken(address t) public pure returns(bool) { return t==address(0)||t==FIST||t==USDT||t==WBNB||t==ETH||t==USDC; }
    /// @return mode 0 input; 1 final output; 2 intermediate main-route asset.
    function feePolicy(address input,address output) public view returns(uint8 mode,address token) {
        if(isFeeToken(input)) return(0,input);
        if(isFeeToken(output)) return(1,output);
        return(2,defaultFeeToken);
    }
    function adapters(address a) external view returns(bool) { return adapterInfo[a].enabled; }
    function setFee(address receiver,uint16 bps) external onlyOwner nonReentrant {
        if(receiver==address(0)||receiver==address(this)||bps>100) revert InvalidPath();
        feeReceiver=receiver; platformFeeBps=bps; emit FeeSet(receiver,bps,++feeConfigVersion);
    }
    function setDefaultFeeToken(address token) external onlyOwner nonReentrant {
        if(!isFeeToken(token)) revert InvalidPath(); defaultFeeToken=token;
        emit DefaultFeeTokenSet(token,++feeConfigVersion);
    }
    function setAdapter(address a,uint8 kind,bool enabled) external onlyOwner nonReentrant {
        if(enabled) {
            if(a.code.length==0||kind>1||IFstAdapter(a).aggregator()!=address(this)) revert InvalidPath();
            address dex=IFstAdapter(a).router(); address wrapped=IFstAdapter(a).weth();
            if(dex.code.length==0||wrapped.code.length==0) revert InvalidPath();
            address factory=IFstFactoryProvider(kind==0?dex:IFstAdapter(a).quoter()).factory();
            if(factory.code.length==0) revert InvalidPath();
            if(kind==1) {
                IFstFactoryProvider quote=IFstFactoryProvider(IFstAdapter(a).quoter());
                IFstFactoryProvider execution=IFstFactoryProvider(dex);
                if(execution.factory()!=factory||execution.deployer()!=quote.deployer()||execution.WETH9()!=quote.WETH9()||execution.WETH9()!=wrapped) revert InvalidPath();
            }
            adapterInfo[a]=AdapterInfo(true,kind,factory,wrapped);
        } else delete adapterInfo[a];
        emit AdapterSet(a,kind,enabled,++feeConfigVersion);
    }
    function transferOwnership(address next) external onlyOwner { if(next==address(0)||next==address(this)) revert InvalidPath(); pendingOwner=next; emit OwnershipTransferStarted(owner,next); }
    function acceptOwnership() external { if(msg.sender!=pendingOwner) revert Unauthorized(); emit OwnershipTransferred(owner,msg.sender); owner=msg.sender; pendingOwner=address(0); }
    function sweep(address token,address to) external onlyOwner nonReentrant {
        if(to==address(0)||to==address(this)) revert InvalidPath(); uint256 amount=_balance(token,address(this));
        if(amount!=0) _send(token,to,amount); emit Swept(token,to,amount);
    }

    function swapExactInput(SwapParams calldata p,Stage[] calldata stages) external payable nonReentrant returns(uint256 received) {
        if(block.timestamp>p.deadline) revert Expired();
        if(p.configVersion!=feeConfigVersion) revert FeeConfigurationChanged();
        if(p.amountIn==0||p.minOut==0||p.recipient==address(0)||p.recipient==address(this)||p.tokenIn==p.tokenOut) revert InvalidPath();
        (uint8 mode,address token)=feePolicy(p.tokenIn,p.tokenOut);
        if(p.feeToken!=token) revert FeeConfigurationChanged();
        uint256 feeStage=_validate(p,stages,mode,token);
        uint256 amount;
        if(p.tokenIn==address(0)) { if(msg.value!=p.amountIn) revert InvalidPath(); amount=msg.value; }
        else {
            if(msg.value!=0) revert InvalidPath();
            uint256 before=_balance(p.tokenIn,address(this)); uint256 payerBefore=_balance(p.tokenIn,msg.sender);
            IERC20(p.tokenIn).safeTransferFrom(msg.sender,address(this),p.amountIn);
            amount=_balance(p.tokenIn,address(this))-before;
            if(amount==0||amount>p.amountIn||_balance(p.tokenIn,msg.sender)!=payerBefore-p.amountIn) revert TransferMismatch();
        }
        uint256 fee;
        if(mode==0) { fee=_takeFee(token,amount,0); amount-=fee; }
        for(uint256 i;i<stages.length;i++) {
            amount=_executeStage(stages[i],amount,p.deadline,i);
            if(mode!=0&&i+1==feeStage) { fee=_takeFee(token,amount,feeStage); amount-=fee; }
        }
        uint256 recipientBefore=_balance(p.tokenOut,p.recipient);
        _send(p.tokenOut,p.recipient,amount);
        received=_balance(p.tokenOut,p.recipient)-recipientBefore;
        if(received<p.minOut) revert BelowMinimum();
        emit SwapExecuted(msg.sender,p.tokenIn,p.tokenOut,p.amountIn,received,fee);
    }
    function _takeFee(address token,uint256 base,uint256 stageIndex) private returns(uint256 fee) {
        fee=Math.mulDiv(base,platformFeeBps,BPS);
        if(fee!=0) {
            uint256 before=_balance(token,feeReceiver); _send(token,feeReceiver,fee);
            // Fee assets must settle the actual 0.3%; no silently taxed fee transfer.
            if(_balance(token,feeReceiver)-before!=fee) revert TransferMismatch();
        }
        emit PlatformFeePaid(msg.sender,token,fee); emit FeeCharged(msg.sender,token,base,fee,stageIndex);
    }
    function _executeStage(Stage calldata s,uint256 budget,uint256 deadline,uint256 index) private returns(uint256 output) {
        if(budget==0) revert InvalidPath();
        uint256 beforeIn=_balance(s.tokenIn,address(this)); uint256 beforeOut=_balance(s.tokenOut,address(this)); uint256 allocated;
        for(uint256 i;i<s.branches.length;i++) {
            Branch calldata b=s.branches[i];
            uint256 amount=i+1==s.branches.length?budget-allocated:Math.mulDiv(budget,b.weightBps,BPS);
            allocated+=amount; if(amount==0) continue;
            if(b.kind==2) {
                if(s.tokenIn==address(0)) IFstWrapped(WBNB).deposit{value:amount}(); else IFstWrapped(WBNB).withdraw(amount);
            } else {
                if(s.tokenIn!=address(0)) IERC20(s.tokenIn).forceApprove(b.adapter,amount);
                IFstAdapter ad=IFstAdapter(b.adapter);
                if(b.kind==0) {
                    if(s.tokenIn==address(0)) ad.swapExactEthForTokens{value:amount}(0,b.path,address(this),deadline);
                    else if(s.tokenOut==address(0)) ad.swapExactTokensForEth(address(this),amount,0,b.path,address(this),deadline);
                    else ad.swapExactTokensForTokens(address(this),amount,0,b.path,address(this),deadline);
                } else {
                    if(s.tokenIn==address(0)) ad.executeBuy{value:amount}(b.v3Path,0,address(this),deadline);
                    else if(s.tokenOut==address(0)) ad.executeSell(address(this),b.v3Path,amount,0,address(this),deadline);
                    else ad.executeTokenToToken(address(this),b.v3Path,amount,0,address(this),deadline);
                }
                if(s.tokenIn!=address(0)) IERC20(s.tokenIn).forceApprove(b.adapter,0);
            }
        }
        if(_balance(s.tokenIn,address(this))!=beforeIn-budget) revert InputNotConsumed();
        output=_balance(s.tokenOut,address(this))-beforeOut;
        if(output<s.minOut) revert BelowMinimum();
        emit StageExecuted(index,s.tokenIn,s.tokenOut,budget,output);
    }
    function _validate(SwapParams calldata p,Stage[] calldata stages,uint8 mode,address token) private view returns(uint256 feeStage) {
        uint256 length=stages.length;
        if(length==0||length>6||stages[0].tokenIn!=p.tokenIn||stages[length-1].tokenOut!=p.tokenOut) revert InvalidPath();
        address[] memory pools=new address[](54); uint256 count;
        for(uint256 i;i<length;i++) {
            Stage calldata s=stages[i];
            if(s.tokenIn==s.tokenOut||s.minOut==0||s.branches.length==0||s.branches.length>3||(i>0&&stages[i-1].tokenOut!=s.tokenIn)) revert InvalidPath();
            uint256 weights;
            for(uint256 j;j<s.branches.length;j++) {
                Branch calldata b=s.branches[j]; weights+=b.weightBps;
                if(b.weightBps==0) revert InvalidPath();
                if(b.kind==2) {
                    if(s.branches.length!=1||b.adapter!=address(0)||b.path.length!=0||b.v3Path.length!=0||!((s.tokenIn==address(0)&&s.tokenOut==WBNB)||(s.tokenIn==WBNB&&s.tokenOut==address(0)))) revert InvalidPath();
                    continue;
                }
                AdapterInfo memory info=adapterInfo[b.adapter];
                if(!info.enabled||info.kind!=b.kind) revert NoRoute();
                address input=s.tokenIn==address(0)?info.wrapped:s.tokenIn;
                address output=s.tokenOut==address(0)?info.wrapped:s.tokenOut;
                if(b.kind==0) {
                    if(b.path.length<2||b.path.length>4||b.v3Path.length!=0||b.path[0]!=input||b.path[b.path.length-1]!=output) revert InvalidPath();
                    for(uint256 k;k<b.path.length;k++) {
                        if(b.path[k]==address(0)) revert InvalidPath();
                        for(uint256 n;n<k;n++) if(b.path[k]==b.path[n]) revert InvalidPath();
                        if(k>0) count=_rememberPool(IFstFactory(info.factory).getPair(b.path[k-1],b.path[k]),pools,count);
                    }
                } else {
                    bytes calldata path=b.v3Path;
                    if(path.length!=43||b.path.length!=0) revert InvalidPath();
                    uint24 tier=uint24(bytes3(path[20:23]));
                    if(address(bytes20(path[:20]))!=input||address(bytes20(path[23:43]))!=output||input==output||!(tier==100||tier==500||tier==2500||tier==10000)) revert InvalidPath();
                    count=_rememberPool(IFstFactory(info.factory).getPool(input,output,tier),pools,count);
                }
            }
            if(weights!=BPS) revert InvalidPath();
            if(mode==2&&s.tokenOut==token) { if(feeStage!=0||i+1==length) revert InvalidPath(); feeStage=i+1; }
        }
        if(mode==1) return length;
        if(mode==2&&feeStage==0) revert FeeRouteRequired();
    }
    function _rememberPool(address pool,address[] memory seen,uint256 count) private view returns(uint256) {
        if(pool.code.length==0) revert NoRoute();
        for(uint256 i;i<count;i++) if(seen[i]==pool) revert InvalidPath(); seen[count]=pool; return count+1;
    }
    function _balance(address token,address account) private view returns(uint256) { return token==address(0)?account.balance:IERC20(token).balanceOf(account); }
    function _send(address token,address to,uint256 amount) private {
        uint256 before=_balance(token,address(this));
        if(token==address(0)) { (bool ok,)=payable(to).call{value:amount}(""); if(!ok) revert TransferMismatch(); }
        else IERC20(token).safeTransfer(to,amount);
        if(_balance(token,address(this))!=before-amount) revert TransferMismatch();
    }
    function getAmountsOutVia(address adapter,uint256 amount,address[] calldata path) external view returns(uint256[] memory) {
        if(!adapterInfo[adapter].enabled||adapterInfo[adapter].kind!=0) revert NoRoute();
        return IFstV2Quote(IFstAdapter(adapter).router()).getAmountsOut(amount,path);
    }
    function getPairInfo(address adapter,address tokenA,address tokenB,address account) external view returns(address pair,address token0,address token1,uint256 reserve0,uint256 reserve1,uint256 supply,uint256 balance) {
        AdapterInfo memory info=adapterInfo[adapter]; if(!info.enabled||info.kind!=0) revert NoRoute();
        pair=IFstFactory(info.factory).getPair(tokenA,tokenB); if(pair==address(0)) return(pair,address(0),address(0),0,0,0,0);
        token0=IFstPair(pair).token0(); token1=IFstPair(pair).token1();
        (reserve0,reserve1,)=IFstPair(pair).getReserves(); supply=IFstPair(pair).totalSupply(); if(account!=address(0)) balance=IERC20(pair).balanceOf(account);
    }
    receive() external payable {}
}
