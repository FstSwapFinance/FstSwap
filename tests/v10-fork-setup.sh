#!/usr/bin/env bash
# 本地 BSC fork（anvil, chainId 56）部署 AggregatedRouterV10 + 适配器，给测试账户注入 USDT/FIST。
# 仅本地：RPC = http://127.0.0.1:8545；绝不连接真实链发送交易。
set -euo pipefail
cd "$(dirname "$0")/.."
FORK_URL="${FORK_URL:-https://api.zan.top/bsc-mainnet}"   # SWAP_RPC_ENDPOINTS 中支持历史状态的端点
FORGE="${FORGE:-forge}"
SOLC="${SOLC:-0.8.26}"
C="${CAST:-cast}"; R=http://127.0.0.1:8545
ACCT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266           # anvil 默认 0 号账户（公开测试 key，仅本地）
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
if lsof -nP -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1; then echo "Port 8545 is occupied; stop the intended local fork manually first." >&2; exit 1; fi
nohup "${ANVIL:-anvil}" --fork-url "$FORK_URL" --chain-id 56 --port 8545 --silent > /tmp/anvil-v10.log 2>&1 &
for i in $(seq 1 30); do $C chain-id --rpc-url $R >/dev/null 2>&1 && break; sleep 1; done
(cd contracts/fstsi-v10 && OWNER=$ACCT "$FORGE" script script/DeployV10.s.sol --use "$SOLC" --rpc-url $R --broadcast --private-key $KEY --slow 2>&1 | grep -E "^ +(router|fst|pancake|biswap|thena|v3|kyber|registered)|SUCCESSFUL")
USDT=0x55d398326f99059fF775485246999027B3197955; FIST=0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A
$C rpc --rpc-url $R anvil_setStorageAt $USDT $($C index address $ACCT 1) $($C to-uint256 1000000000000000000000) >/dev/null
$C rpc --rpc-url $R anvil_setStorageAt $FIST $($C index address $ACCT 1) $($C to-uint256 1000000000) >/dev/null
echo "USDT $($C call --rpc-url $R $USDT 'balanceOf(address)(uint256)' $ACCT)  FIST $($C call --rpc-url $R $FIST 'balanceOf(address)(uint256)' $ACCT)"
