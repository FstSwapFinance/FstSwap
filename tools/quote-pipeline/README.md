# Deployless quote constructor

This isolated toolchain builds `server/solidity/SwapQuotePipeline.sol` into `server/swap-quote-pipeline-bytecode.mjs`. The server needs only that generated module; the compiler and local EVM packages are development dependencies.

```sh
npm ci --ignore-scripts --prefix tools/quote-pipeline
npm run build --prefix tools/quote-pipeline
npm run check --prefix tools/quote-pipeline
npm test --prefix tools/quote-pipeline
```

The exact compiler is `solc 0.8.26+commit.8a97fa7a.Emscripten.clang`, with IR optimization, 200 optimizer runs, `paris` opcodes, and no metadata trailer. The lockfile pins package integrity. The `tmp` override retains the exact compiler while removing advisories in its unused CLI temporary-file dependency. A clean install currently audits with zero vulnerabilities. The build records source, standard JSON input and creation-bytecode SHA256 hashes and fails `check` if the committed module differs by any byte.

Exports:

- `SWAP_QUOTE_PIPELINE_BYTECODE`: creation/initcode, as a `0x` hex string.
- `SWAP_QUOTE_PIPELINE_BUILD`: deeply frozen compiler/settings, hashes, ABI, canonical addresses and limits.

Append ordinary ABI-encoded constructor arguments to the creation code:

```text
uint256 expectedBlock
(uint8 adapter,address tokenIn,address tokenOut,uint24 fee)[] edges
(uint8 edge,uint16 prior,uint256 input)[] steps
uint16[4] bounds
```

Adapter values are 1 for the canonical FstSwap V2 adapter, 2 for Pancake V2 and 3 for Pancake V3. Edge indexes start at zero. `prior = 65535` selects a positive literal input. Other steps require `input = 0` and reference a step strictly in the preceding depth. `bounds = [0,end0,end1,end2]`, with `end2 = steps.length`. Literal split portions belong in the first depth; the caller calculates their exact integer remainder.

Invoke this only through `eth_call` **without a `to` address**, at the already selected explicit block number. Its constructor returns:

```text
abi.encode(uint256 blockNumber,uint256[] outputs,uint256 uniqueCalls)
```

The outputs retain step positions. Each depth deduplicates canonical edge contents plus exact amount against the global completed/pending cache, queues first appearances in input order, and calls canonical `Multicall3.tryAggregate(false, calls)`. Router and adapter child calls consequently retain `msg.sender = Multicall3`. The V3 path uses CALL, rather than STATICCALL. V2 responses must contain exactly `[input,output]`, and all required rows must succeed, decode and return positive output. Any malformed, failed, zero or incomplete necessary row rejects the entire constructor. The application must fall back to its normal layered quote path on rejection or unsupported creation calls.

Bounds are 80 edges, 256 steps, 80 unique calls per depth, three depths, 49,152 bytes of full initcode and a 12,000,000-gas execution budget. Edges support only the six current mainstream ERC20/wrapped tokens: USDT, USDC, ETH, BTCB, Pancake WBNB and FstSwap wrapped BNB. Native ZERO, FIST and tax-bearing/unknown tokens are excluded. The constructor also requires chain 56 and the exact expected block number.

The helper quotes the supplied graph. It does not discover pools, admit routes, infer taxes, choose candidates, calculate fees/slippage/impact/minimums, or replace the final canonical hash check. Those validations remain in the existing application. Equal block numbers are not proof of equal block hashes.

The tests run deterministic local EVM calls with fixture code injected at the canonical addresses. They compare a single constructor against separate Multicall calls between dependent depths, check every output and child calldata/caller, cover full `uint256` precision and limits, and verify all-or-nothing rejection. They make no network requests, sign no transactions, deploy no chain contracts and read no private keys. Their gas/timing figures are synthetic fixture evidence, separate from public-RPC performance.
