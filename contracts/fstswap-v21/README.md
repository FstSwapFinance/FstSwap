# FstSwap 2.1 candidate

This source is a candidate. The active mainnet router remains FstSwap 2.0.0 until a new deployment is signed and independently verified.

Single-branch V2 routes fund pairs directly and send intermediate outputs to the next pair. Only platform-fee and native wrapping boundaries use aggregator custody. Validation builds the verified pool list and directions once; execution reuses those values. Public swap ABI and fee/minimum-output rules are unchanged.

Pool identities, duplicate pools, actual net receipts, input budgets, fee configuration, deadlines and reentrancy protections stay enforced. Unknown assets cannot fall back to custody-based V3 or split execution.

See `validation-result.json` for the 26 unit tests, 256 fuzz runs, two local gas comparisons, three fixed-block BSC fork tests and nine-transaction local deployment rehearsal. These checks do not constitute a formal audit or a real-wallet mainnet deployment. Transfer-tax quoting must still respect the recipient's original minimum output.

Build settings: Solidity 0.8.26, optimizer 100, viaIR, Paris. Dependencies use the retained `../fstsi-v10/lib/openzeppelin-contracts/` sources. Development tests and logs stay in the local development checkout.
