// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice PancakeSwap V2 adapter for BSC mainnet 56 (router
/// 0x10ED43C7…, the deep BNB/USDT liquidity). Same security model as the
/// testnet adapter.
contract PancakeAdapter56 {
    string public constant VERSION = "1.10"; // v10 构建（源自 FstSi 1.01，见 contracts/fstsi-v10/README）
    using SafeERC20 for IERC20;

    address public constant ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public immutable aggregator;

    error Unauthorized();
    error InputNotConsumed();

    constructor(address aggregator_) { aggregator = aggregator_; }

    modifier onlyAggregator() {
        if (msg.sender != aggregator) revert Unauthorized();
        _;
    }

    function router() external pure returns (address) { return ROUTER; }

    function weth() external view returns (address) {
        (bool ok, bytes memory ret) = ROUTER.staticcall(abi.encodeWithSignature("WETH()"));
        return ok ? abi.decode(ret, (address)) : address(0);
    }

    function getPair(address tokenA, address tokenB) external view returns (address) {
        (bool ok, bytes memory ret) = ROUTER.staticcall(abi.encodeWithSignature("factory()"));
        if (!ok) return address(0);
        address factory = abi.decode(ret, (address));
        (bool ok2, bytes memory ret2) = factory.staticcall(abi.encodeWithSignature("getPair(address,address)", tokenA, tokenB));
        return ok2 ? abi.decode(ret2, (address)) : address(0);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external onlyAggregator returns (uint256 received)
    {
        return swapExactTokensForTokens(msg.sender, amountIn, minOut, path, to, deadline);
    }

    function swapExactTokensForTokens(address payer, uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline)
        public onlyAggregator returns (uint256 received)
    {
        IERC20 inTok = IERC20(path[0]);
        uint256 beforePull = inTok.balanceOf(address(this));
        inTok.safeTransferFrom(payer, address(this), amountIn);
        uint256 actualIn = inTok.balanceOf(address(this)) - beforePull;
        inTok.forceApprove(ROUTER, actualIn);
        IERC20 out = IERC20(path[path.length - 1]);
        uint256 before = out.balanceOf(to);
        (bool ok,) = ROUTER.call(abi.encodeWithSignature(
            "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
            actualIn, minOut, path, to, deadline));
        require(ok, "PancakeAdapter: swap failed");
        inTok.forceApprove(ROUTER, 0);
        if (inTok.balanceOf(address(this)) != beforePull) revert InputNotConsumed();
        received = out.balanceOf(to) - before;
    }

    function swapExactTokensForEth(address payer, uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external onlyAggregator returns (uint256 received)
    {
        IERC20 inTok = IERC20(path[0]);
        uint256 beforePull = inTok.balanceOf(address(this));
        inTok.safeTransferFrom(payer, address(this), amountIn);
        uint256 actualIn = inTok.balanceOf(address(this)) - beforePull;
        inTok.forceApprove(ROUTER, actualIn);
        uint256 before = to.balance;
        (bool ok,) = ROUTER.call(abi.encodeWithSignature(
            "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
            actualIn, minOut, path, to, deadline));
        require(ok, "PancakeAdapter: swap failed");
        inTok.forceApprove(ROUTER, 0);
        if (inTok.balanceOf(address(this)) != beforePull) revert InputNotConsumed();
        received = to.balance - before;
    }

    function swapExactEthForTokens(uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external payable onlyAggregator returns (uint256 received)
    {
        IERC20 out = IERC20(path[path.length - 1]);
        uint256 before = out.balanceOf(to);
        (bool ok,) = ROUTER.call{value: msg.value}(abi.encodeWithSignature(
            "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)",
            minOut, path, to, deadline));
        require(ok, "PancakeAdapter: swap failed");
        received = out.balanceOf(to) - before;
    }

    receive() external payable {}
}
