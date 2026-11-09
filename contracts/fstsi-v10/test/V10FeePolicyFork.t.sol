// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {V10ForkTest} from "./V10Fork.t.sol";

contract V10FeePolicyForkTest is V10ForkTest {
    function test_feePolicy_FistToBnb_chargesOnlyFist() public {
        uint256 tokenFeeBefore = IERC20(FIST).balanceOf(FEE);
        uint256 nativeFeeBefore = FEE.balance;
        vm.prank(user);
        uint256 out = router.swapTokenToBnb(_leg(fst, _p2(FIST, FST_WBNB)), _none(), 2e6, 1, _dl(), recipient);
        assertEq(IERC20(FIST).balanceOf(FEE) - tokenFeeBefore, 2e6 * 30 / 10_000, "FIST input must pay FIST fee");
        assertEq(FEE.balance, nativeFeeBefore, "no second BNB fee");
        assertEq(recipient.balance, out, "all BNB output goes to recipient");
    }
}
