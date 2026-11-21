# FstSwap 自查与线上余额／报价测速

日期：2026-11-22（Asia/Shanghai）。自查基线 `cdb4133992c1d10a001c591968efe27fe9b0f815`，延续 PR #2；本轮没有部署、主网签名／交易或私钥读取。原 29 项失败的处理记录不变；本轮额外审查发现两处此前缺少用例的问题。

## 1. 当前线上实际速度

北京时间约 02:31，对 `https://fstswap-live.vercel.app/` 只读测试，每种接口 6 次，18/18 为 HTTP 200 且余额完整或报价正值；金额报价使用 fresh header、50 bps 滑点。余额地址为用户已提供的公开地址 `0x3D91889209f9ca69b7Cb73D7a8C463f4deFB5c15`，只读 BNB、USDT、FIST。

| 操作 | 首次连接 | 后续 5 次范围 | 后续中位数 | 服务端处理时间中位数（全部 6 次） |
|---|---:|---:|---:|---:|
| BNB、USDT、FIST 批量余额 | 2,115 ms | 846–1,283 ms | 877 ms | 399 ms |
| 1 USDT → FIST 报价 | 1,708 ms | 642–1,857 ms | 976 ms | 219 ms |
| 0.001 BNB → USDT 报价 | 4,531 ms | 1,491–3,009 ms | 1,949 ms | 1,615 ms |

全新手机尺寸、未连接钱包的真实线上浏览器：页面可交互约 1,734 ms；输入 USDT 数量 `1.371`、`1.372`、`1.373` 后出现 FIST 预计输出分别为 2,917、1,011、915 ms，页面 JS 错误为 0。输入耗时包含 fill 和 DOM 观察，不能直接等同 RPC 计算时间。

“首次连接”包含该连接的 DNS/TCP/TLS，并不证明服务端池／路线缓存为空。后续请求尽可能复用 HTTPS 连接。6 个样本不足以推导稳定 p90；测试机网络位置未知，不能保证所有用户相同。余额数据为接口响应，未测真实插件钱包连接恢复。报价 fresh 绕过完成报价，不表示清空所有储备／policy 缓存。

线上 manifest SHA256 仍为 `e9eed2dbbebade4249d6277af74bae07d24dce43dcc427205663545584d1dc10`，入口 `fst-runtime-boot-YLCXWZ6J.mjs` / `fst-runtime-app-26A4CJHY.mjs`；与候选 PR 不同。以上不是未部署补丁的上线后数据，也不是优化前后对比。原始样本、参数、边界见 [JSON](selfcheck-latency-20261122.json)。

## 2. 自查发现与最小修复

### P2：预热 policy 绕过点击时的税模型确认

`executeSwap` 命中完成的 warm policy 时，只验证旧区块 canonical 与短 TTL，没有调用 fresh `recheckFstQuote`。最新 `eth_call` 和链上 minimum 仍生效，所以本轮没有证明绕过最低到账或资金损失；但是“税模型／业务状态变化必须刷新”的客户端约束被遗漏了。模拟复现将税率从 300 改为 400、模拟净额仍高于 minimum，旧控制器出现只有 1 次税检查且继续发送的行为。

修复在 `src/swap-view.mjs`：pair 模型（包括当前税率为 0）及未知 profile 形状都走 fresh 校验；已通过现有 DTO 验证的旧普通币或 none 模型才可复用 warm policy。Gas 预热继续复用，没有新增资产白名单，也没有放宽税校验或 minimum。普通币不增加读取；pair 模型恢复完整冷提交的 `recheckFstQuote`（池策略与税确认），不能称为只增加两个 RPC，实际耗时依池与重试而定。后续可将税状态复核与完整池发现拆开优化，但本轮没有扩大架构改动。

新增 7 项控制器回归，先确认原版 6 项失败，再修复通过。覆盖税变化／失效拒绝、零税 pair、不变允许、ordinary missing/empty/none 仍复用、未知形状不得复用。真实动态税识别和 DTO 校验仍由原测试单独覆盖；该控制器用例使用明确 fake provider，不能描述为真实钱包签名。

### P2：一条候选价格拒绝中断其他合法完整路线

中间收费路线并发比较第二段时，只将 `NO_ROUTE` 视为候选无效。一条候选触发独立价格下限的 `POOL_LIQUIDITY / price`，会中断整体报价，尽管另一条候选完全合法。该问题在 PR 前基线 `59b91a5` 也存在。

修复在 `src/swap-fstswap.mjs`：只剔除非 retryable 的候选局部 price 拒绝，继续比较其余已通过同样保护的路线；全都失败时保留价格错误。oracle、stale、data、其他流动性、税确认、UNSAFE_QUOTE、取消和 retryable price 继续整体失败。没有降低 2% 独立价格门槛、用户滑点、阶段 `minOut`、最终 minimum 或平台费。

新增 11 项回归，使用真实 `createPoolPolicy.assertValue` 产生拒绝，路由数量明确为模拟。原版 1 项失败、10 项通过，修复后全部通过。断言好／坏候选、全坏、全局错误不得降级，以及平台费和每阶段／最终 minimum 的具体整数值。

## 3. 验证与边界

- 自查基线完整测试：79 文件、842/842，0 失败、0 跳过、0 取消。
- 最终补丁完整测试：**80 文件、860/860，0 失败、0 跳过、0 取消**。
- 修改源码／测试先 `node --check`；运行 `npm run build`、`npm run build:check`；当前 app 为 `fst-runtime-app-FAI56WFQ.mjs`。
- 另对发送最终 chain/accounts guard 做内存变异：只禁用最后条件后，10 项账户／网络切换回归都失败，证明该保护不是仅由模拟始终成功的假测试覆盖；未修改工作区源码。
- 税额计算源码 `swap-transfer-tax`、`swap-liquidity`、客户端 DTO、服务端、preflight、钱包发送源码及执行合约相对本轮基线不变。此次报价改动仅处理候选局部拒绝，页面改动仅强制 fresh 模型检查；没有增加可接受税率或放松最低到账。
- 不使用测试绿色替代真实账户仿真或成交验收；不在本轮执行部署。
