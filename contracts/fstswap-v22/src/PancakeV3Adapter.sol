// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice PancakeSwap V3 adapter (BSC 56/97, SwapRouter
/// 0x1b81D678ffb9C0263b24A97847620C99d213eB14 — the same address serves both
/// chains). Encapsulates the V3 exactInput format; the path is encoded as
/// tokenIn || fee24 || tokenOut (single-hop). Only the bound aggregator may
/// call; the received amounts are measured from the recipient's balance.
struct V3QuoteParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint24 fee;
    uint160 sqrtPriceLimitX96;
}

struct V3ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

interface IPancakeV3Router {
    function factory() external view returns(address);
    function exactInputSingle(V3ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
}

interface IPancakeV3Quoter {
    function quoteExactInputSingle(V3QuoteParams calldata params) external payable returns (uint256 amountOut);
}

interface IPancakeV3Factory {
    function getPool(address tokenIn,address tokenOut,uint24 fee) external view returns(address);
}

contract PancakeV3Adapter {
    string public constant VERSION = "1.11";
    using SafeERC20 for IERC20;

    address public immutable quoter;
    address public constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address public immutable aggregator;
    address public immutable weth;
    address private constant BNCB = 0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f;

    error Unauthorized();
    error InvalidPath();
    error NoQuote();
    error PartialInput();
    error TransferMismatch();

    constructor(address aggregator_, address weth_, address quoter_) {
        if (quoter_.code.length == 0) revert NoQuote();
        aggregator = aggregator_;
        weth = weth_;
        quoter = quoter_;
    }

    modifier onlyAggregator() {
        if (msg.sender != aggregator) revert Unauthorized();
        _;
    }

    function router() external pure returns (address) { return ROUTER; }
    function wethToken() external view returns (address) { return weth; }
    function supportsExactBNCB() external pure returns(bool) { return true; }

    function _bncbPool(address tokenIn,address tokenOut,uint24 fee) private view returns(address pool,uint256 balance) {
        if(tokenIn!=BNCB&&tokenOut!=BNCB) return(address(0),0);
        address factory=IPancakeV3Router(ROUTER).factory();
        pool=IPancakeV3Factory(factory).getPool(tokenIn,tokenOut,fee);
        if(pool.code.length==0) revert InvalidPath();
        balance=IERC20(BNCB).balanceOf(pool);
    }

    function _checkBncbTransfer(address tokenIn,address tokenOut,address pool,uint256 prior,uint256 spent,uint256 received,bytes memory ret) private view {
        if(pool==address(0)) return;
        uint256 balance=IERC20(BNCB).balanceOf(pool);
        if(tokenIn==BNCB&&balance!=prior+spent) revert TransferMismatch();
        if(tokenOut==BNCB) {
            // Pancake reports the exact swap output. Both the pool debit and the
            // recipient credit must equal that amount for this verified token.
            if(ret.length!=32) revert TransferMismatch();
            uint256 actualOut=abi.decode(ret,(uint256));
            if(actualOut!=received||prior<actualOut||balance!=prior-actualOut) revert TransferMismatch();
        }
    }

    /// @dev decodes a single-hop path into (tokenIn, tokenOut) and verifies
    /// the fee tier is one of the standard Pancake tiers.
    function decodePath(bytes calldata path) public pure returns (address tokenIn, address tokenOut, uint24 fee) {
        if (path.length != 43) revert InvalidPath(); // 20 + 3 + 20
        tokenIn = address(bytes20(path[0:20]));
        fee = uint24(bytes3(path[20:23]));
        tokenOut = address(bytes20(path[23:43]));
        if (fee != 100 && fee != 500 && fee != 2500 && fee != 10000) revert InvalidPath();
        if (tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut) revert InvalidPath();
    }

    /// @notice V3 quote via the on-chain QuoterV2 (the non-view pool.swap
    /// simulation). This function is itself NON-view: the RPC eth_call runs
    /// the full simulation without broadcasting, and a static context would
    /// revert inside the quoter.
    function quoteExactIn(bytes calldata path, uint256 amountIn) external returns (uint256 amountOut) {
        (address tokenIn, address tokenOut, uint24 fee) = decodePath(path);
        (bool ok, bytes memory ret) = quoter.call(
            abi.encodeCall(IPancakeV3Quoter.quoteExactInputSingle, (V3QuoteParams(tokenIn, tokenOut, amountIn, fee, 0)))
        );
        if (!ok || ret.length < 32) revert NoQuote();
        amountOut = abi.decode(ret, (uint256));
        if (amountOut == 0) revert NoQuote();
    }

    /// @notice Buy with the native BNB: exactInputSingle with the WETH input
    /// then unwraps nothing (the token goes straight to the recipient).
    function executeBuy(bytes calldata path, uint256 minOut, address to, uint256 deadline)
        external payable onlyAggregator returns (uint256 received)
    {
        (address tokenIn, address tokenOut, uint24 fee) = decodePath(path);
        if (tokenIn != weth) revert InvalidPath();
        IERC20 out = IERC20(tokenOut);
        uint256 before = out.balanceOf(to);
        uint256 nativeBefore = ROUTER.balance;
        (address pool,uint256 poolBefore)=_bncbPool(tokenIn,tokenOut,fee);
        (bool ok,bytes memory ret) = ROUTER.call{value: msg.value}(abi.encodeCall(IPancakeV3Router.exactInputSingle,
            (V3ExactInputSingleParams(tokenIn, tokenOut, fee, to, deadline, msg.value, minOut, 0))));
        require(ok, "PancakeV3: swap failed");
        if (ROUTER.balance != nativeBefore) revert PartialInput();
        received = out.balanceOf(to) - before;
        _checkBncbTransfer(tokenIn,tokenOut,pool,poolBefore,msg.value,received,ret);
    }

    /// @notice Pull the exact input and unwrap only this swap's WBNB output.
    function executeSell(address payer, bytes calldata path, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external onlyAggregator returns (uint256 received)
    {
        (address tokenIn, address tokenOut, uint24 fee) = decodePath(path);
        if (tokenOut != weth) revert InvalidPath();
        uint256 beforePull = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(payer, address(this), amountIn);
        uint256 actualIn = IERC20(tokenIn).balanceOf(address(this)) - beforePull;
        if (actualIn != amountIn) revert PartialInput();
        IERC20(tokenIn).forceApprove(ROUTER, actualIn);
        uint256 wbnbBefore = IERC20(weth).balanceOf(address(this));
        uint256 before = to.balance;
        (address pool,uint256 poolBefore)=_bncbPool(tokenIn,tokenOut,fee);
        (bool ok,bytes memory ret) = ROUTER.call(abi.encodeCall(IPancakeV3Router.exactInputSingle,
            (V3ExactInputSingleParams(tokenIn, tokenOut, fee, address(this), deadline, actualIn, minOut, 0))));
        require(ok, "PancakeV3: swap failed");
        IERC20(tokenIn).forceApprove(ROUTER, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != beforePull) revert PartialInput();
        _checkBncbTransfer(tokenIn,tokenOut,pool,poolBefore,actualIn,0,ret);
        // only THIS swap's WBNB output is unwrapped: a leftover from any
        // prior call stays untouched and is never credited to this seller
        uint256 wbnbReceived = IERC20(weth).balanceOf(address(this)) - wbnbBefore;
        if (wbnbReceived != 0) {
            (bool withdrawn,) = weth.call(abi.encodeWithSignature("withdraw(uint256)", wbnbReceived));
            require(withdrawn, "PancakeV3: withdraw failed");
            (bool sent,) = payable(to).call{value: wbnbReceived}("");
            require(sent, "PancakeV3: refund failed");
        }
        received = to.balance - before;
    }

    /// @notice v10 新增：任意 ERC20 → ERC20 单池兑换（tokenIn、tokenOut 均非原生币），
    /// 由聚合路由调用；从 payer 拉取 amountIn（按余额差计实收），产出直接交付 to。
    function executeTokenToToken(address payer, bytes calldata path, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external onlyAggregator returns (uint256 received)
    {
        (address tokenIn, address tokenOut, uint24 fee) = decodePath(path);
        uint256 beforePull = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(payer, address(this), amountIn);
        uint256 actualIn = IERC20(tokenIn).balanceOf(address(this)) - beforePull;
        if (actualIn != amountIn) revert PartialInput();
        IERC20(tokenIn).forceApprove(ROUTER, actualIn);
        IERC20 out = IERC20(tokenOut);
        uint256 before = out.balanceOf(to);
        (address pool,uint256 poolBefore)=_bncbPool(tokenIn,tokenOut,fee);
        (bool ok,bytes memory ret) = ROUTER.call(abi.encodeCall(IPancakeV3Router.exactInputSingle,
            (V3ExactInputSingleParams(tokenIn, tokenOut, fee, to, deadline, actualIn, minOut, 0))));
        require(ok, "PancakeV3: swap failed");
        IERC20(tokenIn).forceApprove(ROUTER, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != beforePull) revert PartialInput();
        received = out.balanceOf(to) - before;
        _checkBncbTransfer(tokenIn,tokenOut,pool,poolBefore,actualIn,received,ret);
    }

    receive() external payable {}
}
