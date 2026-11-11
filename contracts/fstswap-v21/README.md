# FstSwap 2.1.0

FstSwap 2.1.0 was deployed to BSC mainnet with seven user-signed transactions: four contract deployments and three adapter registrations. An independent read-only check verified all seven canonical receipts, all four runtimes, the configured owner and fee receiver, the 30 bps fee, and `feeConfigVersion = 4`. Sourcify reports exact creation and runtime matches for all four contracts. This document records contract deployment and source verification; frontend/API activation is a separate release step. The historical 2.0.0 source and records remain unchanged.

Single-branch V2 routes fund pairs directly and send intermediate outputs to the next pair. Only platform-fee and native wrapping boundaries use aggregator custody. Validation builds the verified pool list and directions once; execution reuses those values. Public swap ABI and fee/minimum-output rules are unchanged.

Pool identities, duplicate pools, actual net receipts, input budgets, fee configuration, deadlines and reentrancy protections stay enforced. Unknown assets cannot fall back to custody-based V3 or split execution.

The deployment contains four contracts: `FstSwap`, `FstSwapAdapter56`, `PancakeAdapter56`, and `PancakeV3Adapter`. BiSwap is excluded. The deployment used seven transactions (four deployments and three adapter registrations), ending at `feeConfigVersion = 4`.

See `validation-result.json` for the 26 unit tests, 256 fuzz runs, two local gas comparisons and three fixed-block BSC fork tests. The reduced package also passed a seven-transaction local BSC fork rehearsal at block 132979051, with four runtime matches and independent deployment verification; no mainnet transaction was broadcast during that local rehearsal. Local checks do not constitute a formal audit; the separate user-signed mainnet deployment is recorded in `deployment/mainnet-record.json`. Transfer-tax quoting must still respect the recipient's original minimum output.

Build settings: Solidity 0.8.26, optimizer 100, viaIR, Paris. Dependencies use the retained `../fstsi-v10/lib/openzeppelin-contracts/` sources. Development tests and logs stay in the local development checkout.

Mainnet addresses:

| Contract | Address |
|---|---|
| FstSwap | `0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7` |
| FstSwapAdapter56 | `0xdFabF87EE3A9A4cEdda43D3f8035C89E1C9438b7` |
| PancakeAdapter56 | `0x9De342bDFFB5da04D9865f4cd9846D22560D253a` |
| PancakeV3Adapter | `0xE381c967c14b0c6ef82944E0e4b4272D24dd8957` |

Public evidence: [mainnet records](deployment/mainnet-record.json), [deployed configuration](deployment/mainnet-config.json), [independent verification](deployment/mainnet-verification.json), and [public manifest summary](deployment/mainnet-manifest-summary.json).
