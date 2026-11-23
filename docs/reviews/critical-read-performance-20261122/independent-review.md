# FstSwap critical-read performance: independent whole-change review

Reviewed 2026-11-22. Base: `d22667a20cf1c2a62d727d387e191c3bc78240cb`. Candidate: live working copy at `/Users/haocut/.codex/worktrees/fstswap-critical-read-perf/FstSwap`, including the follow-up `values.length !== pairs.length` fix and the connected low-cardinality quote/snapshot counters observed during this review.

## Verdict

- **Spec verdict: PASS for the inspected source after the interrupted warm-cycle fix.** The four requested source changes are present: request-local phases/counts, bounded same-node balance-header reuse with explicit fresh bypass, two same-depth quote batches in parallel, and shared fixed-block warm snapshots with independent per-pair policies.
- **Quality verdict: APPROVE the inspected source, subject to the root agent's final validation/evidence gates.** No unresolved P0/P1/P2 code defect was found after the fix described below. This is not a claim that the final complete test run, regenerated runtime check, clean-checkout verification, or public-RPC benchmark has passed. Those belong to the integration owner and the evidence agent.
- No deployment, wallet/private-key read, signature, or transaction was performed for this review. Source files were not edited by this reviewer; only `/tmp` reproductions and this report were written.

## Finding found and fixed during review

### [P2, resolved] Publish no partial multi-pair cycle when matching foreground work interrupts warming

Location: `server/fstswap-service.mjs:343-349`; original defect was the post-loop publication guard, now line 348.

The loop intentionally stops launching more warm discoveries once foreground work is active. Previously, the post-loop `if (!values.length) return false` condition still allowed a cycle with only its first pair completed to publish that pair and the new raw snapshot, return `true`, and leave sibling pair contexts on the old buffer. This violated the approved all-or-nothing cycle rule. It did not remove tax, Oracle, main-pool, minimum, expiry, or canonical checks from either executable quote.

Independent reproduction: `/tmp/fstswap-review-partial-warm.mjs`.

1. Warm two pairs successfully at block `0x100`.
2. Advance the controlled clock by 3000 ms.
3. Start a refresh and hold the first pair's new policy at block `0x101`.
4. Start a matching foreground quote, which correctly consumes the still-current old buffer, and hold its calculation open.
5. Release the first warm policy while foreground work remains active.

Before the fix, the script exited successfully after observing:

```json
{"policies":3,"firstBlock":"0x101","siblingBlock":"0x100","warmReturned":true}
```

The implementation owner changed the guard to `if (values.length !== pairs.length) return false` and added a dedicated regression to `tests/swap-shared-warm-snapshot.test.mjs`. The independent post-fix reproduction `/tmp/fstswap-review-partial-warm-fixed.mjs` passed with:

```json
{"policies":3,"firstBlock":"0x100","siblingBlock":"0x100","warmReturned":false}
```

The fix preserves successful single-pair publication because that cycle still completes all its selected pairs. The `finally` block removes unpublished pending entries after an interrupted multi-pair cycle.

## Source review coverage and conclusions

| Area | Independent inspection |
| --- | --- |
| Balance header age | Entries retain primitive header fields only. Both wall and monotonic ages must remain below 500 ms from the original fresh-header observation; a hit does not renew the budget. Wall/monotonic rollback clears retained entries. An older completion cannot replace a newer observation. |
| Balance identity/freshness | Cache identity is the actual selected node ID. Account balances are read again at the explicit captured block; canonical hash remains mandatory. `fresh` propagates from `readWalletBalances` through the physical balance batch, service client, API header, and engine bypass. Fresh and ordinary client pending lanes differ. |
| Balance reorg/cancellation | A hash mismatch invalidates only the matching node/hash cache entry and rejects publication. The attempt signal is checked after reads; the existing pool owns physical cancellation. No balance value or account object is retained in the header cache. |
| Quote batch concurrency | Each fill group starts at most two batches of at most 80 calls, preserves call/result order and quote keys, waits for all started siblings before propagating physical failure, and does not advance dependent depth early. A reverted row retains the established zero-output/drop-route behavior. |
| Warm-cycle identity | The outer operation selects one node. Inner contexts are pinned to it and reuse one captured raw snapshot. Pair discovery still rebuilds config/policy objects and constructs the pair's own eligible graph; shared raw rows do not inject a sibling's admitted pools. |
| Warm deadlines/reorg | Policy checkedAt is limited by the original snapshot capture. All selected policies are checked together before publication. Existing final canonical checks and invalid-snapshot checks remain in place. The new interruption guard prevents partial cycle publication. |
| Retention | No new global policy/request cache was introduced. The independent two-pair GC probe below found only the current pair count of configs, policies, and blocks alive after repeated refreshes. |
| Timing behavior | AsyncLocalStorage stores one scope per creator request. Fixed phase/counter names, numeric bounded values, immutable sealed response headers, and protected diagnostic clock reads keep credentials and arbitrary caller strings out of Server-Timing. Failed phases retain their original rejection. Nested/parallel durations intentionally overlap. |
| Safety/UI scope | The changed routing lines leave transfer-tax reads, topology restrictions, pool admission, Oracle checks, value floors, minOut/stage minima, fees and slippage calculations intact. The reviewed UI-facing change is additive timing/freshness plumbing; generated artifact validation remains the root agent's gate. |

## Independent focused verification

The reviewer did not repeat the already-running complete suite or previously recorded unchanged suites.

- Ran the pre-fix interrupted-cycle reproduction and demonstrated the mixed published buffer and incorrect successful completion status.
- Ran the post-fix version and demonstrated no partial replacement and `warmupOnce() === false`.
- Retained its latest stdout at `/tmp/fstswap-review-partial-warm-fixed.stdout.json` and independently ran the new `matching foreground that pauses` regression alone: 1 passed, 0 failed.
- Ran `/tmp/fstswap-review-multipair-retention.mjs` with `node --expose-gc`, two pairs, 30 completed replacement cycles, child-process timeout retention disabled, and repeated explicit GC. Result before and after the guard change:

```json
{"config":2,"policy":2,"block":2}
```

This focused GC probe supplements the existing real-config/factory-proof single-pair retention test; it does not replace that test or prove all heap behavior under production traffic.

The executable probe is retained at `/tmp/fstswap-review-multipair-retention.mjs`; the latest direct process stdout is `/tmp/fstswap-review-multipair-retention.stdout.json`. It can be reproduced with `node --expose-gc /tmp/fstswap-review-multipair-retention.mjs`.

- Read the new cache, concurrency, freshness propagation, real-policy timing, API timing, RPC timing, shared-warm tests and the existing warm-priority/double-buffer/retention tests.
- Inspected the source integration of quote batch/subcall/candidate counters and the raw-snapshot reuse counter after the root agent added them.

## Validation and evidence gates still owned by integration

1. Record the result of the final complete `npm test` on the integrated source. The parent reported 860 baseline passes and prior directed passes; this reviewer did not independently rerun or confirm the final complete result.
2. Ensure the new interrupted-cycle regression and the warm priority/double-buffer/shared-snapshot suites pass on the final guard implementation.
3. Regenerate runtime after the latest client/source additions, then run the required syntax and `build:check`/runtime validation against those final artifacts. Verify the clean checkout after commits.
4. Attach controlled baseline/candidate call-count and correctness evidence, plus separately labeled real public-RPC observations. No universal latency reduction should be inferred from the cache or synthetic transport tests.

Reviewed final-source SHA-256 anchors:

```text
882ec30e5ef178e509c68bdba01a5422d3146fca98322618538aa3074a55aef1  server/fstswap-service.mjs
eba115b2b7b41c95ad60bff0fa363f82674f09523697699d9fd74b06136968cf  src/swap-fstswap.mjs
2e6f777c862d74268e09e5fe8582f3a5e45ccb00f0f97ec0c134cf40ca60fffa  server/swap-timing.mjs
```

## Measurement interpretation notes (non-blocking)

- A shared in-flight quote/context/chain guard physically runs in its creator's AsyncLocalStorage scope. Other subscribers can have total/context-wait timing without independent config/policy/route or physical-RPC counts. Headers should be described as work attributed to that scope, rather than a full duplicate bill of shared physical work for every subscriber. This is a telemetry interpretation boundary, not cross-request payload leakage.
- `rpc_batches` counts physical HTTP JSON-RPC batches; `quote_batches` counts quote multicalls submitted by the route filler. These measure different layers and should remain distinct in benchmark prose.
- A balance header's 500 ms reuse budget begins before the fresh header RPC, and admission happens only after balance/canonical completion. Slow upstream reads can consume the whole budget and intentionally produce no reusable header. Claim the observed saved round only for eligible warm reads.
- Phase durations overlap; adding context, policy, route, canonical and RPC durations does not yield total latency.

## Final benchmark-tool follow-up

The reviewer separately inspected the final two benchmark tools and all three formal raw JSON files. No blocking measurement or report finding was found. Two P3 tool issues were fixed and independently rechecked: explicit HTTPS origins are now restricted to the two measured public hostnames, and sameBlock === false now fails the paired invariant check. The original formal results already used those public nodes and all applicable pairs were same-block, so no measured timings or conclusions changed. The root owner then ran the latest tool: 32/32 synthetic engine operations, 4/4 lane experiments, 16 invalid-option rejections, no invariant failure and unchanged source hashes. This follow-up does not claim that the reviewer repeated full/public measurements.
