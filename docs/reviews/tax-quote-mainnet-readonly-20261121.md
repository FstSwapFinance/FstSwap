# FSTSI canonical pool: pinned-block public RPC comparison

Checked at 2026-11-21T05:12:40.217Z (UTC). Block 0x8095419 (134829081), hash `0x3d944a1eb9978b2e07bfce6888c8e36d9c7b1c3acf6ddd427254ea58ea15c31f`.

## Scope

Isolated canonical-pool public-RPC sample using real pinned-block reserves, the original `quoteFstRoutes` from Git commit `47ccfb1`, and the current patch. No transaction construction, simulation, signature, broadcast or deployment, no account or private key.

The policy fixture deliberately permits only the verified canonical FSTSI/WBNB pool so tax arithmetic is isolated from Oracle and full main-pool discovery. This is **not full `/api/swap/quote` service validation or actual settlement verification**. No claim is made about applying this patch to the separate `fstswap.pro /api/chain` implementation.

## Baseline identity clarification

The recorded network sample above used `47ccfb1`; it has not been rerun or relabelled. The latest PR base is `59b91a52ca69a21f80cbbba1ce03013e97d47215`. The complete original `quoteFstRoutes` source slice is byte-identical in both commits: SHA256 `a7e870044c5e97f5b0ff1f18facbcc841525be96448b86d9c2535cc11f71d278`. The existing figures therefore compare the same baseline quote function. Future tool runs read the latest-base constant and record the actual checkout commit, dirty status and source-file hashes.

## Runtime and directional-tax identity

- Token: `0x8A25a5929A18c132EAf47a2b497c86aD00eA5b9e`.
- Canonical pair: `0xEC6ABC1CBaef40878069245c2568401e56c949f1`; actual token0 FSTSI, token1 WBNB; factory.getPair(FSTSI,WBNB) matches.
- Pancake V2 Adapter: `0x9De342bDFFB5da04D9865f4cd9846D22560D253a`.
- Raw runtime: 6647 bytes; SHA256 `7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed`.
- Same-block buy/sell getter rates: 300 / 300 bps.
- tradingOpenedAt=1794664343, tradingOpenedBlock=133554912; past the first 61-second changing-tax window.
- protocolContext=False, liquidityMode=0, feeProcessing=False.
- Tax applies only when the actual transfer from/to involves the canonical pair; net = gross - floor(gross * bps / 10000).

## Before/after pool outputs, excluding platform fee

| Sample | Amount in | Baseline output | Patched net output | Independent formula |
|---|---:|---:|---:|---|
| Buy FSTSI | 0.001 WBNB | 143.706166361160199380 FSTSI | 139.394981370325393399 FSTSI | Exact wei match |
| Sell FSTSI | 1000 FSTSI | 0.006922968944675244 WBNB | 0.006715303400294177 WBNB | Exact wei match |

Buy: 0.001 WBNB reaches the pool; gross FSTSI pool output is reduced by the pair-to-recipient buy tax. Sell: payer-to-pair transfer of 1000 FSTSI delivers 970 FSTSI, then the Router quote uses that actual pool input. No global 0.97 multiplication is applied to unrelated transfer edges, and no extra slippage masks tax.

Independent formula uses actual reserves from this block and Pancake V2 25 bps pool fee:

```text
amountWithPoolFee = actualPoolInput * 9975
poolGrossOut = amountWithPoolFee * reserveOut / (reserveIn * 10000 + amountWithPoolFee)
buyNet = poolGrossOut - floor(poolGrossOut * buyTaxBps / 10000)
sellPoolInput = grossInput - floor(grossInput * sellTaxBps / 10000)
```

## Platform fee and final minimum

| Sample | Fee timing | 30 bps fee | User net output | Minimum at 0.5% slippage |
|---|---|---:|---:|---:|
| Buy | WBNB input, before pool | 0.000003000000000000 WBNB | 138.976803440772421468 FSTSI | 138.281919423568559360 FSTSI |
| Sell | WBNB output, after pool | 0.000020145910200882 WBNB | 0.006695157490093295 WBNB | 0.006661681702642828 WBNB |

Patched buildFstQuote fee, net output and final minimum each match independent integer calculations exactly.

## RPC counts and timings

Counts are successful top-level JSON-RPC calls. These are sequential single public-node samples, **not statistically controlled performance claims**.

| Pool quote phase | Baseline | Patched, same-block tax model supplied |
|---|---:|---:|
| Buy | 1 RPC / 520.21 ms | 1 RPC / 930.87 ms |
| Sell | 1 RPC / 938.63 ms | 1 RPC / 519.18 ms |

Cold profile verification separately requires 2 RPC / 707.72 ms: one eth_getCode and one tryAggregate with eight metadata subcalls, requested in parallel.

A cold taxed route therefore uses two profile calls plus one pool quote call, three top-level RPC calls. When the same quote context supplies the model, the pool quote remains one call. This overhead is explicit; no public sub-second guarantee is claimed. Known settlement-asset tax models add no RPC. All metadata and Router reads use the same pinned block.

## Reproduce

```sh
node --check tools/reviews/check-tax-quote-mainnet.mjs
node tools/reviews/check-tax-quote-mainnet.mjs
```

The tool uses only credential-free public BSC endpoints and writes its detailed JSON here. Its baseline is read from the committed Git object, not an abandoned cloud edit. A rerun pins a newer block, so prices and timings may change. Per-phase RPC attempts, failures, delays and source values: [JSON](tax-quote-mainnet-readonly-20261121.json).
