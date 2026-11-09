// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PancakeV3Adapter, V3ExactInputSingleParams} from "../src/PancakeV3Adapter.sol";

contract V3PartialInputToken is ERC20 {
    bool public keepAllowance;

    constructor() ERC20("V3 partial input fixture", "V3TEST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev 用于证明授权由适配器主动归零，而不只是被标准 transferFrom 恰好耗尽。
    function setKeepAllowance(bool enabled) external {
        keepAllowance = enabled;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (!keepAllowance) return super.transferFrom(from, to, amount);
        require(allowance(from, msg.sender) >= amount, "fixture: insufficient allowance");
        _transfer(from, to, amount);
        return true;
    }
}

contract V3PartialInputWrapped is V3PartialInputToken {
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "fixture: unwrap failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @dev 使用生产接口中的带 deadline tuple；同时兼容直接 BNB 与预包装 WBNB 输入。
contract V3PartialInputRouterMock {
    address public wrapped;
    address public sink;
    uint256 public outputAmount;
    bool public partialFill;
    uint256 public calls;

    function configure(address wrapped_, address sink_, uint256 outputAmount_) external {
        wrapped = wrapped_;
        sink = sink_;
        outputAmount = outputAmount_;
    }

    function setPartial(bool enabled) external {
        partialFill = enabled;
    }

    function exactInputSingle(V3ExactInputSingleParams calldata params) external payable returns (uint256) {
        require(block.timestamp <= params.deadline, "fixture: expired");
        require(outputAmount >= params.amountOutMinimum, "fixture: below minimum");
        uint256 consumed = partialFill ? params.amountIn / 2 : params.amountIn;
        calls += 1;
        if (msg.value != 0) {
            require(params.tokenIn == wrapped && msg.value == params.amountIn, "fixture: invalid native input");
            // 模拟池只消耗一部分 BNB；其余 BNB 留在底层路由中。
            (bool ok,) = payable(sink).call{value: consumed}("");
            require(ok, "fixture: native payment failed");
        } else {
            require(IERC20(params.tokenIn).transferFrom(msg.sender, sink, consumed), "fixture: input payment failed");
        }
        // 即使只消耗一半输入，仍产生足够输出；不能靠 minOut 发现此问题。
        V3PartialInputToken(params.tokenOut).mint(params.recipient, outputAmount);
        return outputAmount;
    }

    function refundETH() external payable {
        (bool ok,) = payable(msg.sender).call{value: address(this).balance}("");
        require(ok, "fixture: refund failed");
    }

    receive() external payable {}
}

/// @notice 不依赖分叉或 RPC。部分消耗必须整体回滚；全额消耗必须保留历史资产并撤销授权。
contract V10V3PartialInputTest is Test {
    address private constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address private constant USER = address(0xA11CE);
    address private constant RECIPIENT = address(0xB0B);
    address private constant SINK = address(0xC0FFEE);
    uint256 private constant INPUT = 20 ether;
    uint256 private constant OUTPUT = 3 ether;
    bytes4 private constant PARTIAL_INPUT = bytes4(keccak256("PartialInput()"));

    V3PartialInputToken private input;
    V3PartialInputToken private output;
    V3PartialInputWrapped private wrapped;
    V3PartialInputRouterMock private mockRouter;
    PancakeV3Adapter private adapter;

    function setUp() public {
        input = new V3PartialInputToken();
        output = new V3PartialInputToken();
        wrapped = new V3PartialInputWrapped();
        V3PartialInputRouterMock implementation = new V3PartialInputRouterMock();
        vm.etch(ROUTER, address(implementation).code);
        mockRouter = V3PartialInputRouterMock(payable(ROUTER));
        mockRouter.configure(address(wrapped), SINK, OUTPUT);
        adapter = new PancakeV3Adapter(address(this), address(wrapped), address(implementation));

        input.mint(USER, 1_000 ether);
        input.mint(address(adapter), 7 ether);
        input.mint(ROUTER, 13 ether);
        output.mint(address(adapter), 5 ether);
        output.mint(ROUTER, 17 ether);
        output.mint(RECIPIENT, 41 ether);
        wrapped.mint(address(adapter), 11 ether);
        wrapped.mint(ROUTER, 19 ether);
        vm.deal(address(wrapped), 1_000 ether);
        vm.deal(address(this), 100 ether);
        vm.deal(USER, 15 ether);
        vm.deal(RECIPIENT, 3 ether);
        vm.deal(SINK, 2 ether);
        vm.deal(address(adapter), 29 ether);
        vm.deal(ROUTER, 23 ether);
        vm.prank(USER);
        input.approve(address(adapter), INPUT);
    }

    function _path(address from, address to) private pure returns (bytes memory) {
        return abi.encodePacked(from, uint24(100), to);
    }

    /// @dev 覆盖付款人、收款人、适配器、底层路由、模拟池及 WBNB 储备的所有相关余额。
    function _stateHash() private view returns (bytes32) {
        address[7] memory accounts = [USER, RECIPIENT, address(adapter), ROUTER, SINK, address(this), address(wrapped)];
        bytes memory state = abi.encode(
            input.totalSupply(), output.totalSupply(), wrapped.totalSupply(),
            input.allowance(USER, address(adapter)),
            input.allowance(address(adapter), ROUTER),
            wrapped.allowance(address(adapter), ROUTER), mockRouter.calls()
        );
        for (uint256 i; i < accounts.length; ++i) {
            state = abi.encode(state, accounts[i].balance, input.balanceOf(accounts[i]), output.balanceOf(accounts[i]), wrapped.balanceOf(accounts[i]));
        }
        return keccak256(state);
    }

    function _assertHistoricalBalances() private view {
        assertEq(input.balanceOf(address(adapter)), 7 ether, "adapter historical input remains");
        assertEq(output.balanceOf(address(adapter)), 5 ether, "adapter historical output remains");
        assertEq(wrapped.balanceOf(address(adapter)), 11 ether, "adapter historical WBNB remains");
        assertEq(address(adapter).balance, 29 ether, "adapter historical BNB remains");
        assertEq(input.balanceOf(ROUTER), 13 ether, "router historical input remains");
        assertEq(output.balanceOf(ROUTER), 17 ether, "router historical output remains");
        assertEq(wrapped.balanceOf(ROUTER), 19 ether, "router historical WBNB remains");
        assertEq(ROUTER.balance, 23 ether, "router historical BNB remains");
        assertEq(input.allowance(address(adapter), ROUTER), 0, "input approval is explicitly cleared");
        assertEq(wrapped.allowance(address(adapter), ROUTER), 0, "WBNB approval is explicitly cleared");
    }

    function test_partialInput_tokenToToken_revertsAndRestoresAllBalances() public {
        mockRouter.setPartial(true);
        bytes32 before = _stateHash();
        vm.expectRevert(PARTIAL_INPUT);
        adapter.executeTokenToToken(USER, _path(address(input), address(output)), INPUT, OUTPUT, RECIPIENT, block.timestamp + 60);
        assertEq(_stateHash(), before, "partial ERC20 swap rolls back transfers, approvals and output");
    }

    function test_partialInput_sell_revertsAndRestoresAllBalances() public {
        mockRouter.setPartial(true);
        bytes32 before = _stateHash();
        vm.expectRevert(PARTIAL_INPUT);
        adapter.executeSell(USER, _path(address(input), address(wrapped)), INPUT, OUTPUT, RECIPIENT, block.timestamp + 60);
        assertEq(_stateHash(), before, "partial sell rolls back input, unwrap and native payment");
    }

    function test_partialInput_nativeBuy_revertsAndRestoresAllBalances() public {
        mockRouter.setPartial(true);
        bytes32 before = _stateHash();
        vm.expectRevert(PARTIAL_INPUT);
        adapter.executeBuy{value: INPUT}(_path(address(wrapped), address(output)), OUTPUT, RECIPIENT, block.timestamp + 60);
        assertEq(_stateHash(), before, "partial buy restores native payer and all router balances");
    }

    function test_fullInput_tokenToToken_preservesHistoryAndClearsAllowance() public {
        input.setKeepAllowance(true);
        uint256 received = adapter.executeTokenToToken(USER, _path(address(input), address(output)), INPUT, OUTPUT, RECIPIENT, block.timestamp + 60);
        assertEq(received, OUTPUT);
        assertEq(input.balanceOf(USER), 1_000 ether - INPUT, "payer spends exactly this input");
        assertEq(input.balanceOf(SINK), INPUT, "pool receives exactly this input");
        assertEq(output.balanceOf(RECIPIENT), 41 ether + OUTPUT, "recipient receives this output");
        assertEq(mockRouter.calls(), 1);
        _assertHistoricalBalances();
    }

    function test_fullInput_sell_preservesHistoryAndClearsAllowance() public {
        input.setKeepAllowance(true);
        uint256 received = adapter.executeSell(USER, _path(address(input), address(wrapped)), INPUT, OUTPUT, RECIPIENT, block.timestamp + 60);
        assertEq(received, OUTPUT);
        assertEq(input.balanceOf(USER), 1_000 ether - INPUT, "payer spends exactly this input");
        assertEq(input.balanceOf(SINK), INPUT, "pool receives exactly this input");
        assertEq(RECIPIENT.balance, 3 ether + OUTPUT, "only new WBNB output is unwrapped");
        assertEq(mockRouter.calls(), 1);
        _assertHistoricalBalances();
    }

    function test_fullInput_nativeBuy_preservesHistoryAndClearsAllowance() public {
        wrapped.setKeepAllowance(true);
        uint256 before = address(this).balance;
        uint256 received = adapter.executeBuy{value: INPUT}(_path(address(wrapped), address(output)), OUTPUT, RECIPIENT, block.timestamp + 60);
        assertEq(received, OUTPUT);
        assertEq(before - address(this).balance, INPUT, "native payer spends exactly this input");
        assertEq(SINK.balance - 2 ether + wrapped.balanceOf(SINK), INPUT, "pool consumes complete native or wrapped input");
        assertEq(output.balanceOf(RECIPIENT), 41 ether + OUTPUT);
        assertEq(mockRouter.calls(), 1);
        _assertHistoricalBalances();
    }

    receive() external payable {}
}
