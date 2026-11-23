# FstSwap V2.2 deployment candidate

The candidate keeps the existing 30 bps platform fee, deployment wallet, fee receiver, and three-adapter configuration. It uses a new immutable router and four new contract addresses. The seven-step sequence deploys the router and three adapters, then registers the three adapters. BNCB is a V3 trading asset and the fee assets remain BNB, WBNB, USDT, USDC, FIST, and ETH.

Install the pinned compiler using the existing quote-pipeline lockfile and generate the Solidity Standard JSON input and deployment manifest.

```sh
npm ci --ignore-scripts
npm ci --prefix tools/quote-pipeline --ignore-scripts
node tools/fstswap-v22/deploy.mjs build /tmp/fstswap-v22-build
```

The compiler reads versioned Solidity sources from this repository, including the retained OpenZeppelin source files. `standard-input.json` contains those inputs for explorer verification. The manifest digest binds the input sources, compiler settings, deployment parameters, and creation bytecode. The build reports runtime sizes for all four contracts.

## Local BSC fork

Run Anvil with a BSC RPC that serves the pinned block, loopback binding, and local chain ID 31337. The rehearsal uses the first unlocked local Anvil account as the deployment owner. It checks creation calldata, canonical receipts, runtime bytecode, adapter registration, and current BNCB contract identity.

```sh
anvil --host 127.0.0.1 --port 18556 --chain-id 31337 \
  --fork-url https://bsc-rpc.publicnode.com --fork-block-number 135268872 --silent
node tools/fstswap-v22/deploy.mjs rehearse http://127.0.0.1:18556
```

## Mainnet wallet handoff

`plan` is read-only and produces the next unsigned EIP-1193 transaction object. The default is the BSC public RPC. Set `FSTSWAP_DEPLOYMENT_RPC` to use a different BSC HTTPS RPC. The tool checks the chain ID and the hash of BSC reference block 135268872. Before each signature, review the signer address, nonce, chain ID 56, creation data or adapter registration, and gas budget in the connected wallet. Broadcast and confirm each transaction in the user's wallet. Keep its hash and add it to the same compilation's records before planning the next transaction.

```sh
node tools/fstswap-v22/deploy.mjs plan > /tmp/fstswap-v22-next.json
node tools/fstswap-v22/deploy.mjs plan /tmp/fstswap-v22-records.json
```

Create the records JSON using the `digest` reported by the build. Add confirmed hashes to `receipts` in deployment order, using their lowercase hexadecimal form. Each call verifies all recorded transactions and rejects a changed nonce or a mismatching compilation. Keep a pending transaction's hash for recovery. When all seven hashes are confirmed, `plan` returns the verified router, adapter addresses, and a canonical configuration block for release review.

Use the generated Standard JSON input with the four verified addresses for source verification. The verified record is the input for the separate frontend and API activation. The 2.0 deployment page reads historical 2.0 data and serves its original signing flow.
