// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatedRouterV10, RouteLeg} from "../src/AggregatedRouterV10.sol";
import {PancakeV3Adapter} from "../src/PancakeV3Adapter.sol";
import {V10ForkTest} from "./V10Fork.t.sol";

interface IWbnbFeePolicyFunding {
    function deposit() external payable;
}

/// @notice 新收费规则回归：核对实际收款，不依赖收费事件或前端展示。
/// 使用父测试的 BSC 分叉、30 bps 配置及现有兑换 API；不覆盖父类 setUp。
contract V10FeePolicyCasesTest is V10ForkTest {
    struct FeeBalances {
        uint256 fist;
        uint256 usdt;
        uint256 nativeBnb;
        uint256 wrappedBnb;
    }

    function _policyFee(uint256 amount) private pure returns (uint256) {
        return amount * 30 / 10_000;
    }

    function _policyGrossUp(uint256 net) private pure returns (uint256) {
        return (net * 10_000 + 9_970 - 1) / 9_970;
    }

    function _feeBalances() private view returns (FeeBalances memory b) {
        b.fist = IERC20(FIST).balanceOf(FEE);
        b.usdt = IERC20(USDT).balanceOf(FEE);
        b.nativeBnb = FEE.balance;
        b.wrappedBnb = IERC20(WBNB).balanceOf(FEE);
    }

    function _assertOnlyTokenFee(FeeBalances memory before, address feeToken, uint256 fee) private view {
        assertGt(fee, 0, "fixture must exercise a nonzero platform fee");
        assertEq(IERC20(FIST).balanceOf(FEE) - before.fist, feeToken == FIST ? fee : 0, "actual FIST fee");
        assertEq(IERC20(USDT).balanceOf(FEE) - before.usdt, feeToken == USDT ? fee : 0, "actual USDT fee");
        assertEq(FEE.balance, before.nativeBnb, "no extra native BNB platform fee");
        assertEq(IERC20(WBNB).balanceOf(FEE), before.wrappedBnb, "ERC20 WBNB is not native BNB fee");
    }

    function _fundWrappedInput(uint256 amount) private {
        vm.startPrank(user);
        IWbnbFeePolicyFunding(WBNB).deposit{value: amount}();
        IERC20(WBNB).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _quoteV2(RouteLeg memory leg, uint256 amount) private view returns (uint256) {
        uint256[] memory quoted = router.getAmountsOutVia(leg.adapter, amount, leg.path);
        return quoted[quoted.length - 1];
    }

    function _quoteV2Legs(RouteLeg memory first, RouteLeg memory second, uint256 amount) private view returns (uint256) {
        uint256 out = _quoteV2(first, amount);
        return second.path.length == 0 ? out : _quoteV2(second, out);
    }

    function _inputTokenForBnbCase(RouteLeg memory first, RouteLeg memory second, uint256 amount) private {
        address input = first.path[0];
        uint256 fee = _policyFee(amount);
        uint256 minimum = _quoteV2Legs(first, second, amount - fee);
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = recipient.balance;
        uint256 inputBefore = IERC20(input).balanceOf(user);

        vm.prank(user);
        uint256 out = router.swapTokenToBnb(first, second, amount, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, input, fee);
        assertEq(inputBefore - IERC20(input).balanceOf(user), amount, "only requested input is spent");
        assertEq(recipient.balance - recipientBefore, minimum, "full post-input-fee swap output reaches user");
        assertEq(out, minimum, "input fee means gross BNB equals net BNB");
    }

    function test_feeCases_fistToBnb_v2Single_inputFee() public {
        _inputTokenForBnbCase(_leg(fst, _p2(FIST, FST_WBNB)), _none(), 2e6);
    }

    function test_feeCases_usdtToBnb_v2Single_inputFee() public {
        _inputTokenForBnbCase(_leg(pcs, _p2(USDT, WBNB)), _none(), 10e18);
    }

    function test_feeCases_fistToBnb_v2TwoLeg_inputFee() public {
        _inputTokenForBnbCase(_leg(fst, _p2(FIST, USDT)), _leg(pcs, _p2(USDT, WBNB)), 2e6);
    }

    function test_feeCases_usdtToBnb_v2TwoLeg_inputFee() public {
        _inputTokenForBnbCase(_leg(fst, _p2(USDT, FIST)), _leg(pcs, _p2(FIST, WBNB)), 10e18);
    }

    function test_feeCases_usdtToBnb_v3_inputFee() public {
        uint256 amount = 10e18;
        uint256 fee = _policyFee(amount);
        bytes memory path = _v3path(USDT, 100, WBNB);
        uint256 minimum = PancakeV3Adapter(payable(v3)).quoteExactIn(path, amount - fee);
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = recipient.balance;

        vm.prank(user);
        uint256 out = router.swapTokenToBnbV3(v3, path, amount, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, USDT, fee);
        assertEq(recipient.balance - recipientBefore, minimum, "no BNB deduction after USDT input fee");
        assertEq(out, minimum, "V3 BNB return equals recipient delta");
    }

    function test_feeCases_fistToBnb_multi_oneInputFee() public {
        RouteLeg[] memory legs = new RouteLeg[](2);
        legs[0] = _leg(fst, _p2(FIST, FST_WBNB));
        legs[1] = _leg(pcs, _p2(FIST, WBNB));
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1e6 + 1;
        amounts[1] = 1e6 + 333;
        uint256 total = amounts[0] + amounts[1];
        uint256 fee = _policyFee(total);
        uint256 budget = total - fee;
        uint256 firstPart = amounts[0] * budget / total;
        uint256 minimum = _quoteV2(legs[0], firstPart) + _quoteV2(legs[1], budget - firstPart);
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = recipient.balance;

        vm.prank(user);
        uint256 out = router.swapTokenToBnbMulti(legs, amounts, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, FIST, fee);
        assertEq(recipient.balance - recipientBefore, minimum, "all branch outputs reach recipient");
        assertEq(out, minimum, "multi return is not charged a second time");
    }

    function _wrappedToFeeTokenV2Case(address output) private {
        uint256 amount = 0.002 ether;
        _fundWrappedInput(amount);
        RouteLeg memory route = _leg(pcs, _p2(WBNB, output));
        uint256 gross = _quoteV2(route, amount);
        uint256 fee = _policyFee(gross);
        uint256 minimum = gross - fee;
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = IERC20(output).balanceOf(recipient);

        vm.prank(user);
        uint256 out = router.swapTokenToToken(route, _none(), amount, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, output, fee);
        assertEq(IERC20(output).balanceOf(recipient) - recipientBefore, minimum, "minOut is net of output fee");
        assertEq(out, minimum, "return reports recipient net output");
    }

    function test_feeCases_wrappedBnbToFist_v2_outputFee() public {
        _wrappedToFeeTokenV2Case(FIST);
    }

    function test_feeCases_wrappedBnbToUsdt_v2_outputFee() public {
        _wrappedToFeeTokenV2Case(USDT);
    }

    function test_feeCases_wrappedBnbToUsdt_v3_outputFee() public {
        uint256 amount = 0.002 ether;
        _fundWrappedInput(amount);
        bytes memory path = _v3path(WBNB, 100, USDT);
        uint256 gross = PancakeV3Adapter(payable(v3)).quoteExactIn(path, amount);
        uint256 fee = _policyFee(gross);
        uint256 minimum = gross - fee;
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = IERC20(USDT).balanceOf(recipient);

        vm.prank(user);
        uint256 out = router.swapTokenToTokenV3(v3, path, amount, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, USDT, fee);
        assertEq(IERC20(USDT).balanceOf(recipient) - recipientBefore, minimum, "V3 net output respects minOut");
        assertEq(out, minimum, "V3 return reports net output");
    }

    function _wrappedToFeeTokenMultiCase(address output, address transit) private {
        RouteLeg[] memory legs = new RouteLeg[](2);
        legs[0] = _leg(pcs, _p2(WBNB, output));
        legs[1] = _leg(pcs, _p3(WBNB, transit, output));
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 0.001 ether;
        amounts[1] = 0.0015 ether;
        _fundWrappedInput(amounts[0] + amounts[1]);
        // 两支路使用不同池；中间 FIST/USDT 不应触发额外平台费。
        uint256 gross = _quoteV2(legs[0], amounts[0]) + _quoteV2(legs[1], amounts[1]);
        uint256 fee = _policyFee(gross);
        uint256 minimum = gross - fee;
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = IERC20(output).balanceOf(recipient);

        vm.prank(user);
        uint256 out = router.swapTokenToTokenMulti(legs, amounts, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, output, fee);
        assertEq(IERC20(output).balanceOf(recipient) - recipientBefore, minimum, "aggregate net output respects minOut");
        assertEq(out, minimum, "aggregate fee is charged only once");
    }

    function test_feeCases_wrappedBnbToFist_multi_outputFee() public {
        _wrappedToFeeTokenMultiCase(FIST, USDT);
    }

    function test_feeCases_wrappedBnbToUsdt_multi_outputFee() public {
        _wrappedToFeeTokenMultiCase(USDT, FIST);
    }

    function _bothFeeTokensCase(address input, address output, uint256 amount) private {
        uint256 fee = _policyFee(amount);
        RouteLeg memory route = _leg(fst, _p2(input, output));
        uint256 minimum = _quoteV2(route, amount - fee);
        FeeBalances memory feesBefore = _feeBalances();
        uint256 recipientBefore = IERC20(output).balanceOf(recipient);

        vm.prank(user);
        uint256 out = router.swapTokenToToken(route, _none(), amount, minimum, _dl(), recipient);

        _assertOnlyTokenFee(feesBefore, input, fee);
        assertEq(IERC20(output).balanceOf(recipient) - recipientBefore, minimum, "output fee token is not charged again");
        assertEq(out, minimum, "input priority preserves full swap output");
    }

    function test_feeCases_fistToUsdt_inputPriority() public {
        _bothFeeTokensCase(FIST, USDT, 2e6);
    }

    function test_feeCases_usdtToFist_inputPriority() public {
        _bothFeeTokensCase(USDT, FIST, 10e18);
    }

    function test_feeCases_exactOutput_fistToBnb_inputFeeAndNetTarget() public {
        uint256 target = 0.0001 ether;
        RouteLeg memory route = _leg(fst, _p2(FIST, FST_WBNB));
        uint256 rawInput = router.getAmountsInVia(fst, target, route.path)[0];
        uint256 expectedInput = _policyGrossUp(rawInput);
        uint256 expectedFee = _policyFee(expectedInput);
        // grossUp 向上取整，实际费用向下取整；余数继续兑换。
        uint256 expectedOut = _quoteV2(route, expectedInput - expectedFee);
        (uint256 quotedInput, uint256 quotedFee) = router.quoteExactOutput(route, _none(), target, 1);
        assertEq(quotedInput, expectedInput, "quote grosses up input, not BNB output");
        assertEq(quotedFee, expectedFee, "exact-output quote denominates fee in FIST");
        FeeBalances memory feesBefore = _feeBalances();
        uint256 inputBefore = IERC20(FIST).balanceOf(user);
        uint256 recipientBefore = recipient.balance;

        vm.startPrank(user);
        vm.expectRevert(AggregatedRouterV10.ExcessiveInput.selector);
        router.swapTokenForExactBnb(route, _none(), target, expectedInput - 1, _dl(), recipient);
        uint256 used = router.swapTokenForExactBnb(route, _none(), target, expectedInput + 1e6, _dl(), recipient);
        vm.stopPrank();

        _assertOnlyTokenFee(feesBefore, FIST, expectedFee);
        assertEq(used, expectedInput, "only required input is pulled despite larger maxIn");
        assertEq(inputBefore - IERC20(FIST).balanceOf(user), expectedInput, "actual input matches quote");
        assertEq(recipient.balance - recipientBefore, expectedOut, "all BNB after input fee reaches recipient");
        assertGe(recipient.balance - recipientBefore, target, "exact output target is net");
    }

    function test_feeCases_exactOutput_wrappedBnbToUsdt_outputFeeAndNetTarget() public {
        uint256 target = 1e18;
        uint256 grossTarget = _policyGrossUp(target);
        RouteLeg memory route = _leg(pcs, _p2(WBNB, USDT));
        uint256 expectedInput = router.getAmountsInVia(pcs, grossTarget, route.path)[0];
        _fundWrappedInput(expectedInput + 0.001 ether);
        uint256 actualGross = _quoteV2(route, expectedInput);
        uint256 expectedFee = _policyFee(actualGross);
        (uint256 quotedInput, uint256 quotedFee) = router.quoteExactOutput(route, _none(), target, 2);
        assertEq(quotedInput, expectedInput, "quote grosses up USDT output, not wrapped BNB input");
        assertGt(quotedFee, 0, "quote includes a USDT fee");
        assertGe(quotedFee, _policyFee(grossTarget), "quoted fee uses gross USDT output units");
        // V2 输入最小单位的向上取整可使实际毛输出高于倒算目标。
        assertGe(expectedFee, quotedFee, "actual gross-output rounding may increase the quoted fee");
        FeeBalances memory feesBefore = _feeBalances();
        uint256 inputBefore = IERC20(WBNB).balanceOf(user);
        uint256 recipientBefore = IERC20(USDT).balanceOf(recipient);

        vm.startPrank(user);
        vm.expectRevert(AggregatedRouterV10.ExcessiveInput.selector);
        router.swapTokenForExactToken(route, _none(), target, expectedInput - 1, _dl(), recipient);
        uint256 used = router.swapTokenForExactToken(route, _none(), target, expectedInput + 0.001 ether, _dl(), recipient);
        vm.stopPrank();

        _assertOnlyTokenFee(feesBefore, USDT, expectedFee);
        assertEq(used, expectedInput, "only required wrapped BNB input is pulled");
        assertEq(inputBefore - IERC20(WBNB).balanceOf(user), expectedInput, "unused maxIn stays with payer");
        assertEq(IERC20(USDT).balanceOf(recipient) - recipientBefore, actualGross - expectedFee, "actual USDT output is net of one fee");
        assertGe(IERC20(USDT).balanceOf(recipient) - recipientBefore, target, "exact output remains a net target");
    }
}
