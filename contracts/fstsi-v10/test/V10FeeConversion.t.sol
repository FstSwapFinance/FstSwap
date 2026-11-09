// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatedRouterV10, RouteLeg, V10RouteEngine} from "../src/AggregatedRouterV10.sol";

struct TestFeeConversion {
    RouteLeg first;
    RouteLeg second;
    uint256 minOut;
    address feeToken;
    uint256 configVersion;
}
interface IFeeConversionRouter {
    function defaultFeeToken() external view returns(address);
    function feeConfigVersion() external view returns(uint256);
    function setDefaultFeeToken(address token) external;
    function swapTokenToTokenWithFee(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOut, uint256 deadline, address recipient, TestFeeConversion calldata fee) external returns(uint256);
    function swapTokenToTokenV3WithFee(address adapter, bytes calldata path, uint256 amountIn, uint256 minOut, uint256 deadline, address recipient, TestFeeConversion calldata fee) external returns(uint256);
    function swapTokenToTokenMultiWithFee(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 minOut, uint256 deadline, address recipient, TestFeeConversion calldata fee) external returns(uint256);
    function swapTokenForExactTokenWithFee(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, uint256 amountInMax, uint256 deadline, address recipient, TestFeeConversion calldata fee) external returns(uint256);
}
contract FeeTestToken is ERC20 {
    constructor() ERC20("Unit token", "UNIT") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
contract FeeTestAdapter {
    address public immutable aggregator;
    address public immutable router;
    address public immutable weth;
    constructor(address agg, address wrapped) {aggregator=agg;router=address(this);weth=wrapped;}
    function getPair(address a,address b) external pure returns(address){return address(uint160(uint256(keccak256(abi.encode(a<b?a:b,a<b?b:a)))));}
    function getAmountsOut(uint256 amount,address[] calldata path) external pure returns(uint256[] memory out){out=new uint256[](path.length);for(uint256 i;i<path.length;i++)out[i]=amount;}
    function getAmountsIn(uint256 amount,address[] calldata path) external pure returns(uint256[] memory out){out=new uint256[](path.length);for(uint256 i;i<path.length;i++)out[i]=amount;}
    function swapExactTokensForTokens(address payer,uint256 amount,uint256 minOut,address[] calldata path,address to,uint256) external returns(uint256){require(msg.sender==aggregator);require(amount>=minOut);IERC20(path[0]).transferFrom(payer,address(this),amount);FeeTestToken(path[path.length-1]).mint(to,amount);return amount;}
    function swapExactTokensForEth(address payer,uint256 amount,uint256 minOut,address[] calldata path,address to,uint256) external returns(uint256){require(msg.sender==aggregator);require(amount>=minOut);IERC20(path[0]).transferFrom(payer,address(this),amount);(bool ok,)=payable(to).call{value:amount}("");require(ok);return amount;}
    function decodePath(bytes calldata path) external pure returns(address,address,uint24){return (address(bytes20(path[:20])),address(bytes20(path[23:43])),100);}
    function executeTokenToToken(address payer,bytes calldata path,uint256 amount,uint256 minOut,address to,uint256) external returns(uint256){require(msg.sender==aggregator);require(amount>=minOut);IERC20(address(bytes20(path[:20]))).transferFrom(payer,address(this),amount);FeeTestToken(address(bytes20(path[23:43]))).mint(to,amount);return amount;}
    receive() external payable {}
}
contract V10FeeConversionTest is Test {
    address constant USDT=0x55d398326f99059fF775485246999027B3197955;
    address constant FIST=0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A;
    AggregatedRouterV10 router;
    IFeeConversionRouter feeRouter;
    FeeTestAdapter adapter;
    FeeTestToken input;
    FeeTestToken output;
    FeeTestToken wrapped;
    address user=address(0xA11CE);
    address receiver=address(0xFEE);
    address recipient=address(0xB0B);
    function setUp() public {
        input=new FeeTestToken();output=new FeeTestToken();wrapped=new FeeTestToken();
        FeeTestToken template=new FeeTestToken();vm.etch(USDT,address(template).code);vm.etch(FIST,address(template).code);
        router=new AggregatedRouterV10(address(wrapped),receiver,30,address(this));feeRouter=IFeeConversionRouter(address(router));
        adapter=new FeeTestAdapter(address(router),address(wrapped));router.setAdapter(address(adapter),true);
        input.mint(user,100 ether);vm.deal(address(adapter),100 ether);
        vm.prank(user);input.approve(address(router),type(uint256).max);
    }
    function leg(address a,address b) internal view returns(RouteLeg memory r){address[] memory p=new address[](2);p[0]=a;p[1]=b;return RouteLeg(address(adapter),p);}
    function none() internal pure returns(RouteLeg memory){return RouteLeg(address(0),new address[](0));}
    function fee(address token) internal view returns(TestFeeConversion memory){return TestFeeConversion(leg(address(input),token==address(0)?address(wrapped):token),none(),0.03 ether,token,feeRouter.feeConfigVersion());}
    function swap(TestFeeConversion memory f) internal returns(uint256 out){vm.prank(user);out=feeRouter.swapTokenToTokenWithFee(leg(address(input),address(output)),none(),10 ether,9.97 ether,block.timestamp+100,recipient,f);}
    function test_defaultFeeIsUsdt() public view {assertEq(feeRouter.defaultFeeToken(),USDT);}
    function test_otherToOther_convertsOnlyFeeIntoUsdt() public {
        uint256 out=swap(fee(USDT));
        assertEq(out,9.97 ether);assertEq(output.balanceOf(recipient),out);
        assertEq(IERC20(USDT).balanceOf(receiver),0.03 ether);
        assertEq(input.balanceOf(receiver),0);assertEq(output.balanceOf(receiver),0);
        assertEq(input.balanceOf(address(router)),0);assertEq(input.allowance(address(router),address(adapter)),0);
    }
    function test_feeConfigurationOwnerOnly() public {vm.prank(user);vm.expectRevert(AggregatedRouterV10.Unauthorized.selector);feeRouter.setDefaultFeeToken(FIST);}
    function test_feeConfigurationRejectsOtherAsset() public {vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);feeRouter.setDefaultFeeToken(address(input));}
    function test_feeConfigurationChangeRejectsOldQuote() public {
        TestFeeConversion memory f=fee(USDT);feeRouter.setDefaultFeeToken(FIST);
        vm.expectRevert(AggregatedRouterV10.FeeConfigurationChanged.selector);swap(f);assertEq(input.balanceOf(user),100 ether);
    }
    function test_feeConversionMinimumFailureRollsBackMainSwap() public {
        TestFeeConversion memory f=fee(USDT);f.minOut=0.04 ether;
        vm.expectRevert();swap(f);
        assertEq(input.balanceOf(user),100 ether);assertEq(output.balanceOf(recipient),0);assertEq(IERC20(USDT).balanceOf(receiver),0);
    }
    function test_feeConversionRejectsWrongInputPath() public {
        TestFeeConversion memory f=fee(USDT);f.first.path[0]=address(output);
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);swap(f);assertEq(input.balanceOf(user),100 ether);
    }
    function test_feeConversionPreservesPreexistingBalances() public {
        input.mint(address(router),4 ether);FeeTestToken(USDT).mint(address(router),5 ether);output.mint(address(router),6 ether);
        swap(fee(USDT));assertEq(input.balanceOf(address(router)),4 ether);assertEq(IERC20(USDT).balanceOf(address(router)),5 ether);assertEq(output.balanceOf(address(router)),6 ether);
    }
    function test_configuredFistFeeIsNotChargedTwice() public {feeRouter.setDefaultFeeToken(FIST);swap(fee(FIST));assertEq(IERC20(FIST).balanceOf(receiver),0.03 ether);assertEq(IERC20(USDT).balanceOf(receiver),0);}
    function test_configuredNativeBnbFeeIsNative() public {feeRouter.setDefaultFeeToken(address(0));swap(fee(address(0)));assertEq(receiver.balance,0.03 ether);assertEq(IERC20(address(wrapped)).balanceOf(receiver),0);}
    function test_otherToOtherV3_convertsFeeOnce() public {
        TestFeeConversion memory f=fee(USDT);vm.prank(user);
        uint256 out=feeRouter.swapTokenToTokenV3WithFee(address(adapter),abi.encodePacked(address(input),uint24(100),address(output)),10 ether,9.97 ether,block.timestamp+100,recipient,f);
        assertEq(out,9.97 ether);assertEq(IERC20(USDT).balanceOf(receiver),0.03 ether);assertEq(input.balanceOf(receiver),0);
    }
    function test_otherToOtherMulti_convertsFeeOnce() public {
        FeeTestToken transit=new FeeTestToken();
        RouteLeg[] memory legs=new RouteLeg[](2);legs[0]=leg(address(input),address(output));
        address[] memory path=new address[](3);path[0]=address(input);path[1]=address(transit);path[2]=address(output);legs[1]=RouteLeg(address(adapter),path);
        uint256[] memory amounts=new uint256[](2);amounts[0]=6 ether;amounts[1]=4 ether;
        TestFeeConversion memory f=fee(USDT);vm.prank(user);
        uint256 out=feeRouter.swapTokenToTokenMultiWithFee(legs,amounts,9.97 ether,block.timestamp+100,recipient,f);
        assertEq(out,9.97 ether);assertEq(IERC20(USDT).balanceOf(receiver),0.03 ether);assertEq(input.balanceOf(receiver),0);
    }
    function test_otherToOtherExactOutput_convertsFeeAndHonorsMaximum() public {
        TestFeeConversion memory f=fee(USDT);
        vm.prank(user);vm.expectRevert(AggregatedRouterV10.ExcessiveInput.selector);
        feeRouter.swapTokenForExactTokenWithFee(leg(address(input),address(output)),none(),9.97 ether,10 ether-1,block.timestamp+100,recipient,f);
        vm.prank(user);uint256 used=feeRouter.swapTokenForExactTokenWithFee(leg(address(input),address(output)),none(),9.97 ether,12 ether,block.timestamp+100,recipient,f);
        assertEq(used,10 ether);assertEq(output.balanceOf(recipient),9.97 ether);assertEq(IERC20(USDT).balanceOf(receiver),0.03 ether);assertEq(input.balanceOf(user),90 ether);
    }
    function test_wrongFeeOutputRejected() public {
        TestFeeConversion memory f=fee(USDT);f.first.path[1]=FIST;
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);swap(f);
        assertEq(input.balanceOf(user),100 ether);
    }
    function test_feeRouteMustBeRegistered() public {
        TestFeeConversion memory f=fee(USDT);
        f.first.adapter=address(new FeeTestAdapter(address(router),address(wrapped)));
        vm.expectRevert(AggregatedRouterV10.NoRoute.selector);swap(f);
    }
    function test_feeRateChangeInvalidatesQuote() public {
        TestFeeConversion memory f=fee(USDT);router.setFee(receiver,40);
        vm.expectRevert(AggregatedRouterV10.FeeConfigurationChanged.selector);swap(f);
    }
    function test_zeroFeeSupportsLegacyOtherToOther() public {
        router.setFee(receiver,0);vm.prank(user);
        uint256 out=router.swapTokenToToken(leg(address(input),address(output)),none(),10 ether,10 ether,block.timestamp+100,recipient);
        assertEq(out,10 ether);assertEq(input.balanceOf(receiver),0);assertEq(IERC20(USDT).balanceOf(receiver),0);
    }
    function test_zeroRoundedFeeHasNoFeeSwap() public {
        TestFeeConversion memory f=fee(USDT);vm.prank(user);
        uint256 out=feeRouter.swapTokenToTokenWithFee(leg(address(input),address(output)),none(),1,1,block.timestamp+100,recipient,f);
        assertEq(out,1);assertEq(IERC20(USDT).balanceOf(receiver),0);assertEq(input.balanceOf(address(router)),0);
    }
    function test_expiredQuoteRestoresBalances() public {
        vm.warp(1000);TestFeeConversion memory f=fee(USDT);vm.prank(user);
        vm.expectRevert(AggregatedRouterV10.Expired.selector);
        feeRouter.swapTokenToTokenWithFee(leg(address(input),address(output)),none(),10 ether,1,999,recipient,f);
        assertEq(input.balanceOf(user),100 ether);
    }
    function test_outputFeeMinimumIsNetAndRevertsAtomically() public {
        vm.prank(user);vm.expectRevert(AggregatedRouterV10.BelowMinimum.selector);
        router.swapTokenToToken(leg(address(input),USDT),none(),10 ether,10 ether,block.timestamp+100,recipient);
        assertEq(input.balanceOf(user),100 ether);assertEq(IERC20(USDT).balanceOf(receiver),0);assertEq(IERC20(USDT).balanceOf(recipient),0);
    }
    function test_invalidRecipientsRejected() public {
        vm.prank(user);vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.swapTokenToToken(leg(address(input),USDT),none(),10 ether,1,block.timestamp+100,address(router));
        vm.prank(user);vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);
        router.swapTokenToToken(leg(address(input),USDT),none(),10 ether,1,block.timestamp+100,address(0));
    }
    function test_feeConversionTwoLegPreservesTransitHistory() public {
        FeeTestToken transit=new FeeTestToken();transit.mint(address(router),5 ether);
        TestFeeConversion memory f=fee(USDT);f.first=leg(address(input),address(transit));f.second=leg(address(transit),USDT);
        swap(f);assertEq(transit.balanceOf(address(router)),5 ether);assertEq(IERC20(USDT).balanceOf(receiver),0.03 ether);
        assertEq(transit.allowance(address(router),address(adapter)),0);
    }
    function test_helperCannotExecuteDirectly() public {
        V10RouteEngine engine = router.routeEngine();
        vm.expectRevert(V10RouteEngine.DirectCall.selector);
        engine.tokenLegs(leg(address(input),USDT),none(),10 ether,1,recipient,block.timestamp+100);
    }
    function test_adapterMustBindToRouter() public {
        FeeTestAdapter wrong=new FeeTestAdapter(user,address(wrapped));
        vm.expectRevert(AggregatedRouterV10.InvalidPath.selector);router.setAdapter(address(wrong),true);
    }

}
