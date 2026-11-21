// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Constructor-only, bounded BSC quote evaluator for eth_call without a
/// target address. It never executes a swap or deploys a persistent helper.
/// Route admission, tax verification, fees and minimums belong to the caller.
contract SwapQuotePipeline {
    struct Edge { uint8 adapter; address tokenIn; address tokenOut; uint24 fee; }
    struct Step { uint8 edge; uint16 prior; uint256 input; }
    struct Call { address target; bytes callData; }
    struct Result { bool success; bytes returnData; }
    struct Cache { bytes32[] keys; uint256[] values; uint256 length; }
    struct Pending {
        Call[] calls;
        uint256[] slots;
        uint256[] amounts;
        uint8[] adapters;
        uint256 length;
    }

    address private constant MULTICALL = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address private constant ROUTER = 0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7;
    address private constant FST = 0xdFabF87EE3A9A4cEdda43D3f8035C89E1C9438b7;
    address private constant PANCAKE = 0x9De342bDFFB5da04D9865f4cd9846D22560D253a;
    address private constant V3 = 0xE381c967c14b0c6ef82944E0e4b4272D24dd8957;
    uint256 private constant GAS_BUDGET = 12_000_000;
    uint256 private constant FINISH_RESERVE = 200_000;
    uint256 private constant MAX_INITCODE = 49_152;
    uint256 private constant MAX_RETURN = 32_768;
    bytes4 private constant TRY_AGGREGATE = bytes4(keccak256("tryAggregate(bool,(address,bytes)[])"));
    bytes4 private constant V2_QUOTE = bytes4(keccak256("getAmountsOutVia(address,uint256,address[])"));
    bytes4 private constant V3_QUOTE = bytes4(keccak256("quoteExactIn(bytes,uint256)"));

    error InvalidProgram();
    error InvalidQuote();
    error QuoteBudget();

    constructor(uint256 expectedBlock, Edge[] memory edges, Step[] memory steps, uint16[4] memory bounds) {
        uint256 initialGas = gasleft();
        uint256 initSize;
        assembly ("memory-safe") { initSize := codesize() }
        if (block.chainid != 56 || block.number != expectedBlock || initSize > MAX_INITCODE
            || edges.length == 0 || edges.length > 80 || steps.length == 0 || steps.length > 256
            || bounds[0] != 0 || bounds[1] > bounds[2] || bounds[2] > bounds[3] || bounds[3] != steps.length) revert InvalidProgram();
        for (uint256 n; n < edges.length; ++n) _validateEdge(edges[n]);
        uint256[] memory outputs = new uint256[](steps.length);
        Cache memory cache = Cache(new bytes32[](steps.length), new uint256[](steps.length), 0);
        for (uint256 depth; depth < 3; ++depth) _layer(edges, steps, bounds, depth, outputs, cache, initialGas);
        if (initialGas - gasleft() > GAS_BUDGET) revert QuoteBudget();
        bytes memory encoded = abi.encode(block.number, outputs, cache.length);
        assembly ("memory-safe") { return(add(encoded, 32), mload(encoded)) }
    }

    function _mainstream(address token) private pure returns (bool) {
        return token == 0x55d398326f99059fF775485246999027B3197955
            || token == 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
            || token == 0x2170Ed0880ac9A755fd29B2688956BD959F933F8
            || token == 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c
            || token == 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
            || token == 0x0efb5FD2402A0967B92551d6AF54De148504A115;
    }

    function _validateEdge(Edge memory edge) private pure {
        if (!_mainstream(edge.tokenIn) || !_mainstream(edge.tokenOut) || edge.tokenIn == edge.tokenOut
            || edge.adapter < 1 || edge.adapter > 3) revert InvalidProgram();
        if (edge.adapter == 3) {
            if (edge.fee != 100 && edge.fee != 500 && edge.fee != 2500 && edge.fee != 10000) revert InvalidProgram();
        } else if (edge.fee != 0) revert InvalidProgram();
    }

    function _call(Edge memory edge, uint256 amount) private pure returns (Call memory) {
        if (edge.adapter == 3) return Call(V3, abi.encodeWithSelector(V3_QUOTE, abi.encodePacked(edge.tokenIn, edge.fee, edge.tokenOut), amount));
        address[] memory path = new address[](2);
        path[0] = edge.tokenIn;
        path[1] = edge.tokenOut;
        return Call(ROUTER, abi.encodeWithSelector(V2_QUOTE, edge.adapter == 1 ? FST : PANCAKE, amount, path));
    }

    function _layer(Edge[] memory edges, Step[] memory steps, uint16[4] memory bounds, uint256 depth,
        uint256[] memory outputs, Cache memory cache, uint256 initialGas) private {
        uint256 start = bounds[depth];
        uint256 end = bounds[depth + 1];
        uint256 count = end - start;
        if (count == 0) return;
        Pending memory pending = Pending(new Call[](count), new uint256[](count), new uint256[](count), new uint8[](count), 0);
        uint256[] memory resultSlots = new uint256[](count);
        for (uint256 n = start; n < end; ++n) {
            Step memory step = steps[n];
            if (step.edge >= edges.length) revert InvalidProgram();
            uint256 amount;
            if (step.prior == type(uint16).max) {
                amount = step.input;
            } else {
                if (depth == 0 || step.input != 0 || step.prior < bounds[depth - 1] || step.prior >= start) revert InvalidProgram();
                amount = outputs[step.prior];
            }
            if (amount == 0) revert InvalidProgram();
            Edge memory edge = edges[step.edge];
            bytes32 key = keccak256(abi.encode(edge, amount));
            uint256 slot;
            for (; slot < cache.length; ++slot) if (cache.keys[slot] == key) break;
            if (slot == cache.length) {
                if (pending.length == 80) revert InvalidProgram();
                cache.keys[slot] = key;
                ++cache.length;
                uint256 at = pending.length++;
                pending.calls[at] = _call(edge, amount);
                pending.slots[at] = slot;
                pending.amounts[at] = amount;
                pending.adapters[at] = edge.adapter;
            }
            resultSlots[n - start] = slot;
        }
        if (pending.length != 0) {
            Call[] memory calls = pending.calls;
            uint256 length = pending.length;
            assembly ("memory-safe") { mstore(calls, length) }
            uint256 spent = initialGas - gasleft();
            if (spent >= GAS_BUDGET - FINISH_RESERVE) revert QuoteBudget();
            // CALL through the canonical Multicall preserves the router/adapter's
            // original msg.sender. STATICCALL would break the V3 quoter path.
            (bool ok, bytes memory raw) = MULTICALL.call{gas: GAS_BUDGET - spent - FINISH_RESERVE}(abi.encodeWithSelector(TRY_AGGREGATE, false, calls));
            if (!ok || raw.length > MAX_RETURN) revert InvalidQuote();
            Result[] memory results = abi.decode(raw, (Result[]));
            if (results.length != length) revert InvalidQuote();
            for (uint256 n; n < length; ++n) {
                if (!results[n].success) revert InvalidQuote();
                bytes memory data = results[n].returnData;
                uint256 out;
                if (pending.adapters[n] == 3) {
                    if (data.length != 32) revert InvalidQuote();
                    out = abi.decode(data, (uint256));
                } else {
                    if (data.length != 128) revert InvalidQuote();
                    uint256[] memory amounts = abi.decode(data, (uint256[]));
                    if (amounts.length != 2 || amounts[0] != pending.amounts[n]) revert InvalidQuote();
                    out = amounts[1];
                }
                if (out == 0) revert InvalidQuote();
                cache.values[pending.slots[n]] = out;
            }
        }
        for (uint256 n = start; n < end; ++n) outputs[n] = cache.values[resultSlots[n - start]];
    }
}
