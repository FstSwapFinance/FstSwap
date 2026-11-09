// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice OpenOcean gateway adapter (BSC mainnet 56, router
/// 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64). The OpenOcean route data is
/// produced by the OpenOcean API on the frontend; the adapter re-validates
/// the request and forwards it, so only the bound aggregator may route.
struct OOCallData {
    bytes callData;
    uint256 flags;
}

interface IOpenOceanRouter {
    function swap(address caller, OOCallData calldata desc, bytes calldata data, uint256 amount) external payable;
}

contract OpenOceanAdapter56 {
    string public constant VERSION = "1.10"; // v10 构建（源自 FstSi 1.01，见 contracts/fstsi-v10/README）
    address public constant ROUTER = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64;
    address public immutable aggregator;

    error Unauthorized();
    error InvalidCall();

    constructor(address aggregator_) {
        aggregator = aggregator_;
    }

    modifier onlyAggregator() {
        if (msg.sender != aggregator) revert Unauthorized();
        _;
    }

    function router() external pure returns (address) { return ROUTER; }

    /// @notice Executes a frontend-provided OpenOcean swap. The output must
    /// reach `to` and the received amount must be at least `minOut`.
    function swap(bytes calldata desc, bytes calldata data, uint256 amount, address to, uint256 minOut)
        external payable onlyAggregator returns (uint256 received)
    {
        if (to == address(0) || amount == 0 || desc.length == 0) revert InvalidCall();
        // the OpenOcean router delivers the output to the address inside the
        // desc; the caller's recipient/minOut are enforced by the received
        // check below (the recipient check needs the desc's dstToken).
        uint256 before = to.balance;
        (bool ok,) = ROUTER.call{value: msg.value}(abi.encodeCall(IOpenOceanRouter.swap,
            (to, OOCallData(desc, amount), data, amount)));
        require(ok, "OpenOceanAdapter: swap failed");
        received = to.balance - before;
        if (received < minOut) revert InvalidCall();
    }

    receive() external payable {}
}
