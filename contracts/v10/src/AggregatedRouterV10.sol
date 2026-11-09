// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev 同 v9：一段路线 = 一个已登记适配器 + 该 DEX 上的代币路径（2-4 个代币）。
struct RouteLeg {
    address adapter;
    address[] path;
}

/// @dev Explicit fee-conversion route for swaps whose endpoints are neither FIST, USDT nor BNB.
struct FeeConversion {
    RouteLeg first;
    RouteLeg second;
    uint256 minOut;
    address feeToken;
    uint256 configVersion;
}

struct OneInchSwapDesc {
    address srcToken;
    address dstToken;
    address srcReceiver;
    address dstReceiver;
    uint256 amount;
    uint256 minReturnAmount;
    uint256 flags;
    bytes permit;
}

interface IV3SwapAdapter {
    function wethToken() external view returns (address);
    function decodePath(bytes calldata path) external pure returns (address tokenIn, address tokenOut, uint24 fee);
    function executeBuy(bytes calldata path, uint256 minOut, address to, uint256 deadline) external payable returns (uint256 received);
    function executeSell(address payer, bytes calldata path, uint256 amountIn, uint256 minOut, address to, uint256 deadline) external returns (uint256 received);
    /// @dev v10 新增：任意 ERC20 → ERC20 单池兑换（仅 v10 版 V3/Kyber 适配器提供）。
    function executeTokenToToken(address payer, bytes calldata path, uint256 amountIn, uint256 minOut, address to, uint256 deadline) external returns (uint256 received);
}

interface IOneInchGateway {
    function swap(address executor, OneInchSwapDesc calldata desc, bytes calldata permit, bytes calldata data, address to, uint256 minOut)
        external payable returns (uint256 received);
}

interface IOpenOceanGateway {
    function swap(bytes calldata desc, bytes calldata data, uint256 amount, address to, uint256 minOut)
        external payable returns (uint256 received);
}

interface IAggregatedAdapter {
    function router() external view returns (address);
    function weth() external view returns (address);
    function getPair(address tokenA, address tokenB) external view returns (address);
    function swapExactTokensForTokens(address payer, uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external returns (uint256 received);
    function swapExactTokensForEth(address payer, uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external returns (uint256 received);
    function swapExactEthForTokens(uint256 minOut, address[] calldata path, address to, uint256 deadline)
        external payable returns (uint256 received);
}

/// @dev Uniswap V2 / PancakeSwap V2 风格路由（FstSwap 0x1B6C…、Pancake 0x10ED…、BiSwap 0x3a6d…）。
interface IV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}

interface IV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function totalSupply() external view returns (uint256);
}

/// @title FstSwap v10 aggregator, fee-policy release 1.11.
/// @notice Fees only in FIST, USDT or native BNB, with input-asset priority.
/// If neither endpoint qualifies, WithFee methods atomically convert one input fee budget.
/// V2 exact-input supports deducted transfer taxes; exact-output and V3 reject taxed input.
/// Only the aggregator needs user approval. Gateways remain disabled. No liquidity methods.
contract AggregatedRouterV10 {
    string public constant VERSION = "1.11";
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant RESERVE_BPS = 5;
    address public constant FIST = 0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A;
    address public constant USDT = 0x55d398326f99059fF775485246999027B3197955;

    V10RouteEngine public immutable routeEngine;
    address public owner;
    address public pendingOwner;
    address public immutable WBNB;
    address public feeReceiver;
    uint16 public platformFeeBps;
    address public defaultFeeToken = USDT;
    uint256 public feeConfigVersion = 1;
    mapping(address => bool) public adapters;

    error Unauthorized();
    error NoRoute();
    error NoLiquidity();
    error InvalidPath();
    error Expired();
    error BelowMinimum();
    error RefundFailed();
    error Reentrancy();
    error UnderpaidFee();
    error ExcessiveInput();
    error FeeConversionRequired();
    error FeeConfigurationChanged();
    error GatewayDisabled();

    event RouteExecuted(address indexed user, address indexed token, bool buy, uint256 inAmount, uint256 outAmount);
    /// @notice v10 新增函数（代币⇄代币、精确输出）的统一成交事件；tokenIn/tokenOut 为 address(0) 表示 BNB。
    event SwapExecuted(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event AdapterSet(address indexed adapter, bool enabled);
    event FeeSet(address indexed receiver, uint16 bps);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event PlatformFeePaid(address indexed payer, address indexed token, uint256 amount);
    event DefaultFeeTokenSet(address indexed token, uint256 configVersion);

    uint256 private locked;

    constructor(address wbnb, address feeReceiver_, uint16 feeBps_, address owner_) {
        if (feeBps_ > 100 || owner_ == address(0) || feeReceiver_ == address(0) || wbnb == address(0)) revert InvalidPath();
        routeEngine = new V10RouteEngine();
        owner = owner_;
        WBNB = wbnb;
        feeReceiver = feeReceiver_;
        platformFeeBps = feeBps_;
    }

    // ------------------------------------------------------------------
    // 管理（与 v9 相同）
    // ------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (locked == 1) revert Reentrancy();
        locked = 1;
        _;
        locked = 0;
    }

    modifier validRecipient(address recipient) {
        if (recipient == address(0) || recipient == address(this)) revert InvalidPath();
        _;
    }

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    function setFee(address receiver, uint16 bps) external onlyOwner nonReentrant {
        if (bps > 100 || receiver == address(0) || receiver == address(this)) revert InvalidPath(); // 上限 1%
        feeReceiver = receiver;
        platformFeeBps = bps;
        ++feeConfigVersion;
        emit FeeSet(receiver, bps);
    }

    function setDefaultFeeToken(address token) external onlyOwner nonReentrant {
        if (token != address(0) && !_inputFeeToken(token)) revert InvalidPath();
        defaultFeeToken = token;
        emit DefaultFeeTokenSet(token, ++feeConfigVersion);
    }

    /// @return mode 0 = input, 1 = output, 2 = convert an input fee budget.
    function feePolicy(address tokenIn, address tokenOut) public view returns (uint8 mode, address token) {
        if (tokenIn == address(0) || _inputFeeToken(tokenIn)) return (0, tokenIn);
        if (tokenOut == address(0) || _inputFeeToken(tokenOut)) return (1, tokenOut);
        return (2, defaultFeeToken);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setAdapter(address adapter, bool enabled) external onlyOwner nonReentrant {
        if (enabled) {
            if (adapter.code.length == 0 || IAggregatedAdapter(adapter).router().code.length == 0) revert InvalidPath();
            (bool ok, bytes memory binding) = adapter.staticcall(abi.encodeWithSignature("aggregator()"));
            if (!ok || binding.length != 32 || abi.decode(binding, (address)) != address(this)) revert InvalidPath();
        }
        adapters[adapter] = enabled;
        emit AdapterSet(adapter, enabled);
    }

    function sweepToken(address token, address to) external onlyOwner nonReentrant {
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount != 0) IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    function sweepNative(address payable to) external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        if (amount != 0) _sendNative(to, amount);
        emit Swept(address(0), to, amount);
    }

    // ------------------------------------------------------------------
    // 内部工具
    // ------------------------------------------------------------------

    function _validAdapter(address adapter) private view returns (IAggregatedAdapter) {
        if (!adapters[adapter]) revert NoRoute();
        return IAggregatedAdapter(adapter);
    }

    /// @dev 同 v9：长度 2-4、无零地址、无重复、每一跳在该适配器自己的工厂上有交易对。
    function _checkPath(address adapter, address[] calldata path) private view {
        routeEngine.checkPath(adapter, path);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert RefundFailed();
    }

    function _inputFeeToken(address token) private pure returns (bool) {
        return token == FIST || token == USDT;
    }

    function _tokenFeeMode(address tokenIn, address tokenOut) private view returns (bool inputFee) {
        (uint8 mode,) = feePolicy(tokenIn, tokenOut);
        if (mode == 2 && platformFeeBps != 0) revert FeeConversionRequired();
        return mode != 1;
    }

    /// @dev The router owns only this swap's gross amount; never spend historical balances.
    function _settleToken(address token, uint256 gross, uint256 minOut, address recipient) private returns (uint256 received, uint256 fee) {
        fee = _takeTokenFee(token, gross);
        uint256 before = IERC20(token).balanceOf(recipient);
        uint256 routerBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(recipient, gross - fee);
        if (routerBefore - IERC20(token).balanceOf(address(this)) != gross - fee) revert UnderpaidFee();
        received = IERC20(token).balanceOf(recipient) - before;
        if (received < minOut) revert BelowMinimum();
    }

    function _checkFeeConversion(address input, FeeConversion calldata conversion) private view {
        if (conversion.configVersion != feeConfigVersion || conversion.feeToken != defaultFeeToken) revert FeeConfigurationChanged();
        if (conversion.minOut == 0) revert InvalidPath();
        _checkLegs(conversion.first, conversion.second);
        if (conversion.first.path[0] != input) revert InvalidPath();
        address target = _lastToken(conversion.first, conversion.second);
        address lastAdapter = conversion.second.path.length == 0 ? conversion.first.adapter : conversion.second.adapter;
        if (target != (defaultFeeToken == address(0) ? IAggregatedAdapter(lastAdapter).weth() : defaultFeeToken)) revert InvalidPath();
    }

    function _convertFee(address input, uint256 feeBudget, FeeConversion calldata conversion, uint256 deadline) private returns (uint256 paid) {
        _checkFeeConversion(input, conversion);
        if (feeBudget == 0) return 0;
        if (defaultFeeToken == address(0)) {
            paid = _tokenLegsToBnb(conversion.first, conversion.second, feeBudget, conversion.minOut, deadline);
            if (paid < conversion.minOut) revert BelowMinimum();
            _sendNative(feeReceiver, paid);
        } else {
            uint256 before = IERC20(defaultFeeToken).balanceOf(feeReceiver);
            _tokenLegs(conversion.first, conversion.second, feeBudget, conversion.minOut, feeReceiver, deadline);
            paid = IERC20(defaultFeeToken).balanceOf(feeReceiver) - before;
            if (paid < conversion.minOut) revert BelowMinimum();
        }
        emit PlatformFeePaid(msg.sender, defaultFeeToken, paid);
    }

    /// @dev Only FIST/USDT may be collected directly from ERC-20 input.
    function _takeTokenFee(address token, uint256 amount) private returns (uint256 fee) {
        fee = amount * platformFeeBps / BPS;
        if (fee == 0) return 0;
        if (!_inputFeeToken(token)) revert InvalidPath();
        uint256 receiverBefore = IERC20(token).balanceOf(feeReceiver);
        uint256 routerBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(feeReceiver, fee);
        if (routerBefore - IERC20(token).balanceOf(address(this)) != fee) revert UnderpaidFee();
        emit PlatformFeePaid(msg.sender, token, IERC20(token).balanceOf(feeReceiver) - receiverBefore);
    }

    /// @dev 从 from 拉取代币到本合约，返回实收（余额差，兼容转账税）。
    function _pull(address token, address from, uint256 amount) private returns (uint256 received) {
        if (amount == 0) revert InvalidPath();
        uint256 before = IERC20(token).balanceOf(address(this));
        uint256 payerBefore = IERC20(token).balanceOf(from);
        IERC20(token).safeTransferFrom(from, address(this), amount);
        if (IERC20(token).balanceOf(from) != payerBefore - amount) revert UnderpaidFee();
        received = IERC20(token).balanceOf(address(this)) - before;
        if (received == 0) revert InvalidPath();
    }

    function _lastToken(RouteLeg calldata first, RouteLeg calldata second) private pure returns (address) {
        return second.path.length == 0 ? first.path[first.path.length - 1] : second.path[second.path.length - 1];
    }

    function _checkLegs(RouteLeg calldata first, RouteLeg calldata second) private view {
        _validAdapter(first.adapter);
        _checkPath(first.adapter, first.path);
        if (second.path.length != 0) {
            _validAdapter(second.adapter);
            _checkPath(second.adapter, second.path);
            if (second.path[0] != first.path[first.path.length - 1]) revert InvalidPath();
            if (second.path[second.path.length - 1] == first.path[0]) revert InvalidPath();
            routeEngine.checkDisjoint(first, second);
        }
    }

    /// @dev 本合约持有 amountIn 个 first.path[0]，经 1-2 段 V2 兑换为代币，交付 to；返回 to 的到账（余额差）。
    function _tokenLegs(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        private returns (uint256 received)
    {
        return _execute(abi.encodeCall(V10RouteEngine.tokenLegs, (first, second, amountIn, minOut, to, deadline)));
    }

    /// @dev 本合约持有 amountIn 个代币，经 1-2 段兑换为 BNB 落到本合约；返回本合约 BNB 增量。
    function _tokenLegsToBnb(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOutGross, uint256 deadline)
        private returns (uint256 receivedBnb)
    {
        return _execute(abi.encodeCall(V10RouteEngine.tokenLegsToBnb, (first, second, amountIn, minOutGross, deadline)));
    }

    /// @dev BNB（budget）经 1-2 段兑换为代币交付 to。
    function _bnbLegs(RouteLeg calldata first, RouteLeg calldata second, uint256 budget, uint256 minOut, address to, uint256 deadline)
        private returns (uint256 received)
    {
        return _execute(abi.encodeCall(V10RouteEngine.bnbLegs, (first, second, budget, minOut, to, deadline)));
    }

    /// @dev 卖出所得 BNB：扣平台费、校验净额、转账。
    function _settleBnb(uint256 receivedBnb, uint256 minNet, address recipient, bool chargeFee) private returns (uint256 fee, uint256 net) {
        fee = chargeFee ? receivedBnb * platformFeeBps / BPS : 0;
        net = receivedBnb - fee;
        if (net < minNet) revert BelowMinimum();
        if (fee != 0) {
            _sendNative(feeReceiver, fee);
            emit PlatformFeePaid(msg.sender, address(0), fee);
        }
        _sendNative(recipient, net);
    }

    /// @dev Fixed constructor-created code only; helper has no storage or upgrade path.
    function _execute(bytes memory payload) private returns (uint256) {
        (bool ok, bytes memory result) = address(routeEngine).delegatecall(payload);
        if (!ok) { assembly ("memory-safe") { revert(add(result, 32), mload(result)) } }
        return abi.decode(result, (uint256));
    }

    function _routerOf(address adapter) private view returns (IV2Router) {
        return IV2Router(_validAdapter(adapter).router());
    }

    /// @dev 精确输出：倒推 1-2 段 V2 所需输入（DEX 路由 getAmountsIn）。
    function _amountInFor(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut) private view returns (uint256 amountIn) {
        return routeEngine.amountInFor(first, second, amountOut);
    }

    /// @dev 已知实际兑换用量 budget，按总投入口径加平台费：total = ceil(budget × BPS / (BPS − bps))。
    function _grossUp(uint256 budget) private view returns (uint256 total) {
        uint256 keep = BPS - platformFeeBps;
        total = (budget * BPS + keep - 1) / keep;
    }

    // ------------------------------------------------------------------
    // v9 函数（签名不变；卖出改为由本合约拉币，用户只需授权本路由器）
    // ------------------------------------------------------------------

    /// @notice BNB → 代币（V2 单段/两段跨 DEX）。msg.value × bps 为平台费，5bps 预留成交后退还。
    function swapBnbToToken(RouteLeg calldata first, RouteLeg calldata second, uint256 minOutToken, uint256 deadline, address recipient)
        external payable nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 receivedToken)
    {
        _checkLegs(first, second);
        uint256 fee = msg.value * platformFeeBps / BPS;
        uint256 reserve = msg.value * RESERVE_BPS / BPS;
        uint256 budget = msg.value - fee - reserve;
        if (fee != 0) {
            _sendNative(feeReceiver, fee);
            emit PlatformFeePaid(msg.sender, address(0), fee);
        }
        receivedToken = _bnbLegs(first, second, budget, minOutToken, recipient, deadline);
        if (receivedToken < minOutToken) revert BelowMinimum();
        if (reserve != 0) _sendNative(recipient, reserve);
        emit RouteExecuted(recipient, _lastToken(first, second), true, budget, receivedToken);
    }

    /// @notice 代币 → BNB（V2 单段/两段）。用户授权本路由器；minOutBnb 为扣平台费后的净额。
    function swapTokenToBnb(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOutBnb, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 receivedBnb)
    {
        _checkLegs(first, second);
        uint256 actualIn = _pull(first.path[0], msg.sender, amountIn);
        bool inputFee = _inputFeeToken(first.path[0]);
        uint256 fee = inputFee ? _takeTokenFee(first.path[0], actualIn) : 0;
        receivedBnb = _tokenLegsToBnb(first, second, actualIn - fee, minOutBnb, deadline);
        _settleBnb(receivedBnb, minOutBnb, recipient, !inputFee);
        emit RouteExecuted(recipient, first.path[0], false, amountIn, receivedBnb);
    }

    /// @notice 1inch 网关买入（与 v9 相同）。
    function swapBnbToTokenOneInch(address /* adapter */, address /* executor */, OneInchSwapDesc calldata /* desc */, bytes calldata /* data */, uint256 /* minOut */, uint256 /* deadline */, address /* recipient */)
        external payable returns (uint256 /* receivedToken */)
    {
        revert GatewayDisabled();
    }

    /// @notice 1inch 网关卖出（与 v9 相同：由网关自行拉币，spender = 网关适配器）。
    function swapTokenToBnbOneInch(address /* adapter */, address /* payer */, address /* executor */, OneInchSwapDesc calldata /* desc */, bytes calldata /* data */, uint256 /* minOut */, uint256 /* deadline */, address /* recipient */)
        external pure returns (uint256 /* receivedBnb */)
    {
        revert GatewayDisabled();
    }

    /// @notice OpenOcean 网关买入（与 v9 相同）。
    function swapBnbToTokenOpenOcean(address /* adapter */, bytes calldata /* desc */, bytes calldata /* data */, uint256 /* minOut */, uint256 /* deadline */, address /* recipient */)
        external payable returns (uint256 /* receivedBnb */)
    {
        revert GatewayDisabled();
    }

    /// @notice OpenOcean 网关卖出（与 v9 相同）。
    function swapTokenToBnbOpenOcean(address /* adapter */, bytes calldata /* desc */, bytes calldata /* data */, uint256 /* amountIn */, uint256 /* minOut */, uint256 /* deadline */, address /* recipient */)
        external pure returns (uint256 /* receivedBnb */)
    {
        revert GatewayDisabled();
    }

    /// @dev Multi：校验 1-3 段、池子不重复；同输入（sameIn）/ 同输出（sameOut）按需校验。返回 (tokenIn, tokenOut)。
    ///  v9 语义：买入要求同输出；卖出只要求同输入（各 DEX 的 WBNB 可不同）。
    function _checkMulti(RouteLeg[] calldata legs, uint256[] calldata amountsIn, bool sameIn, bool sameOut) private view returns (address inToken, address outToken) {
        if (legs.length == 0 || legs.length > 3 || legs.length != amountsIn.length) revert InvalidPath();
        for (uint256 i; i < legs.length; ++i) _validAdapter(legs[i].adapter);
        return routeEngine.checkMulti(legs, amountsIn, sameIn, sameOut);
    }

    /// @dev 单段校验 + 记录池地址（同一池在任意段/任意适配器重复出现即拒绝）。


    /// @notice 多池并行买入（与 v9 相同）：Σ amountsIn 必须等于 msg.value − 平台费 − 预留。
    function swapBnbToTokenMulti(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 totalMinOut, uint256 deadline, address recipient)
        external payable nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 receivedToken)
    {
        (, address outToken) = _checkMulti(legs, amountsIn, false, true);
        uint256 fee = msg.value * platformFeeBps / BPS;
        uint256 reserve = msg.value * RESERVE_BPS / BPS;
        uint256 budget = msg.value - fee - reserve;
        uint256 allocated;
        for (uint256 i; i < legs.length; ++i) {
            if (legs[i].path[0] != IAggregatedAdapter(legs[i].adapter).weth()) revert InvalidPath();
            allocated += amountsIn[i];
        }
        if (allocated != budget) revert InvalidPath();
        if (fee != 0) {
            _sendNative(feeReceiver, fee);
            emit PlatformFeePaid(msg.sender, address(0), fee);
        }
        uint256 before = IERC20(outToken).balanceOf(recipient);
        for (uint256 i; i < legs.length; ++i) {
            IAggregatedAdapter(legs[i].adapter).swapExactEthForTokens{value: amountsIn[i]}(0, legs[i].path, recipient, deadline);
        }
        receivedToken = IERC20(outToken).balanceOf(recipient) - before;
        if (receivedToken < totalMinOut) revert BelowMinimum();
        if (reserve != 0) _sendNative(recipient, reserve);
        emit RouteExecuted(recipient, outToken, true, budget, receivedToken);
    }

    /// @notice 多池并行卖出：本合约一次拉取 Σ amountsIn（用户授权本路由器），按段分配（税币差额计入最后一段）。
    function swapTokenToBnbMulti(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 totalMinOut, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 receivedBnb)
    {
        (address inToken,) = _checkMulti(legs, amountsIn, true, false);
        uint256 totalIn;
        for (uint256 i; i < legs.length; ++i) totalIn += amountsIn[i];
        uint256 actual = _pull(inToken, msg.sender, totalIn);
        bool inputFee = _inputFeeToken(inToken);
        uint256 budget = actual - (inputFee ? _takeTokenFee(inToken, actual) : 0);
        receivedBnb = _multiOutput(legs, amountsIn, totalIn, budget, address(0), address(this), deadline);
        _settleBnb(receivedBnb, totalMinOut, recipient, !inputFee);
        emit RouteExecuted(recipient, inToken, false, totalIn, receivedBnb);
    }

    /// @notice V3 单池买入（与 v9 相同）。
    function swapBnbToTokenV3(address adapter, bytes calldata path, uint256 minOutToken, uint256 deadline, address recipient)
        external payable nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 receivedToken)
    {
        if (minOutToken == 0) revert InvalidPath();
        if (!adapters[adapter]) revert NoRoute();
        IV3SwapAdapter v3 = IV3SwapAdapter(adapter);
        (address tokenIn,,) = v3.decodePath(path);
        if (tokenIn != v3.wethToken()) revert InvalidPath();
        uint256 fee = msg.value * platformFeeBps / BPS;
        uint256 reserve = msg.value * RESERVE_BPS / BPS;
        uint256 budget = msg.value - fee - reserve;
        if (fee != 0) {
            _sendNative(feeReceiver, fee);
            emit PlatformFeePaid(msg.sender, address(0), fee);
        }
        receivedToken = v3.executeBuy{value: budget}(path, minOutToken, recipient, deadline);
        if (receivedToken < minOutToken) revert BelowMinimum();
        if (reserve != 0) _sendNative(recipient, reserve);
        emit RouteExecuted(recipient, tokenIn, true, budget, receivedToken);
    }

    /// @notice V3 单池卖出：本合约拉币后交给适配器（用户授权本路由器）。
    function swapTokenToBnbV3(address adapter, bytes calldata path, uint256 amountIn, uint256 minOutBnb, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 receivedBnb)
    {
        if (minOutBnb == 0) revert InvalidPath();
        if (!adapters[adapter]) revert NoRoute();
        IV3SwapAdapter v3 = IV3SwapAdapter(adapter);
        (address tokenIn, address tokenOut,) = v3.decodePath(path);
        if (tokenOut != v3.wethToken()) revert InvalidPath();
        uint256 actualIn = _pull(tokenIn, msg.sender, amountIn);
        bool inputFee = _inputFeeToken(tokenIn);
        uint256 budget = actualIn - (inputFee ? _takeTokenFee(tokenIn, actualIn) : 0);
        IERC20(tokenIn).forceApprove(adapter, budget);
        uint256 before = address(this).balance;
        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        v3.executeSell(address(this), path, budget, minOutBnb, address(this), deadline);
        IERC20(tokenIn).forceApprove(adapter, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != inputBefore - budget) revert UnderpaidFee();
        receivedBnb = address(this).balance - before;
        _settleBnb(receivedBnb, minOutBnb, recipient, !inputFee);
        emit RouteExecuted(recipient, tokenOut, false, amountIn, receivedBnb);
    }

    // ------------------------------------------------------------------
    // v10 新增：代币 ⇄ 代币（精确输入）
    // ------------------------------------------------------------------

    /// @notice 代币 → 代币（V2 单段/两段跨 DEX）。平台费 = 实收输入 × bps（以输入代币支付）。
    /// @param minOut 收款人实际到账下限（余额差口径，兼容税币）
    function swapTokenToToken(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOut, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 received)
    {
        _checkLegs(first, second);
        address tokenIn = first.path[0];
        address tokenOut = _lastToken(first, second);
        bool inputFee = _tokenFeeMode(tokenIn, tokenOut);
        uint256 actualIn = _pull(tokenIn, msg.sender, amountIn);
        uint256 fee = inputFee ? _takeTokenFee(tokenIn, actualIn) : 0;
        received = _tokenLegs(first, second, actualIn - fee, minOut, inputFee ? recipient : address(this), deadline);
        if (!inputFee) (received, fee) = _settleToken(tokenOut, received, minOut, recipient);
        if (received < minOut) revert BelowMinimum();
        emit SwapExecuted(recipient, tokenIn, tokenOut, amountIn, received, fee);
    }

    /// @notice 代币 → 代币（V3 / Kyber 单池，path = tokenIn‖fee‖tokenOut）。
    function swapTokenToTokenV3(address adapter, bytes calldata path, uint256 amountIn, uint256 minOut, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 received)
    {
        if (minOut == 0 || !adapters[adapter]) revert InvalidPath();
        (address tokenIn, address tokenOut,) = IV3SwapAdapter(adapter).decodePath(path);
        bool inputFee = _tokenFeeMode(tokenIn, tokenOut);
        uint256 actualIn = _pull(tokenIn, msg.sender, amountIn);
        uint256 fee = inputFee ? _takeTokenFee(tokenIn, actualIn) : 0;
        uint256 budget = actualIn - fee;
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(adapter, budget);
        received = IV3SwapAdapter(adapter).executeTokenToToken(address(this), path, budget, minOut, inputFee ? recipient : address(this), deadline);
        IERC20(tokenIn).forceApprove(adapter, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != before - budget) revert UnderpaidFee();
        if (!inputFee) (received, fee) = _settleToken(tokenOut, received, minOut, recipient);
        if (received < minOut) revert BelowMinimum();
        emit SwapExecuted(recipient, tokenIn, tokenOut, amountIn, received, fee);
    }

    /// @notice 代币 → 代币多池并行（1-3 段，同输入同输出、池不重复）。amountsIn 为各段计划输入（含费），
    ///  实际按「实收 − 平台费」等比例分配，余数计入最后一段。
    function swapTokenToTokenMulti(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 totalMinOut, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 received)
    {
        (address inToken, address outToken) = _checkMulti(legs, amountsIn, true, true);
        if (inToken == outToken) revert InvalidPath();
        bool inputFee = _tokenFeeMode(inToken, outToken);
        uint256 totalIn;
        for (uint256 i; i < legs.length; ++i) totalIn += amountsIn[i];
        uint256 actual = _pull(inToken, msg.sender, totalIn);
        uint256 fee = inputFee ? _takeTokenFee(inToken, actual) : 0;
        received = _multiOutput(legs, amountsIn, totalIn, actual - fee, outToken, inputFee ? recipient : address(this), deadline);
        if (!inputFee) (received, fee) = _settleToken(outToken, received, totalMinOut, recipient);
        if (received < totalMinOut) revert BelowMinimum();
        emit SwapExecuted(recipient, inToken, outToken, totalIn, received, fee);
    }

    // ------------------------------------------------------------------
    // v10 新增：精确输出（V2 单段/两段；DEX 路由须支持 getAmountsIn，不支持 Thena / V3）
    // 输出代币若有转账税，到账可能低于 amountOut → 交易回滚（BelowMinimum）。
    // ------------------------------------------------------------------

    /// @notice BNB → 精确数量代币。msg.value 为最多支付（maxIn），多余 BNB 退还 msg.sender。
    ///  平台费 = 总投入 − 实际兑换用量（≈ 总投入 × bps），无 5bps 预留。
    function swapBnbForExactToken(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, uint256 deadline, address recipient)
        external payable nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 amountInUsed)
    {
        if (amountOut == 0) revert InvalidPath();
        _checkLegs(first, second);
        uint256 budget = _amountInFor(first, second, amountOut);
        amountInUsed = _grossUp(budget);
        if (amountInUsed > msg.value) revert ExcessiveInput();
        uint256 fee = amountInUsed * platformFeeBps / BPS;
        budget = amountInUsed - fee;
        if (fee != 0) {
            _sendNative(feeReceiver, fee);
            emit PlatformFeePaid(msg.sender, address(0), fee);
        }
        uint256 received = _bnbLegs(first, second, budget, amountOut, recipient, deadline);
        if (received < amountOut) revert BelowMinimum();
        if (msg.value > amountInUsed) _sendNative(msg.sender, msg.value - amountInUsed);
        emit SwapExecuted(recipient, address(0), _lastToken(first, second), amountInUsed, received, fee);
    }

    /// @notice 代币 → 精确数量 BNB（净额，已扣平台费）。实际拉取 ≤ amountInMax。
    function swapTokenForExactBnb(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, uint256 amountInMax, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 amountInUsed)
    {
        if (amountOut == 0) revert InvalidPath();
        _checkLegs(first, second);
        address tokenIn = first.path[0];
        bool inputFee = _inputFeeToken(tokenIn);
        uint256 gross = inputFee ? amountOut : _grossUp(amountOut);
        uint256 budget = _amountInFor(first, second, gross);
        amountInUsed = inputFee ? _grossUp(budget) : budget;
        if (amountInUsed > amountInMax) revert ExcessiveInput();
        uint256 actualIn = _pull(tokenIn, msg.sender, amountInUsed);
        if (actualIn != amountInUsed) revert UnderpaidFee();
        uint256 fee = inputFee ? _takeTokenFee(tokenIn, actualIn) : 0;
        uint256 receivedBnb = _tokenLegsToBnb(first, second, actualIn - fee, gross, deadline);
        (uint256 outputFee, uint256 net) = _settleBnb(receivedBnb, amountOut, recipient, !inputFee);
        emit SwapExecuted(recipient, tokenIn, address(0), amountInUsed, net, inputFee ? fee : outputFee);
    }

    /// @notice 代币 → 精确数量代币。平台费以输入代币收取（总投入口径）。实际拉取 ≤ amountInMax。
    function swapTokenForExactToken(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, uint256 amountInMax, uint256 deadline, address recipient)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 amountInUsed)
    {
        if (amountOut == 0) revert InvalidPath();
        _checkLegs(first, second);
        address tokenIn = first.path[0];
        address tokenOut = _lastToken(first, second);
        bool inputFee = _tokenFeeMode(tokenIn, tokenOut);
        uint256 gross = inputFee ? amountOut : _grossUp(amountOut);
        uint256 budget = _amountInFor(first, second, gross);
        amountInUsed = inputFee ? _grossUp(budget) : budget;
        if (amountInUsed > amountInMax) revert ExcessiveInput();
        uint256 actualIn = _pull(tokenIn, msg.sender, amountInUsed);
        if (actualIn != amountInUsed) revert UnderpaidFee();
        uint256 fee = inputFee ? _takeTokenFee(tokenIn, actualIn) : 0;
        uint256 received = _tokenLegs(first, second, actualIn - fee, gross, inputFee ? recipient : address(this), deadline);
        if (!inputFee) (received, fee) = _settleToken(tokenOut, received, amountOut, recipient);
        if (received < amountOut) revert BelowMinimum();
        emit SwapExecuted(recipient, tokenIn, tokenOut, amountInUsed, received, fee);
    }

    // Explicit fee conversion: the main trade and fee trade revert atomically.
    function swapTokenToTokenWithFee(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOut, uint256 deadline, address recipient, FeeConversion calldata conversion)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 received)
    {
        _checkLegs(first, second);
        _checkFeePools(first, second, conversion);
        address tokenIn = first.path[0];
        address tokenOut = _lastToken(first, second);
        _requireConversion(tokenIn, tokenOut, conversion);
        uint256 actual = _pull(tokenIn, msg.sender, amountIn);
        uint256 budget = actual * platformFeeBps / BPS;
        received = _tokenLegs(first, second, actual - budget, minOut, recipient, deadline);
        if (received < minOut) revert BelowMinimum();
        uint256 paid = _convertFee(tokenIn, budget, conversion, deadline);
        emit SwapExecuted(recipient, tokenIn, tokenOut, amountIn, received, paid);
    }

    function swapTokenToTokenV3WithFee(address adapter, bytes calldata path, uint256 amountIn, uint256 minOut, uint256 deadline, address recipient, FeeConversion calldata conversion)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 received)
    {
        if (!adapters[adapter] || minOut == 0) revert InvalidPath();
        (address tokenIn, address tokenOut,) = IV3SwapAdapter(adapter).decodePath(path);
        _requireConversion(tokenIn, tokenOut, conversion);
        uint256 actual = _pull(tokenIn, msg.sender, amountIn);
        uint256 feeBudget = actual * platformFeeBps / BPS;
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(adapter, actual - feeBudget);
        received = IV3SwapAdapter(adapter).executeTokenToToken(address(this), path, actual - feeBudget, minOut, recipient, deadline);
        IERC20(tokenIn).forceApprove(adapter, 0);
        if (IERC20(tokenIn).balanceOf(address(this)) != before - (actual - feeBudget)) revert UnderpaidFee();
        if (received < minOut) revert BelowMinimum();
        uint256 paid = _convertFee(tokenIn, feeBudget, conversion, deadline);
        emit SwapExecuted(recipient, tokenIn, tokenOut, amountIn, received, paid);
    }

    function swapTokenToTokenMultiWithFee(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 totalMinOut, uint256 deadline, address recipient, FeeConversion calldata conversion)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 received)
    {
        (address tokenIn, address tokenOut) = _checkMulti(legs, amountsIn, true, true);
        _requireConversion(tokenIn, tokenOut, conversion);
        for (uint256 i; i < legs.length; ++i) {
            routeEngine.checkDisjoint(legs[i], conversion.first);
            if (conversion.second.path.length != 0) routeEngine.checkDisjoint(legs[i], conversion.second);
        }
        uint256 total;
        for (uint256 i; i < amountsIn.length; ++i) total += amountsIn[i];
        uint256 actual = _pull(tokenIn, msg.sender, total);
        uint256 feeBudget = actual * platformFeeBps / BPS;
        received = _multiOutput(legs, amountsIn, total, actual - feeBudget, tokenOut, recipient, deadline);
        if (received < totalMinOut) revert BelowMinimum();
        uint256 paid = _convertFee(tokenIn, feeBudget, conversion, deadline);
        emit SwapExecuted(recipient, tokenIn, tokenOut, total, received, paid);
    }

    function swapTokenForExactTokenWithFee(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, uint256 amountInMax, uint256 deadline, address recipient, FeeConversion calldata conversion)
        external nonReentrant ensure(deadline) validRecipient(recipient) returns (uint256 amountInUsed)
    {
        if (amountOut == 0) revert InvalidPath();
        _checkLegs(first, second);
        _checkFeePools(first, second, conversion);
        address tokenIn = first.path[0];
        address tokenOut = _lastToken(first, second);
        _requireConversion(tokenIn, tokenOut, conversion);
        amountInUsed = _grossUp(_amountInFor(first, second, amountOut));
        if (amountInUsed > amountInMax) revert ExcessiveInput();
        uint256 actual = _pull(tokenIn, msg.sender, amountInUsed);
        if (actual != amountInUsed) revert UnderpaidFee();
        uint256 feeBudget = actual * platformFeeBps / BPS;
        uint256 received = _tokenLegs(first, second, actual - feeBudget, amountOut, recipient, deadline);
        if (received < amountOut) revert BelowMinimum();
        uint256 paid = _convertFee(tokenIn, feeBudget, conversion, deadline);
        emit SwapExecuted(recipient, tokenIn, tokenOut, amountInUsed, received, paid);
    }

    function _checkFeePools(RouteLeg calldata first, RouteLeg calldata second, FeeConversion calldata conversion) private view {
        routeEngine.checkDisjoint(first, conversion.first);
        if (conversion.second.path.length != 0) routeEngine.checkDisjoint(first, conversion.second);
        if (second.path.length != 0) {
            routeEngine.checkDisjoint(second, conversion.first);
            if (conversion.second.path.length != 0) routeEngine.checkDisjoint(second, conversion.second);
        }
    }

    function _requireConversion(address tokenIn, address tokenOut, FeeConversion calldata conversion) private view {
        (uint8 mode,) = feePolicy(tokenIn, tokenOut);
        if (mode != 2 || tokenIn == tokenOut) revert InvalidPath();
        _checkFeeConversion(tokenIn, conversion);
    }

    /// @notice Uncharged DEX quote for the fee budget. The caller must set a separate minOut.
    function quoteFeeConversion(address input, uint256 feeBudget, FeeConversion calldata conversion) public view returns (uint256 feeAmount) {
        _checkFeeConversion(input, conversion);
        if (feeBudget == 0) return 0;
        return routeEngine.amountOutFor(conversion.first, conversion.second, feeBudget);
    }

    function quoteExactOutputWithFee(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, FeeConversion calldata conversion)
        external view returns (uint256 amountIn, uint256 feeBudget, address feeToken, uint256 feeAmount)
    {
        if (amountOut == 0) revert InvalidPath();
        _checkLegs(first, second);
        _checkFeePools(first, second, conversion);
        _requireConversion(first.path[0], _lastToken(first, second), conversion);
        amountIn = _grossUp(_amountInFor(first, second, amountOut));
        feeBudget = amountIn * platformFeeBps / BPS;
        feeToken = defaultFeeToken;
        feeAmount = quoteFeeConversion(first.path[0], feeBudget, conversion);
    }

    function _multiOutput(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 totalIn, uint256 budget, address outToken, address recipient, uint256 deadline)
        private returns (uint256 received)
    {
        return _execute(abi.encodeCall(V10RouteEngine.multiOutput, (legs, amountsIn, totalIn, budget, outToken, recipient, deadline)));
    }

    // ------------------------------------------------------------------
    // v10 新增：只读（前端报价 / 池子信息全部经本合约，不再直连 DEX 路由）
    // ------------------------------------------------------------------

    /// @notice 经已登记 V2 适配器背后的 DEX 路由报价（不含平台费）。
    function getAmountsOutVia(address adapter, uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        return _routerOf(adapter).getAmountsOut(amountIn, path);
    }

    function getAmountsInVia(address adapter, uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts) {
        return _routerOf(adapter).getAmountsIn(amountOut, path);
    }

    /// @notice 精确输出报价（与成交函数同一算法）。mode：0 = BNB→代币（返回需付 msg.value），
    ///  1 = 代币→BNB（amountOut 为净 BNB，返回需投入代币），2 = 代币→代币（返回需投入代币，含费）。
    function quoteExactOutput(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut, uint8 mode)
        external view returns (uint256 amountIn, uint256 fee)
    {
        if (amountOut == 0 || mode > 2) revert InvalidPath();
        _checkLegs(first, second);
        bool inputFee = mode == 0 || (mode == 1 ? _inputFeeToken(first.path[0]) : _tokenFeeMode(first.path[0], _lastToken(first, second)));
        uint256 gross = inputFee ? amountOut : _grossUp(amountOut);
        uint256 budget = _amountInFor(first, second, gross);
        amountIn = inputFee ? _grossUp(budget) : budget;
        fee = (inputFee ? amountIn : gross) * platformFeeBps / BPS;
    }

    /// @notice 交易对信息（储备 / 总量 / 账户 LP 余额），供报价与价格影响参考。
    function getPairInfo(address adapter, address tokenA, address tokenB, address account)
        external view returns (address, address, address, uint112, uint112, uint256, uint256)
    {
        _validAdapter(adapter);
        return routeEngine.getPairInfo(adapter, tokenA, tokenB, account);
    }
    function balancesOf(address account, address[] calldata tokens) external view returns (uint256[] memory) {
        return routeEngine.balancesOf(account, tokens);
    }
    function allowancesOf(address account, address[] calldata tokens) external view returns (uint256[] memory) {
        return routeEngine.allowancesOf(account, address(this), tokens);
    }

    receive() external payable {}
}

/// @dev Immutable helper: read-only validation/quotes, plus fixed delegate-only swap routines.
/// The calling aggregator retains custody, adapter authorization, fee policy and reentrancy lock.
contract V10RouteEngine {
    using SafeERC20 for IERC20;
    address private immutable SELF = address(this);
    error UnderpaidFee();
    error DirectCall();
    modifier onlyDelegateCall() {
        if (address(this) == SELF) revert DirectCall();
        _;
    }

    error InvalidPath();
    error NoLiquidity();
    function checkPath(address adapter, address[] calldata path) public view {
        if (path.length < 2 || path.length > 4) revert InvalidPath();
        for (uint256 i; i < path.length; ++i) {
            if (path[i] == address(0)) revert InvalidPath();
            for (uint256 j = i + 1; j < path.length; ++j) {
                if (path[i] == path[j]) revert InvalidPath();
            }
        }
        for (uint256 i; i < path.length - 1; ++i) {
            if (IAggregatedAdapter(adapter).getPair(path[i], path[i + 1]) == address(0)) revert NoLiquidity();
        }
    }
    /// @dev Quotes assume independent pools; reject intra-trade price interference.
    function checkDisjoint(RouteLeg calldata a, RouteLeg calldata b) external view {
        for (uint256 i; i + 1 < a.path.length; ++i) {
            address pool = IAggregatedAdapter(a.adapter).getPair(a.path[i], a.path[i+1]);
            for (uint256 j; j + 1 < b.path.length; ++j) {
                if (pool == IAggregatedAdapter(b.adapter).getPair(b.path[j], b.path[j+1])) revert InvalidPath();
            }
        }
    }
    function checkMulti(RouteLeg[] calldata legs, uint256[] calldata amountsIn, bool sameIn, bool sameOut) external view returns (address inToken, address outToken) {
        uint256 n = legs.length;
        if (n == 0 || n > 3 || n != amountsIn.length) revert InvalidPath();
        address[] memory seenPools = new address[](12); // 3 段 × ≤4 跳
        uint256 seenCount;
        inToken = legs[0].path.length == 0 ? address(0) : legs[0].path[0];
        outToken = legs[0].path.length == 0 ? address(0) : legs[0].path[legs[0].path.length - 1];
        for (uint256 i; i < n; ++i) {
            if (amountsIn[i] == 0) revert InvalidPath();
            seenCount = _checkMultiLeg(legs[i], seenPools, seenCount);
            if (sameIn && legs[i].path[0] != inToken) revert InvalidPath();
            if (sameOut && legs[i].path[legs[i].path.length - 1] != outToken) revert InvalidPath();
        }
    }
    function _checkMultiLeg(RouteLeg calldata leg, address[] memory seenPools, uint256 seenCount) private view returns (uint256) {
        IAggregatedAdapter adapter = IAggregatedAdapter(leg.adapter);
        checkPath(leg.adapter, leg.path);
        for (uint256 h; h + 1 < leg.path.length; ++h) {
            address pool = adapter.getPair(leg.path[h], leg.path[h + 1]);
            if (pool == address(0)) revert NoLiquidity();
            for (uint256 k; k < seenCount; ++k) {
                if (seenPools[k] == pool) revert InvalidPath();
            }
            seenPools[seenCount++] = pool;
        }
        return seenCount;
    }

    function amountInFor(RouteLeg calldata first, RouteLeg calldata second, uint256 amountOut) external view returns (uint256 amountIn) {
        uint256 need = amountOut;
        if (second.path.length != 0) need = IV2Router(IAggregatedAdapter(second.adapter).router()).getAmountsIn(need, second.path)[0];
        amountIn = IV2Router(IAggregatedAdapter(first.adapter).router()).getAmountsIn(need, first.path)[0];
    }
    function amountOutFor(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn) external view returns (uint256 amountOut) {
        uint256[] memory amounts = IV2Router(IAggregatedAdapter(first.adapter).router()).getAmountsOut(amountIn, first.path);
        amountOut = amounts[amounts.length - 1];
        if (second.path.length != 0) {
            amounts = IV2Router(IAggregatedAdapter(second.adapter).router()).getAmountsOut(amountOut, second.path);
            amountOut = amounts[amounts.length - 1];
        }
    }
    function getPairInfo(address adapter, address tokenA, address tokenB, address account)
        external view returns (address pair, address token0, address token1, uint112 reserve0, uint112 reserve1, uint256 totalSupply, uint256 lpBalance)
    {
        pair = IAggregatedAdapter(adapter).getPair(tokenA, tokenB);
        if (pair == address(0)) return (pair, token0, token1, 0, 0, 0, 0);
        token0 = IV2Pair(pair).token0();
        token1 = IV2Pair(pair).token1();
        (reserve0, reserve1,) = IV2Pair(pair).getReserves();
        totalSupply = IV2Pair(pair).totalSupply();
        if (account != address(0)) lpBalance = IERC20(pair).balanceOf(account);
    }

    /// @notice 批量余额（address(0) = BNB）。
    function balancesOf(address account, address[] calldata tokens) external view returns (uint256[] memory out) {
        out = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            out[i] = tokens[i] == address(0) ? account.balance : IERC20(tokens[i]).balanceOf(account);
        }
    }

    /// @notice 批量授权额度（spender = 本路由器）。
    function allowancesOf(address account, address spender, address[] calldata tokens) external view returns (uint256[] memory out) {
        out = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            out[i] = tokens[i] == address(0) ? type(uint256).max : IERC20(tokens[i]).allowance(account, spender);
        }
    }


    function tokenLegs(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external payable onlyDelegateCall returns (uint256 received)
    {
        uint256 inputBefore = IERC20(first.path[0]).balanceOf(address(this));
        IERC20(first.path[0]).forceApprove(first.adapter, amountIn);
        if (second.path.length == 0) {
            received = IAggregatedAdapter(first.adapter).swapExactTokensForTokens(address(this), amountIn, minOut, first.path, to, deadline);
        } else {
            uint256 transit = IAggregatedAdapter(first.adapter).swapExactTokensForTokens(address(this), amountIn, 0, first.path, address(this), deadline);
            uint256 transitBefore = IERC20(second.path[0]).balanceOf(address(this));
            IERC20(second.path[0]).forceApprove(second.adapter, transit);
            received = IAggregatedAdapter(second.adapter).swapExactTokensForTokens(address(this), transit, minOut, second.path, to, deadline);
            IERC20(second.path[0]).forceApprove(second.adapter, 0);
            if (IERC20(second.path[0]).balanceOf(address(this)) != transitBefore - transit) revert UnderpaidFee();
        }
        IERC20(first.path[0]).forceApprove(first.adapter, 0);
        if (IERC20(first.path[0]).balanceOf(address(this)) != inputBefore - amountIn) revert UnderpaidFee();
    }

    function tokenLegsToBnb(RouteLeg calldata first, RouteLeg calldata second, uint256 amountIn, uint256 minOutGross, uint256 deadline)
        external payable onlyDelegateCall returns (uint256 receivedBnb)
    {
        uint256 before = address(this).balance;
        uint256 inputBefore = IERC20(first.path[0]).balanceOf(address(this));
        IERC20(first.path[0]).forceApprove(first.adapter, amountIn);
        if (second.path.length == 0) {
            IAggregatedAdapter(first.adapter).swapExactTokensForEth(address(this), amountIn, minOutGross, first.path, address(this), deadline);
        } else {
            uint256 transit = IAggregatedAdapter(first.adapter).swapExactTokensForTokens(address(this), amountIn, 0, first.path, address(this), deadline);
            uint256 transitBefore = IERC20(second.path[0]).balanceOf(address(this));
            IERC20(second.path[0]).forceApprove(second.adapter, transit);
            IAggregatedAdapter(second.adapter).swapExactTokensForEth(address(this), transit, minOutGross, second.path, address(this), deadline);
            IERC20(second.path[0]).forceApprove(second.adapter, 0);
            if (IERC20(second.path[0]).balanceOf(address(this)) != transitBefore - transit) revert UnderpaidFee();
        }
        IERC20(first.path[0]).forceApprove(first.adapter, 0);
        if (IERC20(first.path[0]).balanceOf(address(this)) != inputBefore - amountIn) revert UnderpaidFee();
        receivedBnb = address(this).balance - before;
    }

    function bnbLegs(RouteLeg calldata first, RouteLeg calldata second, uint256 budget, uint256 minOut, address to, uint256 deadline)
        external payable onlyDelegateCall returns (uint256 received)
    {
        if (first.path[0] != IAggregatedAdapter(first.adapter).weth()) revert InvalidPath();
        if (second.path.length == 0) {
            received = IAggregatedAdapter(first.adapter).swapExactEthForTokens{value: budget}(minOut, first.path, to, deadline);
        } else {
            uint256 transit = IAggregatedAdapter(first.adapter).swapExactEthForTokens{value: budget}(0, first.path, address(this), deadline);
            uint256 transitBefore = IERC20(second.path[0]).balanceOf(address(this));
            IERC20(second.path[0]).forceApprove(second.adapter, transit);
            received = IAggregatedAdapter(second.adapter).swapExactTokensForTokens(address(this), transit, minOut, second.path, to, deadline);
            IERC20(second.path[0]).forceApprove(second.adapter, 0);
            if (IERC20(second.path[0]).balanceOf(address(this)) != transitBefore - transit) revert UnderpaidFee();
        }
    }

    function multiOutput(RouteLeg[] calldata legs, uint256[] calldata amountsIn, uint256 totalIn, uint256 budget, address outToken, address recipient, uint256 deadline)
        external payable onlyDelegateCall returns (uint256 received)
    {
        address inToken = legs[0].path[0];
        uint256 before = outToken == address(0) ? recipient.balance : IERC20(outToken).balanceOf(recipient);
        uint256 inputBefore = IERC20(inToken).balanceOf(address(this));
        uint256 used;
        for (uint256 i; i < legs.length; ++i) {
            uint256 part = i + 1 == legs.length ? budget - used : amountsIn[i] * budget / totalIn;
            used += part;
            IERC20(inToken).forceApprove(legs[i].adapter, part);
            if (outToken == address(0)) IAggregatedAdapter(legs[i].adapter).swapExactTokensForEth(address(this), part, 0, legs[i].path, recipient, deadline);
            else IAggregatedAdapter(legs[i].adapter).swapExactTokensForTokens(address(this), part, 0, legs[i].path, recipient, deadline);
            IERC20(inToken).forceApprove(legs[i].adapter, 0);
        }
        if (IERC20(inToken).balanceOf(address(this)) != inputBefore - budget) revert UnderpaidFee();
        received = (outToken == address(0) ? recipient.balance : IERC20(outToken).balanceOf(recipient)) - before;
    }
}
