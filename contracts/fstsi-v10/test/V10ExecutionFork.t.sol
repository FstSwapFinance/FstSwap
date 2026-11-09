// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {V10ForkTest} from "./V10Fork.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeConversion} from "../src/AggregatedRouterV10.sol";
contract V10ExecutionForkTest is V10ForkTest {
    address constant BTCB=0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c;
    function test_biswap_realBuyAndSell() public {
        uint256 feeBefore=IERC20(USDT).balanceOf(FEE);
        vm.prank(user);
        uint256 out=router.swapTokenToBnb(_leg(bis,_p2(USDT,WBNB)),_none(),10 ether,1,_dl(),recipient);
        assertGt(out,0);assertEq(recipient.balance,out);assertEq(IERC20(USDT).balanceOf(FEE)-feeBefore,0.03 ether);
        vm.prank(user);
        uint256 bought=router.swapBnbToToken{value:0.01 ether}(_leg(bis,_p2(WBNB,USDT)),_none(),1,_dl(),recipient);
        assertGt(bought,0);assertEq(IERC20(USDT).balanceOf(recipient),bought);
        assertEq(IERC20(USDT).allowance(bis,IA(bis).router()),0);
    }
    function test_otherToOther_crossDexAndRealFeeSwap() public {
        uint256 amount=0.01 ether;uint256 feeBudget=amount*30/10000;
        deal(WBNB,user,amount);
        uint256[] memory quote=router.getAmountsOutVia(bis,feeBudget,_p2(WBNB,USDT));
        FeeConversion memory fee=FeeConversion(_leg(bis,_p2(WBNB,USDT)),_none(),quote[1],USDT,router.feeConfigVersion());
        uint256 feeBefore=IERC20(USDT).balanceOf(FEE);
        vm.startPrank(user);IERC20(WBNB).approve(address(router),amount);
        uint256 out=router.swapTokenToTokenWithFee(_leg(pcs,_p2(WBNB,BTCB)),_none(),amount,1,_dl(),recipient,fee);
        vm.stopPrank();
        assertGt(out,0);assertEq(IERC20(BTCB).balanceOf(recipient),out);assertEq(IERC20(USDT).balanceOf(FEE)-feeBefore,quote[1]);
        assertEq(IERC20(WBNB).balanceOf(address(router)),0);assertEq(IERC20(WBNB).allowance(address(router),pcs),0);assertEq(IERC20(WBNB).allowance(address(router),bis),0);
    }
    function test_otherToOther_twoLegDoesNotChargeIntermediateUsdt() public {
        uint256 amount=0.01 ether;deal(WBNB,user,amount);
        uint256[] memory quote=router.getAmountsOutVia(bis,amount*30/10000,_p2(WBNB,USDT));
        FeeConversion memory fee=FeeConversion(_leg(bis,_p2(WBNB,USDT)),_none(),quote[1],USDT,router.feeConfigVersion());
        uint256 before=IERC20(USDT).balanceOf(FEE);
        vm.startPrank(user);IERC20(WBNB).approve(address(router),amount);
        uint256 out=router.swapTokenToTokenWithFee(_leg(pcs,_p2(WBNB,USDT)),_leg(pcs,_p2(USDT,BTCB)),amount,1,_dl(),recipient,fee);
        vm.stopPrank();assertGt(out,0);assertEq(IERC20(USDT).balanceOf(FEE)-before,quote[1]);assertEq(IERC20(USDT).balanceOf(address(router)),0);
    }
}
interface IA {function router() external view returns(address);}
