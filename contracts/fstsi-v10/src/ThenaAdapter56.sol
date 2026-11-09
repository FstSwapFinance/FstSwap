// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Thena RouterV2 adapter (BSC mainnet 56, Router
/// 0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109). Thena uses the Solidly
/// route-struct format; this adapter converts the aggregator's path into
/// (from, to, stable=false) routes and exposes the same IAggregatedAdapter
/// surface. Only the bound aggregator may call.
struct ThenaRoute {
    address from;
    address to;
    bool stable;
}

interface IThenaRouter {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, ThenaRoute[] calldata routes, address to, uint256 deadline) external;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, ThenaRoute[] calldata routes, address to, uint256 deadline) external;
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, ThenaRoute[] calldata routes, address to, uint256 deadline) external payable;
}

contract ThenaAdapter56 {
    string public constant VERSION = "1.10"; // v10 构建（源自 FstSi 1.01，见 contracts/fstsi-v10/README）
    using SafeERC20 for IERC20;

    address public constant ROUTER = 0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109;
    address public immutable aggregator;

    error Unauthorized();
    error InvalidPath();

    constructor(address aggregator_) {
        aggregator = aggregator_;
    }

    modifier onlyAggregator() {
        if (msg.sender != aggregator) revert Unauthorized();
        _;
    }

    function router() external pure returns (address) { return ROUTER; }

    function weth() external view returns (address) {
        (bool ok, bytes memory ret) = ROUTER.staticcall(abi.encodeWithSignature("wETH()"));
        return ok ? abi.decode(ret, (address)) : address(0);
    }

    function getPair(address tokenA, address tokenB) external view returns (address) {
        (bool ok, bytes memory ret) = ROUTER.staticcall(abi.encodeWithSignature("pairFor(address,address,bool)", tokenA, tokenB, false));
        return ok ? abi.decode(ret, (address)) : address(0);
    }

    /// @dev converts the aggregator's path into ThenaRoute[] (stable=false).
    function _routes(address[] calldata path) private pure returns (ThenaRoute[] memory routes) {
        routes = new ThenaRoute[](path.length - 1);
        for (uint256 i; i < path.length - 1; ++i) {
            routes[i] = ThenaRoute(path[i], path[i + 1], false);
        }
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
        (bool ok,) = ROUTER.call(abi.encodeCall(IThenaRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens,
            (actualIn, minOut, _routes(path), to, deadline)));
        require(ok, "ThenaAdapter: swap failed");
        inTok.forceApprove(ROUTER, 0); // the approval is fully consumed/cleared
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
        (bool ok,) = ROUTER.call(abi.encodeCall(IThenaRouter.swapExactTokensForETHSupportingFeeOnTransferTokens,
            (actualIn, minOut, _routes(path), to, deadline)));
        require(ok, "ThenaAdapter: swap failed");
        inTok.forceApprove(ROUTER, 0); // the approval is fully consumed/cleared
        received = to.balance - before;
    }

    function swapExactEthForTokens(uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external payable onlyAggregator returns (uint256 received)
    {
        IERC20 out = IERC20(path[path.length - 1]);
        uint256 before = out.balanceOf(to);
        (bool ok,) = ROUTER.call{value: msg.value}(abi.encodeCall(IThenaRouter.swapExactETHForTokensSupportingFeeOnTransferTokens,
            (minOut, _routes(path), to, deadline)));
        require(ok, "ThenaAdapter: swap failed");
        received = out.balanceOf(to) - before;
    }

    receive() external payable {}
}
