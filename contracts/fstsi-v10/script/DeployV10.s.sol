// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {AggregatedRouterV10} from "../src/AggregatedRouterV10.sol";
import {FstSwapAdapter56} from "../src/FstSwapAdapter56.sol";
import {PancakeAdapter56} from "../src/PancakeAdapter56.sol";
import {BiSwapAdapter56} from "../src/BiSwapAdapter56.sol";
import {PancakeV3Adapter} from "../src/PancakeV3Adapter.sol";

/// @notice Reproducible local fork deployment; mainnet signing stays in the user's wallet.
/// Defaults are the user-confirmed 2026-11-10 owner and receiver; 30 bps, default USDT.
/// Only validated FstSwap V2, Pancake V2/V3 and BiSwap are included.
/// When owner differs from the broadcaster, owner registers adapters in separate transactions.
contract DeployV10 is Script {
    address constant FST_WBNB = 0x0efb5FD2402A0967B92551d6AF54De148504A115; // FstSwap 自有 WBNB（与 v9 一致）
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address constant PCS_V3_QUOTER = 0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997;

    function run() external {
        address owner = vm.envOr("OWNER", address(0x3D91889209f9ca69b7Cb73D7a8C463f4deFB5c15));
        address feeReceiver = vm.envOr("FEE_RECEIVER", address(0x66f2B90E9fAEf07E5931A3483882804B78f92Ae9));
        uint256 configuredBps = vm.envOr("FEE_BPS", uint256(30));
        require(block.chainid == 56 && configuredBps <= 100 && owner != address(0) && feeReceiver != address(0), "invalid deployment config");
        uint16 feeBps = uint16(configuredBps);

        vm.startBroadcast();
        address deployer = msg.sender;
        bool register = owner == deployer;
        AggregatedRouterV10 router = new AggregatedRouterV10(FST_WBNB, feeReceiver, feeBps, owner);
        address fst = address(new FstSwapAdapter56(address(router)));
        address pcs = address(new PancakeAdapter56(address(router)));
        address bis = address(new BiSwapAdapter56(address(router)));
        address v3 = address(new PancakeV3Adapter(address(router), WBNB, PCS_V3_QUOTER));
        if (register) {
            router.setAdapter(fst, true);
            router.setAdapter(pcs, true);
            router.setAdapter(bis, true);
            router.setAdapter(v3, true);
        }
        vm.stopBroadcast();

        console2.log("router", address(router));
        console2.log("fst", fst);
        console2.log("pancake", pcs);
        console2.log("biswap", bis);
        console2.log("v3", v3);
        console2.log("registered", register);
    }
}
