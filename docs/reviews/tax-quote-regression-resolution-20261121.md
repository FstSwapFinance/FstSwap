# FstSwap 全量回归与原 29 项失败处理

日期：2026-11-21。PR：#2。后续变更基于 `e6ab0ba577cb74367e529387d21fc20cfbbaeb3a`；不部署、不签名或广播主网交易、不读取真实私钥。

## 原失败的逐类根因

| 分类 | 数量 | 根因与最终处理 |
|---|---:|---|
| 真实发送安全缺陷 | 1 | 最终账户／网络在准备开始时取值；期间切换账户可能仍发送。等待 preparation、nonce、canonical block 全部完成后，最后重新读取 chain/accounts；之后到钱包发送无其他 await。direct 路径也核验。 |
| 百分比、时钟、报价发布与设置恢复 fixture | 15 | 旧 VM／DOM 缺 `presentedQuote`、`balanceFieldState`、`balancePending`、`acceptQuoteResult` 或 `dropDisplayedQuote`。接入真实生产函数和状态；保持精确余额、Gas、到期、跳钟、取消和焦点断言。 |
| 未知 ALT 被假定无税的 fixture | 6 | 路径拓扑测试改用现有已支持普通币；内部图测试显式 synthetic map 只在测试中传入。未知地址双向报价继续 `TAX_UNVERIFIED`。 |
| fresh 在途行为旧断言 | 4 | fresh 绕过已完成缓存，但共享相同 pending。测试改为验证共享、独立 DTO、单订阅与全部取消、旧响应／旧失败不覆盖新成功；未改生产缓存语义。 |
| 不足授权禁止 nonce 预取的旧断言 | 1 | nonce 预取为只读，仍验证授权不足时不持久化 intent、不发交易。 |
| 回执 fixture 缺当前生命周期依赖 | 1 | 补 `balancePending` 与 `receiptReads.dispose`，保留验证后一次 fresh 三币批量读取和页头复用、旧响应不得恢复余额的断言。 |
| 发布兼容基准落后一版 | 1 | 独立固定 Git 基准从 49..45 更新到实际批准的 50..46；每份历史 manifest／blob／SHA256 和资源完整性继续严格校验。 |

合计 **1 个真实代码缺陷 + 28 个测试问题 = 29 个原失败**。原 23 个基线失败中有 1 个真实缺陷，不能全部标记成测试漂移。原始失败名及各项处理保留在 [JSON](tax-quote-legacy-test-delta-20261121.json)。

## 保护边界与新增回归

- 相对于 `e6ab0ba`，`swap-transfer-tax`、`swap-fstswap`、`swap-service-client`、`swap-liquidity`、`swap-view`、服务端报价错误映射和 2.1 执行合约逐字节不变；SHA256 在 JSON 的 `protectedFiles` 中。
- 未修改平台费或用户滑点，未知税率拒绝、动态税确认、阶段 minOut、最终用户净到账 minimum 和提交前仿真继续保留。
- 新增准备期间换网络、最终身份读取双门控，以及 nonce／区块等待期间账户／网络切换 × direct／prepared 共八组回归；均要求不发送、不落 intent。
- nonce 与区块继续只读并行预取。速度测试改为核对最终身份的必要顺序；不再把提前采样身份得到的时延作为正确优化目标。direct 发送增加最后一次身份读取，可能增加一轮钱包 provider RTT。

## 可重复验收

完整 `npm test` 覆盖 79 文件，当前工作区 **842/842**、0 失败、0 跳过、0 取消；构建和语法检查通过。干净 checkout 结果：**842/842 通过，0 失败、0 跳过、0 取消；独立安装依赖与 build:check 通过**。

全部自动化测试和 `runtime-build-fixture.mjs`、`swap-context-retention-probe.mjs` 辅助文件纳入 Git，避免只在开发机存在而在 checkout 缺失。测试依赖需根目录及 `tools/runtime` 分别 npm ci，Chromium 与完整 Git 历史也必须准备；主报告列有复现命令。

原可选历史录制缺失，没有伪造真实数据。该项目现在执行明确 synthetic 的固定区块录制回放，继续检查完整 policy、双向、一致区块、非零 canonical 储备及缺行拒绝。它不能被描述为恢复 11 月 12 日真实链上记录。

本轮交付为 PR 补丁和自动化证据，不包含部署、真实插件签名、账户成交或到账保证。
