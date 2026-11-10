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
    function exactInputSingle(V3ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
}

interface IPancakeV3Quoter {
    function quoteExactInputSingle(V3QuoteParams calldata params) external payable returns (uint256 amountOut);
}

contract PancakeV3Adapter {
    string public constant VERSION = "1.10"; // v10 构建（源自 FstSi 1.01，见 contracts/fstsi-v10/README）
    using SafeERC20 for IERC20;

    address public immutable quoter;
    address public constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address public immutable aggregator;
    address public immutable weth;

    error Unauthorized();
    error InvalidPath();
    error NoQuote();
    error PartialInput();

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
        (bool ok,) = ROUTER.call{value: msg.value}(abi.encodeCall(IPancakeV3Router.exactInputSingle,
            (V3ExactInputSingleParams(tokenIn, tokenOut, fee, to, deadline, msg.value, minOut, 0))));
        require(ok, "PancakeV3: swap failed");
        if (ROUTER.balance != nativeBefore) revert PartialInput();
        received = out.balanceOf(to) - before;
    }

    /// @notice Sell: the project tokens go from the payer straight into the
    /// pool; the WBNB output lands here and is unwrapped to the aggregator.
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
        (bool ok,) = ROUTER.call(abi.encodeCall(IPancakeV3Router.exactInputSingle,
            (V3ExactInputSingleParams(tokenIn, tokenOut, fee, address(this), deadline, actualIn, minOut, 0))));
        require(ok, "PancakeV3: swap failed");
        IERC20(tokenIn).forceApprove(ROUTER, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != beforePull) revert PartialInput();
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
        (bool ok,) = ROUTER.call(abi.encodeCall(IPancakeV3Router.exactInputSingle,
            (V3ExactInputSingleParams(tokenIn, tokenOut, fee, to, deadline, actualIn, minOut, 0))));
        require(ok, "PancakeV3: swap failed");
        IERC20(tokenIn).forceApprove(ROUTER, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != beforePull) revert PartialInput();
        received = out.balanceOf(to) - before;
    }

    receive() external payable {}
}
