// 本地测试用 token list（带 CORS），仅供「导入列表」走查：node tests/list-fixture-server.mjs → http://127.0.0.1:8127/test.tokenlist.json
import { createServer } from "node:http";
const LIST = { name: "Walk Test List", timestamp: "2026-11-10T00:00:00.000Z", version: { major: 1, minor: 2, patch: 0 }, keywords: ["test"],
  tokens: [
    { chainId: 56, address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", name: "BUSD Token", symbol: "BUSD", decimals: 18 },
    { chainId: 56, address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", name: "PancakeSwap Token", symbol: "Cake", decimals: 18 },
  ] };
createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/slow.tokenlist.json")) { setTimeout(() => res.end(JSON.stringify({ ...LIST, name: "Slow Test List" })), 1800); return; }
  if (req.url.startsWith("/invalid.tokenlist.json")) { res.end(JSON.stringify({ ...LIST, tokens: [{ ...LIST.tokens[0], decimals: -1 }] })); return; }
  if (req.url.startsWith("/other-chain.tokenlist.json")) { res.end(JSON.stringify({ ...LIST, tokens: LIST.tokens.map(t => ({ ...t, chainId: 97 })) })); return; }
  if (req.url.startsWith("/test.tokenlist.json")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(LIST)); return; }
  res.statusCode = 404; res.end("not found");
}).listen(Number(process.env.TOKEN_LIST_TEST_PORT || 8127), "127.0.0.1", () => console.log("token-list fixture server ready"));
