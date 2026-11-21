# FstSwap Critical Read Performance Implementation Plan

> **For agentic workers:** Use test-first implementation and independent review. File ownership below prevents concurrent edits; root integrates the service boundaries.

**Goal:** Reduce safe balance/quote read latency and explain it with phase timings and controlled before/after evidence.

**Architecture:** Build on PR #2 head d22667a. Keep block-bound state, independent subscriber cancellation, tax verification, Oracle/main-pool admission, final canonical and minOut checks. Reuse only bounded, same-node primitive snapshots. Parallelize independent quote batches within a depth, keeping dependent depths sequential.

**Tech Stack:** Native JavaScript ES modules, Node.js, ethers 6.15, Node test runner, Playwright, existing zero-build static app/runtime generator.

**Spec:** User request in this chat: implement phase timing, one fewer warm-balance round trip, same-depth quote-batch concurrency, shared hot-pool snapshots; preserve UI/tax/minimum; provide before/after measurements and a PR; no deployment.

## Global Constraints

- Base d22667a20cf1c2a62d727d387e191c3bc78240cb; preserve canonical bc04870 and PR #2 branch.
- No deployment, merge, wallet/private-key reads, signature or mainnet broadcast.
- Do not weaken TAX_UNVERIFIED, tax direction/rounding, stage/global minimum, fees, slippage, Oracle or liquidity/main-pool rules.
- Preserve UI/CSS and current runtime compatibility cohort; regenerate runtime only after source integration.
- Test first, node --check before tests; run complete npm test and build:check at the end.
- Mark synthetic timing separately from real public-RPC timing; published live build is not this candidate.
- Never retain request closures, aborted promises, mutable policy objects or private URLs in telemetry/snapshot caches.

## Review Focus

- Fresh balances after receipts cannot reuse an older cached header; request freshness must reach the API.
- Account/node changes and reorgs never mix state or leak another consumer's cancellation.
- Concurrent quote batches preserve every candidate and exact association to its input/output; failures cannot publish partial routes.
- A background warm cycle may share a node/block but must not widen any pair's eligible graph or refresh its original expiry.
- Timing failures/parallel scopes must not change computation, and headers/logs must not disclose node credentials.

### Task 1: Warm balance header reuse and freshness propagation

**Files:** create server/swap-balance-header.mjs and tests/swap-balance-header.test.mjs; root integrates server/fstswap-service.mjs and client freshness plumbing.

**Interfaces:** createBalanceHeaderCache({clock=Date.now,monotonic=performance.now,maxAgeMs=500,maxNodes=16}) with get(nodeId), remember(nodeId,block,observation), invalidate(nodeId,hash). Completed primitive headers only. Observation timestamps originate before the fresh header read, never extend on cache hits. Service fresh=true bypasses reuse. No cross-node reuse.

- [x] Add failing tests for reuse, expiry/wall/monotonic rollback, node isolation, reorg invalidation, malformed headers, clone immutability, bounded entries.
- [x] Implement the smallest cache and root wire balances to cachedHeader -> [balance+canonical] while cold remains latest -> batch.
- [x] Propagate fresh from readWalletBalances through service headers to engine.balances. Add API/client/receipt tests proving bypass and no stale publication.
- [x] Validate dedicated and related suites; record one vs two HTTP-round behavior, not a universal first-read speed promise.

### Task 2: Same-depth quote batch concurrency

**Files:** src/swap-fstswap.mjs; new tests/fstswap-quote-batch-concurrency.test.mjs.

**Interfaces:** quoteFstRoutes remains compatible; fill processes at most two independent physical <=80-call batches concurrently per depth, stable input/output mapping. All batches settle/are observed before error propagation; no dependent depth starts early.

- [x] Add red tests proving overlap, max concurrency two, exact result mapping, later-depth dependencies, partial failures and rejection do not fabricate quotes.
- [x] Implement bounded independent batch execution preserving call order within each batch, route candidates, taxes, splits and minima.
- [x] Validate route/tax suites and report batch/RPC counts.

### Task 3: Shared fixed-block warm cycle

**Files:** server/fstswap-service.mjs context/warmup functions only; tests/swap-shared-warm-snapshot.test.mjs. Root edits balances/API/timing after this task finishes.

**Interfaces:** Default hot pairs include USDT->FIST, BNB->USDT and USDT->BNB within existing maxPairs. A single warm cycle uses one selected node and one fresh snapshot/header, with per-pair policy construction reading through that shared snapshot. Reusing raw rows must never add pools/candidates not present for that pair before the change. Header/policy validity, original deadlines, node binding and foreground cancellation remain mandatory.

- [x] Add red tests comparing all per-pair policies/results against separate same-block construction, lower shared-call counts, same node/hash, cancellation/reorg, all-or-nothing publication and original expiry.
- [x] Implement bounded same-cycle sharing; no global all-pool shortcut, no inherited policy closures.
- [x] Validate warm/double-buffer/cache/retention suites and report exact source changes to root.

### Task 4: Phase timings, evidence and PR

**Files:** server/swap-timing.mjs; service and supported read phases; tests/swap-phase-timing.test.mjs; tools/critical-read-benchmark.mjs; docs/reviews/critical-read-performance-20261122.{md,json}.

**Interfaces:** Request-local timings and counts, bounded low-cardinality Server-Timing fields. Include total, context/config/policy, route calculation, canonical and upstream call/batch counts; nested/parallel timings are explicitly overlapping. Public response schemas and UI unchanged except additive timing headers and existing fresh header accepted for balances.

- [x] Add failing timing/API tests; implement request-local scopes without global mutation or private data leakage.
- [x] Finish same-condition baseline/candidate public samples and preserve all failed initial attempts; synthetic and public correctness/call-count comparisons remain separately labeled.
- [x] Regenerate runtime, syntax/build/full tests, independent review and clean checkout verification.
- [ ] Commit conventional messages, push a new performance branch and create a stacked PR targeting the PR #2 branch (until it merges); attach the PR. No deployment.

## Execution Ledger

- Baseline: d22667a; root created a managed worktree and independent dependencies.
- Ruling: user approved this plan's implementation, so proceed without a further plan-confirmation pause.
- Ruling: independent source-owned tasks may proceed in parallel; shared service integration remains sequential in root.

- Task 1: helper and fresh plumbing complete; helper 19/19, integration and fresh propagation 6/6; final full/clean gates below.
- Task 2: complete; 98 targeted tests passed; independent spec/quality review passed. Same 170 candidates and 9 batches/510 subcalls; max concurrent batches 2.
- Task 3: complete; independent review found partial-cycle publication under matching foreground interruption; red regression added, fixed to discard incomplete cycle, warm regressions passed.
- Task 4: telemetry integrated, fixed low-cardinality request scopes and physical counters tested. Full working tree 914/914; independently installed clean checkout 914/914, no failures/skips/cancellations; build and syntax checks passed.
- Independent review: no unresolved P0/P1/P2; two-pair 30-cycle GC probe retains only current two config/policy/block objects.

- Evidence: final public engine 96/96 plus supplemental balances 18/18; synthetic engine 96/96 and 12/12 lane experiments. All applicable output/minimum/fee/pair checks match, 9 initial anchor failures retained. Public warm 3-pair HTTP 37->21; neither public endpoint hits the 500ms balance-head cache. Detailed provenance is in docs/reviews/critical-read-performance-20261122.md and its evidence index.
