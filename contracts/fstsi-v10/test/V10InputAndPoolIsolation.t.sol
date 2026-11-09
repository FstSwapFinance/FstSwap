// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatedRouterV10, RouteLeg, FeeConversion} from "../src/AggregatedRouterV10.sol";
import {FeeTestToken, FeeTestAdapter} from "./V10FeeConversion.t.sol";

/// @dev 只对付款人额外收 1%；接收方实收完整 amount，router/adapter 后续转出豁免。
contract SenderSurchargeFixtureToken is FeeTestToken {
    address public immutable taxedPayer;
    address public immutable taxCollector;
    bool public taxEnabled = true;

    constructor(address payer_, address collector_) {
        taxedPayer = payer_;
        taxCollector = collector_;
    }

    function setTaxEnabled(bool enabled) external {
        taxEnabled = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (taxEnabled && from == taxedPayer && to != address(0)) {
            super._update(from, taxCollector, value / 100);
        }
    }
}

/// @notice 独立单元测试，不继承分叉测试或其他测试合约；共用已有轻量 adapter fixture。
contract V10InputAndPoolIsolationTest is Test {
    address private constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address private constant FIST = 0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A;
    address private constant USER = address(0xA11CE);
    address private constant RECEIVER = address(0xFEE);
    address private constant RECIPIENT = address(0xB0B);
    address private constant TAX = address(0x7A4);

    AggregatedRouterV10 private router;
    FeeTestAdapter private adapter;
    SenderSurchargeFixtureToken private input;
    FeeTestToken private output;
    FeeTestToken private transit;
    FeeTestToken private auxiliary;
    FeeTestToken private wrapped;

    function setUp() public {
        input = new SenderSurchargeFixtureToken(USER, TAX);
        output = new FeeTestToken();
        transit = new FeeTestToken();
        auxiliary = new FeeTestToken();
        wrapped = new FeeTestToken();
        FeeTestToken template = new FeeTestToken();
        vm.etch(USDT, address(template).code);
        vm.etch(FIST, address(template).code);
        router = new AggregatedRouterV10(address(wrapped), RECEIVER, 30, address(this));
        adapter = new FeeTestAdapter(address(router), address(wrapped));
        router.setAdapter(address(adapter), true);
        input.mint(USER, 1_000 ether);
        input.mint(address(router), 4 ether);
        FeeTestToken(USDT).mint(address(router), 5 ether);
        output.mint(address(router), 6 ether);
        transit.mint(address(router), 7 ether);
        vm.deal(address(adapter), 100 ether);
        vm.prank(USER);
        input.approve(address(router), 1_000 ether);
    }

    function _p2(address a, address b) private pure returns (address[] memory p) {
        p = new address[](2); p[0] = a; p[1] = b;
    }

    function _p3(address a, address b, address c) private pure returns (address[] memory p) {
        p = new address[](3); p[0] = a; p[1] = b; p[2] = c;
    }

    function _p4(address a, address b, address c, address d) private pure returns (address[] memory p) {
        p = new address[](4); p[0] = a; p[1] = b; p[2] = c; p[3] = d;
    }

    function _leg(address[] memory path) private view returns (RouteLeg memory) {
        return RouteLeg(address(adapter), path);
    }

    function _none() private pure returns (RouteLeg memory) {
        return RouteLeg(address(0), new address[](0));
    }

    function _fee() private view returns (FeeConversion memory) {
        return FeeConversion(_leg(_p2(address(input), USDT)), _none(), 0.03 ether, USDT, router.feeConfigVersion());
    }

    function _stateHash() private view returns (bytes32) {
        address[6] memory accounts = [USER, RECEIVER, RECIPIENT, TAX, address(router), address(adapter)];
        bytes memory state = abi.encode(input.allowance(USER, address(router)), input.allowance(address(router), address(adapter)));
        for (uint256 i; i < accounts.length; ++i) {
            state = abi.encode(state, accounts[i].balance, input.balanceOf(accounts[i]), output.balanceOf(accounts[i]), transit.balanceOf(accounts[i]), IERC20(USDT).balanceOf(accounts[i]));
        }
        return keccak256(state);
    }

    function _expectInvalidPath() private {
        vm.prank(USER);
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
    }

    function test_surchargeFixture_creditsFullAmountButDebitsMoreOnlyFromPayer() public {
        vm.prank(USER);
        input.transfer(address(this), 100 ether);
        assertEq(input.balanceOf(USER), 899 ether, "payer loses amount plus surcharge");
        assertEq(input.balanceOf(address(this)), 100 ether, "receiver delta hides sender surcharge");
        assertEq(input.balanceOf(TAX), 1 ether);
        input.transfer(address(adapter), 100 ether);
        assertEq(input.balanceOf(address(adapter)), 100 ether, "later transfers are tax exempt");
        assertEq(input.balanceOf(TAX), 1 ether, "only the original payer is taxed");
    }

    function test_senderSurcharge_exactTokenOutputRejectsActualSpendAboveMaximum() public {
        RouteLeg memory route = _leg(_p2(address(input), USDT));
        (uint256 maximum,) = router.quoteExactOutput(route, _none(), 9.97 ether, 2);
        assertEq(maximum, 10 ether);
        bytes32 before = _stateHash();
        vm.prank(USER);
        vm.expectRevert(AggregatedRouterV10.UnderpaidFee.selector);
        router.swapTokenForExactToken(route, _none(), 9.97 ether, maximum, block.timestamp + 60, RECIPIENT);
        assertEq(_stateHash(), before, "rejected sender surcharge restores payer, allowance and historical assets");
    }

    function test_senderSurcharge_exactNativeOutputRejectsActualSpendAboveMaximum() public {
        RouteLeg memory route = _leg(_p2(address(input), address(wrapped)));
        (uint256 maximum,) = router.quoteExactOutput(route, _none(), 9.97 ether, 1);
        assertEq(maximum, 10 ether);
        bytes32 before = _stateHash();
        vm.prank(USER);
        vm.expectRevert(AggregatedRouterV10.UnderpaidFee.selector);
        router.swapTokenForExactBnb(route, _none(), 9.97 ether, maximum, block.timestamp + 60, RECIPIENT);
        assertEq(_stateHash(), before, "native exact output cannot charge amount plus tax above maxIn");
    }

    function test_senderSurcharge_exactOutputWithFeeRejectsActualSpendAboveMaximum() public {
        RouteLeg memory route = _leg(_p2(address(input), address(output)));
        FeeConversion memory conversion = _fee();
        (uint256 maximum,,,) = router.quoteExactOutputWithFee(route, _none(), 9.97 ether, conversion);
        assertEq(maximum, 10 ether);
        bytes32 before = _stateHash();
        vm.prank(USER);
        vm.expectRevert(AggregatedRouterV10.UnderpaidFee.selector);
        router.swapTokenForExactTokenWithFee(route, _none(), 9.97 ether, maximum, block.timestamp + 60, RECIPIENT, conversion);
        assertEq(_stateHash(), before, "fee-conversion exact output also enforces payer spend");
    }

    function test_senderSurcharge_disabledAllowsExactMaximumWithoutSpendingHistory() public {
        input.setTaxEnabled(false);
        vm.prank(USER);
        uint256 used = router.swapTokenForExactToken(_leg(_p2(address(input), USDT)), _none(), 9.97 ether, 10 ether, block.timestamp + 60, RECIPIENT);
        assertEq(used, 10 ether);
        assertEq(input.balanceOf(USER), 990 ether);
        assertEq(input.balanceOf(address(router)), 4 ether);
        assertEq(IERC20(USDT).balanceOf(address(router)), 5 ether);
        assertEq(IERC20(USDT).balanceOf(RECIPIENT), 9.97 ether);
        assertEq(IERC20(USDT).balanceOf(RECEIVER), 0.03 ether);
        assertEq(input.balanceOf(TAX), 0);
    }

    function test_sharedMainFeePool_quoteRejectsBeforePresentingExecutablePrice() public {
        RouteLeg memory route = _leg(_p3(address(input), USDT, address(output)));
        FeeConversion memory conversion = _fee();
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.quoteExactOutputWithFee(route, _none(), 9.97 ether, conversion);
    }

    function test_sharedMainFeePool_exactInputAndExactOutputRejectBeforePulling() public {
        RouteLeg memory route = _leg(_p3(address(input), USDT, address(output)));
        FeeConversion memory conversion = _fee();
        bytes32 before = _stateHash();
        _expectInvalidPath();
        router.swapTokenToTokenWithFee(route, _none(), 10 ether, 9.97 ether, block.timestamp + 60, RECIPIENT, conversion);
        _expectInvalidPath();
        router.swapTokenForExactTokenWithFee(route, _none(), 9.97 ether, 10 ether, block.timestamp + 60, RECIPIENT, conversion);
        assertEq(_stateHash(), before, "overlap is rejected before any main swap or fee transfer");
    }

    function test_sharedMainSecondFeeSecondPool_rejectsBothDirections() public {
        RouteLeg memory first = _leg(_p2(address(input), address(transit)));
        RouteLeg memory second = _leg(_p2(address(transit), address(output)));
        FeeConversion memory conversion = _fee();
        conversion.first = _leg(_p2(address(input), address(auxiliary)));
        conversion.second = _leg(_p4(address(auxiliary), address(output), address(transit), USDT));
        // 主 second 使用 transit/output；费用 second 逆向使用同一对。
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.quoteExactOutputWithFee(first, second, 9.97 ether, conversion);
        bytes32 before = _stateHash();
        _expectInvalidPath();
        router.swapTokenToTokenWithFee(first, second, 10 ether, 9.97 ether, block.timestamp + 60, RECIPIENT, conversion);
        assertEq(_stateHash(), before);
    }

    function test_sharedPoolThroughDifferentAdapterAddressesStillRejected() public {
        FeeTestAdapter aliasAdapter = new FeeTestAdapter(address(router), address(wrapped));
        router.setAdapter(address(aliasAdapter), true);
        FeeConversion memory conversion = _fee();
        conversion.first.adapter = address(aliasAdapter);
        RouteLeg memory route = _leg(_p3(address(input), USDT, address(output)));
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.quoteExactOutputWithFee(route, _none(), 9.97 ether, conversion);
        _expectInvalidPath();
        router.swapTokenToTokenWithFee(route, _none(), 10 ether, 9.97 ether, block.timestamp + 60, RECIPIENT, conversion);
    }

    function test_sharedFeePoolInLaterMultiBranchRejected() public {
        RouteLeg[] memory legs = new RouteLeg[](2);
        legs[0] = _leg(_p2(address(input), address(output)));
        legs[1] = _leg(_p3(address(input), USDT, address(output)));
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 6 ether; amounts[1] = 4 ether;
        FeeConversion memory conversion = _fee();
        bytes32 before = _stateHash();
        _expectInvalidPath();
        router.swapTokenToTokenMultiWithFee(legs, amounts, 9.97 ether, block.timestamp + 60, RECIPIENT, conversion);
        assertEq(_stateHash(), before, "later branch overlap is also rejected before pulling funds");
    }

    function test_repeatedPoolAcrossMainLegsRejectedByQuoteAndBothSwapModes() public {
        RouteLeg memory first = _leg(_p3(address(input), address(transit), address(output)));
        RouteLeg memory second = _leg(_p4(address(output), address(input), address(transit), USDT));
        // 每段自身无重复 token，首尾也不同，但两段重复 input/transit 同向池。
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.quoteExactOutput(first, second, 9.97 ether, 2);
        bytes32 before = _stateHash();
        _expectInvalidPath();
        router.swapTokenToToken(first, second, 10 ether, 9.97 ether, block.timestamp + 60, RECIPIENT);
        _expectInvalidPath();
        router.swapTokenForExactToken(first, second, 9.97 ether, 10 ether, block.timestamp + 60, RECIPIENT);
        assertEq(_stateHash(), before, "repeated two-leg pool cannot reach execution");
    }

    function test_repeatedPoolAcrossFeeLegsRejectedByFeeQuoteAndExecution() public {
        FeeConversion memory conversion = _fee();
        conversion.first = _leg(_p3(address(input), address(transit), address(auxiliary)));
        conversion.second = _leg(_p4(address(auxiliary), address(input), address(transit), USDT));
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.quoteFeeConversion(address(input), 0.03 ether, conversion);
        bytes32 before = _stateHash();
        _expectInvalidPath();
        router.swapTokenToTokenWithFee(_leg(_p2(address(input), address(output))), _none(), 10 ether, 9.97 ether, block.timestamp + 60, RECIPIENT, conversion);
        assertEq(_stateHash(), before);
    }

    function test_disjointTwoLegTradeAndFeeQuoteExecuteAndPreserveHistory() public {
        input.setTaxEnabled(false);
        RouteLeg memory first = _leg(_p2(address(input), address(transit)));
        RouteLeg memory second = _leg(_p2(address(transit), address(output)));
        FeeConversion memory conversion = _fee();
        (uint256 amountIn, uint256 feeBudget, address feeToken, uint256 feeAmount) = router.quoteExactOutputWithFee(first, second, 9.97 ether, conversion);
        assertEq(amountIn, 10 ether);
        assertEq(feeBudget, 0.03 ether);
        assertEq(feeToken, USDT);
        assertEq(feeAmount, 0.03 ether);
        vm.prank(USER);
        uint256 used = router.swapTokenForExactTokenWithFee(first, second, 9.97 ether, amountIn, block.timestamp + 60, RECIPIENT, conversion);
        assertEq(used, amountIn);
        assertEq(input.balanceOf(USER), 990 ether);
        assertEq(output.balanceOf(RECIPIENT), 9.97 ether);
        assertEq(IERC20(USDT).balanceOf(RECEIVER), feeAmount);
        assertEq(input.balanceOf(address(router)), 4 ether);
        assertEq(IERC20(USDT).balanceOf(address(router)), 5 ether);
        assertEq(output.balanceOf(address(router)), 6 ether);
        assertEq(transit.balanceOf(address(router)), 7 ether);
        assertEq(input.allowance(address(router), address(adapter)), 0);
        assertEq(transit.allowance(address(router), address(adapter)), 0);
    }
}
