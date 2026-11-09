// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatedRouterV10, RouteLeg} from "../src/AggregatedRouterV10.sol";
import {FstSwapAdapter56} from "../src/FstSwapAdapter56.sol";
import {PancakeAdapter56} from "../src/PancakeAdapter56.sol";
import {BiSwapAdapter56} from "../src/BiSwapAdapter56.sol";
import {PancakeV3Adapter} from "../src/PancakeV3Adapter.sol";


/// @notice BSC 主网 fork：v10 每个新兑换函数 + v9 函数（仅授权路由器）对真实 FstSwap / Pancake / Pancake V3 池子。
/// 运行：FOUNDRY_PROFILE=default forge test --fork-url https://bsc-rpc.publicnode.com -vv
contract V10ForkTest is Test {
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant FIST = 0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A;
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address constant FST_WBNB = 0x0efb5FD2402A0967B92551d6AF54De148504A115;
    address constant PCS_V3_QUOTER = 0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997;
    address constant FEE = 0xfF820D0553Ccb72dDa17A63212F79E7F3f789a99;

    AggregatedRouterV10 router;
    address fst;
    address pcs;
    address bis;
    address v3;
    uint256 userPk = uint256(keccak256("fstswap.v10.fork.user"));
    address user;
    address payable recipient = payable(address(uint160(uint256(keccak256("fstswap.v10.fork.recipient")))));

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string("https://bsc-rpc.publicnode.com"));
        vm.createSelectFork(rpc, vm.envOr("FORK_BLOCK", uint256(132647262)));
        router = new AggregatedRouterV10(FST_WBNB, FEE, 30, address(this));
        fst = address(new FstSwapAdapter56(address(router)));
        pcs = address(new PancakeAdapter56(address(router)));
        bis = address(new BiSwapAdapter56(address(router)));
        v3 = address(new PancakeV3Adapter(address(router), WBNB, PCS_V3_QUOTER));
        router.setAdapter(fst, true);
        router.setAdapter(pcs, true);
        router.setAdapter(bis, true);
        router.setAdapter(v3, true);
        user = vm.addr(userPk);
        vm.deal(user, 100 ether);
        deal(USDT, user, 10_000e18);
        deal(FIST, user, 10_000e6);
        vm.startPrank(user);
        IERC20(USDT).approve(address(router), type(uint256).max);
        IERC20(FIST).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _p2(address a, address b) internal pure returns (address[] memory p) { p = new address[](2); p[0] = a; p[1] = b; }
    function _p3(address a, address b, address c) internal pure returns (address[] memory p) { p = new address[](3); p[0] = a; p[1] = b; p[2] = c; }
    function _leg(address adapter, address[] memory path) internal pure returns (RouteLeg memory) { return RouteLeg(adapter, path); }
    function _none() internal pure returns (RouteLeg memory) { return RouteLeg(address(0), new address[](0)); }
    function _dl() internal view returns (uint256) { return block.timestamp + 600; }
    function _v3path(address a, uint24 f, address b) internal pure returns (bytes memory) { return abi.encodePacked(a, f, b); }

    // ---------------- v9 函数（签名不变，用户只授权路由器） ----------------

    function test_v9_buy_bnbToToken_pancake() public {
        vm.prank(user);
        uint256 out = router.swapBnbToToken{value: 0.01 ether}(_leg(pcs, _p2(WBNB, FIST)), _none(), 1, _dl(), recipient);
        assertGt(out, 0);
        assertEq(IERC20(FIST).balanceOf(recipient), out);
    }

    function test_v9_sell_tokenToBnb_routerApprovalOnly() public {
        uint256 feeBefore = IERC20(FIST).balanceOf(FEE);
        vm.prank(user);
        uint256 gross = router.swapTokenToBnb(_leg(fst, _p2(FIST, FST_WBNB)), _none(), 2e6, 1, _dl(), recipient);
        assertGt(gross, 0);
        assertEq(IERC20(FIST).balanceOf(FEE) - feeBefore, 2e6 * 30 / 10_000);
        assertEq(recipient.balance, gross);
        assertEq(IERC20(FIST).allowance(user, fst), 0, "user never approves the adapter");
        assertEq(IERC20(FIST).balanceOf(address(router)), 0);
    }

    function test_v9_sell_twoLeg_and_v3_and_multi() public {
        vm.startPrank(user);
        // 两段：FstSwap FIST→USDT，再 Pancake USDT→WBNB
        uint256 a = router.swapTokenToBnb(_leg(fst, _p2(FIST, USDT)), _leg(pcs, _p2(USDT, WBNB)), 2e6, 1, _dl(), recipient);
        assertGt(a, 0);
        // V3：USDT→WBNB 0.01% 池卖出（tokenOut 必须是 WBNB）
        uint256 b = router.swapTokenToBnbV3(v3, _v3path(USDT, 100, WBNB), 10e18, 1, _dl(), recipient);
        assertGt(b, 0);
        // Multi：FstSwap + Pancake 两池卖 FIST
        RouteLeg[] memory legs = new RouteLeg[](2);
        legs[0] = _leg(fst, _p2(FIST, FST_WBNB));
        legs[1] = _leg(pcs, _p2(FIST, WBNB));
        uint256[] memory amts = new uint256[](2);
        amts[0] = 1e6; amts[1] = 1e6;
        uint256 c = router.swapTokenToBnbMulti(legs, amts, 1, _dl(), recipient);
        assertGt(c, 0);
        vm.stopPrank();
        assertEq(IERC20(USDT).balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
    }

    // ---------------- 代币 ⇄ 代币 ----------------

    function test_tokenToToken_single_fst_USDT_FIST() public {
        uint256 feeBefore = IERC20(USDT).balanceOf(FEE);
        uint256[] memory q = router.getAmountsOutVia(fst, 10e18 - 10e18 * 30 / 10_000, _p2(USDT, FIST));
        vm.prank(user);
        uint256 out = router.swapTokenToToken(_leg(fst, _p2(USDT, FIST)), _none(), 10e18, q[1], _dl(), recipient);
        assertEq(out, q[1], "on-chain quote == execution");
        assertEq(IERC20(USDT).balanceOf(FEE) - feeBefore, 10e18 * 30 / 10_000, "fee in input token");
    }

    function test_tokenToToken_twoLeg_pcs_then_fst() public {
        vm.prank(user);
        uint256 out = router.swapTokenToToken(_leg(pcs, _p2(FIST, WBNB)), _leg(pcs, _p2(WBNB, USDT)), 3e6, 1, _dl(), recipient);
        assertGt(out, 0);
        assertEq(IERC20(USDT).balanceOf(recipient), out);
    }

    function test_tokenToToken_v3() public {
        vm.prank(user);
        uint256 out = router.swapTokenToTokenV3(v3, _v3path(USDT, 100, WBNB), 10e18, 1, _dl(), recipient);
        assertGt(out, 0);
        assertEq(IERC20(WBNB).balanceOf(recipient), out);
    }

    function test_tokenToToken_multi() public {
        RouteLeg[] memory legs = new RouteLeg[](2);
        legs[0] = _leg(fst, _p2(USDT, FIST));
        legs[1] = _leg(pcs, _p2(USDT, FIST));
        uint256[] memory amts = new uint256[](2);
        amts[0] = 6e18; amts[1] = 4e18;
        vm.prank(user);
        uint256 out = router.swapTokenToTokenMulti(legs, amts, 1, _dl(), recipient);
        assertGt(out, 0);
        assertEq(IERC20(FIST).balanceOf(recipient), out);
        assertEq(IERC20(USDT).balanceOf(address(router)), 0);
    }

    // ---------------- 精确输出 ----------------

    function test_exactOut_bnbForToken_refund() public {
        RouteLeg memory leg = _leg(pcs, _p2(WBNB, FIST));
        (uint256 need, uint256 fee) = router.quoteExactOutput(leg, _none(), 1e6, 0);
        uint256 balBefore = user.balance;
        vm.prank(user);
        uint256 used = router.swapBnbForExactToken{value: need + 0.01 ether}(leg, _none(), 1e6, _dl(), recipient);
        assertEq(used, need);
        assertEq(balBefore - user.balance, need, "excess refunded");
        assertGe(IERC20(FIST).balanceOf(recipient), 1e6);
        assertGt(fee, 0);
    }

    function test_exactOut_bnbForToken_twoLeg() public {
        RouteLeg memory a = _leg(pcs, _p2(WBNB, USDT));
        RouteLeg memory b = _leg(fst, _p2(USDT, FIST));
        (uint256 need,) = router.quoteExactOutput(a, b, 2e6, 0);
        vm.prank(user);
        router.swapBnbForExactToken{value: need}(a, b, 2e6, _dl(), recipient);
        assertGe(IERC20(FIST).balanceOf(recipient), 2e6);
    }

    function test_exactOut_tokenForBnb() public {
        RouteLeg memory leg = _leg(fst, _p2(FIST, FST_WBNB));
        (uint256 need,) = router.quoteExactOutput(leg, _none(), 0.0001 ether, 1);
        uint256 fistBefore = IERC20(FIST).balanceOf(user);
        vm.prank(user);
        uint256 used = router.swapTokenForExactBnb(leg, _none(), 0.0001 ether, need, _dl(), recipient);
        assertEq(used, need);
        assertEq(fistBefore - IERC20(FIST).balanceOf(user), need);
        assertGe(recipient.balance, 0.0001 ether);
    }

    function test_exactOut_tokenForToken_and_maxIn() public {
        RouteLeg memory leg = _leg(fst, _p2(USDT, FIST));
        (uint256 need,) = router.quoteExactOutput(leg, _none(), 5e6, 2);
        vm.prank(user);
        vm.expectRevert(AggregatedRouterV10.ExcessiveInput.selector);
        router.swapTokenForExactToken(leg, _none(), 5e6, need - 1, _dl(), recipient);
        vm.prank(user);
        uint256 used = router.swapTokenForExactToken(leg, _none(), 5e6, need, _dl(), recipient);
        assertEq(used, need);
        assertGe(IERC20(FIST).balanceOf(recipient), 5e6);
    }

    // ---------------- 只读 ----------------

    function test_views() public view {
        uint256[] memory o = router.getAmountsOutVia(fst, 1e18, _p2(USDT, FIST));
        uint256[] memory i = router.getAmountsInVia(fst, o[1], _p2(USDT, FIST));
        assertLe(i[0], 1e18);
        (address pair, address t0, address t1, uint112 r0, uint112 r1, uint256 ts,) = router.getPairInfo(fst, FIST, USDT, user);
        assertTrue(pair != address(0) && t0 != t1 && r0 > 0 && r1 > 0 && ts > 0);
        address[] memory toks = new address[](3);
        toks[0] = address(0); toks[1] = USDT; toks[2] = FIST;
        uint256[] memory bals = router.balancesOf(user, toks);
        assertEq(bals[0], user.balance);
        assertEq(bals[1], IERC20(USDT).balanceOf(user));
        uint256[] memory alw = router.allowancesOf(user, toks);
        assertEq(alw[1], type(uint256).max);
    }

    // ---------------- 失败路径 ----------------

    function test_reverts() public {
        vm.startPrank(user);
        vm.expectRevert(AggregatedRouterV10.Expired.selector);
        router.swapTokenToToken(_leg(fst, _p2(USDT, FIST)), _none(), 1e18, 1, block.timestamp - 1, recipient);
        vm.expectRevert(); // minOut 不可达：DEX 路由层先回滚
        router.swapTokenToToken(_leg(fst, _p2(USDT, FIST)), _none(), 1e18, type(uint128).max, _dl(), recipient);
        vm.expectRevert(AggregatedRouterV10.NoRoute.selector);
        router.swapTokenToToken(_leg(address(0x1234), _p2(USDT, FIST)), _none(), 1e18, 1, _dl(), recipient);
        vm.expectRevert(AggregatedRouterV10.ExcessiveInput.selector);
        router.swapBnbForExactToken{value: 1}(_leg(pcs, _p2(WBNB, FIST)), _none(), 1e6, _dl(), recipient);
        vm.stopPrank();
        vm.prank(address(0xBAD));
        vm.expectRevert(AggregatedRouterV10.Unauthorized.selector);
        router.setFee(FEE, 50);
    }
}
