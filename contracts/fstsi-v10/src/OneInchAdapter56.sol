// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice 1inch V5 gateway adapter (BSC mainnet 56, router
/// 0x1111111254EEB25477B68fb85Ed929f73A960582). The 1inch route (the
/// executor call data) is produced by the 1inch API and passed through here;
/// the adapter re-validates the SwapDescription against the caller's request
/// before forwarding, so only the bound aggregator can route through 1inch.
contract OneInchAdapter56 {
    string public constant VERSION = "1.10"; // v10 构建（源自 FstSi 1.01，见 contracts/fstsi-v10/README）
    address public constant ROUTER = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address public immutable aggregator;
    address public immutable weth;

    error Unauthorized();
    error InvalidDescription();

    constructor(address aggregator_, address weth_) {
        aggregator = aggregator_;
        weth = weth_;
    }

    modifier onlyAggregator() {
        if (msg.sender != aggregator) revert Unauthorized();
        _;
    }

    function router() external pure returns (address) { return ROUTER; }
    function wethToken() external view returns (address) { return weth; }

    /// @dev ABI mirror of the 1inch SwapDescription (12 fields).
    struct SwapDescription {
        address srcToken;
        address dstToken;
        address srcReceiver;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        bytes permit;
    }

    /// @notice Executes a frontend-provided 1inch swap. The description is
    /// re-checked: the output token must reach `to` and the minimum return
    /// must be at least `minOut`. The input token comes from the aggregator
    /// (buy: the native BNB; sell: the project token already pulled).
    function swap(address executor, SwapDescription calldata desc, bytes calldata permit, bytes calldata data, address to, uint256 minOut)
        external payable onlyAggregator returns (uint256 received)
    {
        if (desc.dstToken == address(0) || desc.dstReceiver != to || desc.minReturnAmount < minOut
            || desc.amount == 0 || executor.code.length == 0) revert InvalidDescription();
        IERC20 out = IERC20(desc.dstToken);
        uint256 before = out.balanceOf(to);
        (bool ok,) = ROUTER.call{value: msg.value}(abi.encodeWithSignature(
            "swap(address,(address,address,address,address,uint256,uint256,uint256,bytes),bytes,bytes)",
            executor, desc, permit, data));
        require(ok, "OneInchAdapter: swap failed");
        received = out.balanceOf(to) - before;
    }

    receive() external payable {}
}
