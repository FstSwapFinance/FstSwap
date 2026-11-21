# FstSwap 收税币净到账报价修复报告

日期：2026-11-21。范围：现有 FstSwap 聚合前端与 `/api/swap/quote` 服务，沿用已部署 v2.1 执行合约的语义。

本次补丁修复了按税前 `getAmountsOut` 输出展示、比较路线的问题：先确定实际入池数量，再计算池子毛输出和收款地址净到账，以净到账选路和计算最终最低到账。无法可靠确定转账税的代币会拒绝可信报价。没有新建 Swap，没有接第三方聚合器或金库，没有修改合约、平台费率或用户滑点。

**本次没有部署、构造或发送主网交易，没有进行真实账户兑换模拟、签名或广播，没有读取真实私钥。补丁及测试通过不等于线上已修复或实际成交已验收。**

## 1. 代码基线与现网身份

| 对象 | 本次核对结果 | 不能据此推断的事项 |
|---|---|---|
| 补丁基线 | `59b91a52ca69a21f80cbbba1ce03013e97d47215`，重新核对的 `origin/main` | 不是沿用上次未完成的云端修改 |
| 用户原 canonical 工作区 | `bc04870416260ca2444b2d553fef9aef9c77f915` 保留；补丁在独立 `development/tax-aware-quotes` worktree | 不覆盖或假定原工作区改动已经推送 |
| `fstswap-live.vercel.app` | 2026-11-21 只读 GET 200；公开 manifest 与 `47ccfb1ed65091a649ceff450baf9a0d321384a8` 的 Git 对象字节一致；公开客户端使用 `/api/swap` | 不能称线上已经运行本次补丁或最新 `59b91a5` |
| `fstswap.pro` | GET 200；仍加载 `/assets/index-fI_3zfRR.js`，包含 `/api/chain`、`quote-multicall`、`router-amounts-out`，不含 `/api/swap` | 本次补丁没有修复这份不同的旧前端实现 |
| live 与 `logo-api.fstswap.si` 的 `/api/swap/health` | GET 200；公开字段为 `service=fstswap-api`、`version=1`、`chainId=56`、`readOnly=true`；Router 为 `0x6F421584a067b511CEb441C2d5b8534B0C9cdDE7` | 接口没有 commit/build/release SHA，不能证明 API 后端的精确 Git 版本 |
| `api.fstswap.vip` | 根路径、`/health`、`/api/swap/quote` 的 GET 均为 404 | 不把 GET 结果解释成任意 POST 协议或服务能力的证明 |

公开 manifest 的 SHA256 为 `e9eed2dbbebade4249d6277af74bae07d24dce43dcc427205663545584d1dc10`；`59b91a5` manifest 则为 `4160c7fbb06b639e7e92b54f930d597182bb7b540dcf407e648bef0ba128815f`。当时 live 入口为 `fst-runtime-boot-YLCXWZ6J.mjs`、`fst-runtime-app-26A4CJHY.mjs`。

`fstswap.pro` 旧 bundle 的 SHA256 为 `5a29310de0e6a200f3eccd39f0e013e18c1a31a4008d207ae8682cd862dedc4e`。上述仅记录公开身份，不随报告复制健康接口中的私有节点 URL 或运维配置。

真实只读对比工具使用 Git `47ccfb1` 的原始报价函数；已核对该 commit 与最新基线 `59b91a5` 的 `src/swap-fstswap.mjs` SHA256 均为 `f4170e370ac8a349bc095792651363bcaf7878f1d18b078c6d86234813798cae`。这是该函数文件相同的证据，不是两个完整版本相同的声明。

## 2. 税模型的可信范围

新增 `src/swap-transfer-tax.mjs`，将税率归属于已确认的实现及具体转账边。当前特殊收税模型只支持：

- FSTSI：`0x8A25a5929A18c132EAf47a2b497c86aD00eA5b9e`。
- canonical pair：`0xEC6ABC1CBaef40878069245c2568401e56c949f1`。
- 6,647 字节 runtime 的原始字节 SHA256：`7e4601dda4099afdcb91e338cca52a15a77112046876aaf4f13917a8b52693ed`。

读取严格绑定报价区块：并行取得 `eth_getCode` 与包含 8 个方法的 Multicall，核对 runtime、`pair()`、买卖两向 `tradeTaxBps`、开盘时间和区块、`protocolContext`、`liquidityMode`、`feeProcessing`。开盘初始 61 秒的变动税窗口、活动中的特殊上下文、未知实现、错误 pair 或失败读取均返回 `TAX_UNVERIFIED`。已知结算资产使用明确的无转账税模型，不增加税识别 RPC；其他未确认资产不自动视作免税。

PGToken 源码 `_update` 的普通买卖分支只调用 `_tax`；`_tax` 只执行内部余额分账与 bucket 累计，没有在转账中自动调用 Router、卖出税费或修改池储备的外部回调。`beginFeeProcessing` 为独立的 `onlyProcessor` 入口。此结论限于上述精确 runtime 与源码对应范围，不能推广到其他所谓“3% 税币”。

API 中的 profile 是可信服务提供的声明，客户端校验其身份约束、区块、字段与金额数学；它不是独立的密码学证明。提交前仍重新读取链上实现及税状态，并与原报价模型比较。真实执行仿真与最低到账检查未被本补丁省略。

## 3. 金额、平台费与最低到账

每条 leg 明确区分：

| 字段 | 含义 |
|---|---|
| `amountIn` | 当前 leg 的来源毛预算 |
| `poolAmountIn` | 实际进入池子的数量 |
| `grossOut` | DEX Router 返回的池子毛输出 |
| `out` | 真实目标地址应增加的净数量；可能是用户、聚合合约或下一池 |
| `transferInBps` / `transferOutBps` | 当前实际转账边的输入税／输出税，整数 bps |

净额按合约整数语义计算：`net = gross - floor(gross * bps / 10000)`。不使用 `floor(gross * (1 - rate))` 替代；两者在精度边界可能差一个最小单位。

canonical pair 转出为买税、转入为卖税，其他 pair 的普通转账不全局乘 `0.97`。连续 V2 路线中，上一池直接转给下一池，税计入前一 leg 的输出；下一 leg 的 `poolAmountIn` 就是已经到账的净额，`transferInBps=0`，不为同一转账重复扣税。按候选路线的最终净 `out` 比较，避免税前高报价错误胜出。

平台费保持原合约顺序和取整方式：

| 模式 | 收费基数和时点 | 后续预算 |
|---|---|---|
| 输入为收费资产 | 在兑换前对输入预算收取一次平台费 | 扣平台费后的输入进入路线 |
| 输出为收费资产 | 对第一段真实净到账收取一次平台费 | 用户得到该净到账减平台费 |
| 两端都不是收费资产 | 第一段先兑换为默认收费资产，再对第一段净到账收费一次 | 剩余收费资产进入第二段 |

`Stage.minOut` 基于该阶段的税后到账；收费边界处此值尚未扣平台费，符合执行合约先检查阶段到账、再收费的顺序。根报价 `minimum` 基于用户最终扣费后净到账乘一次用户滑点。各阶段原有保护仍保留，未把每跳预算再次乘滑点，也未放宽最终损失预算以掩盖税差。

BNB/WBNB 包装／解包保持现有版本的费用、单位和保护语义，不执行税识别 RPC。本次覆盖全部六种平台收费资产及原生币方向；BTCB 等已知非收费资产仍遵守默认中间收费规则。没有改动已部署合约。

## 4. 前后端一致性与界面

- `/api/swap/quote` 仍为原接口。FstSwap DTO 新增 `quoteModel: "net-transfer-v1"`、`taxProfiles`，并为 legs 增加上述净额字段；没有新增交易端点。
- 客户端核对 segment 与 route-stage 两份 leg 的金额、路径、权重、pool 和税字段必须完全一致；核对税率方向、平台费顺序、阶段 `minOut` 与最终 `minimum`。
- 旧的已知无税结算币 DTO 可继续接受。旧 DTO 若含未知资产又没有可信税模型，则拒绝。v2.0 custody 执行图不接受收税币 profile；v2.1 收税币只走连续线性 V2，普通币 V3 和 split 保持原限制。
- `TAX_UNVERIFIED` 是明确业务错误，不作为网络故障触发毛额本地回退，也不令整个报价服务进入冷却而影响其他币种。
- 价格影响仍表示 AMM 的毛输出与其实际入池量对应 spot 输出之差；转账税及平台费不混入该指标。转账税独立显示为“转账税（已计入）”；无法确认税时显示专用错误，避免误报“没有流动性”。普通币详情布局保持原样。

## 5. 缓存、并发和失败矩阵

| 场景 | 当前处理 | 本次验证范围 |
|---|---|---|
| 已知普通币旧 DTO | 兼容原金额图与费用校验 | 新增客户端回归 |
| 未知币旧毛额 DTO／缺失税 profile | 抛 `TAX_UNVERIFIED`，不进入完成缓存 | 新增客户端回归，含重复查询 |
| HTTP 422 `TAX_UNVERIFIED` | 不转换成 `null`，不触发本地回退；下一次普通币查询仍可用 | 新增真实客户端 HTTP stub 回归 |
| 同 key 短缓存 | 仍受原始到期时间和单调时间窗口约束，消费前重验 DTO | 保留原实现；本次未重写缓存策略 |
| `fresh` | 删除该 key 的完成缓存；按最新基线语义仍可共享相同输入的在途请求 | 未改为强制另起请求；历史“fresh 不共享”断言不能当作本次已通过 |
| 取消、乱序、切换输入 | 保留请求身份、generation/current、订阅取消与界面 seq 防护 | 本次税字段仍经过原发布入口；更广历史断言的失败单独列明 |
| 税校验失败后的界面保留报价 | 作为 hard failure 清除旧报价，不继续展示 retained 结果供交易 | 生产代码审查及针对性界面验证 |
| 一个报价源失败 | 丢弃失败源，只比较其余可执行且已验证净额路线 | 新增路线失败降级测试 |
| 提交前实现／税状态变化 | fresh 链上重读；与原模型不符则拒绝 | 新增 preflight 回归；没有真实账户成交验收 |

## 6. 测试与可复现构建

从干净 checkout 安装并验证：

```sh
npm ci
npm ci --prefix tools/runtime
npx playwright install chromium
node --check src/swap-transfer-tax.mjs
node --check src/swap-fstswap.mjs
node --check src/swap-service-client.mjs
node --check src/swap-view.mjs
node --check server/fstswap-service.mjs
npm test
npm run test:browser
npm run build
npm run build:check
```

本次受控套件与历史审计必须分开解释：

| 验证集合 | 结果 | 范围／限制 |
|---|---:|---|
| 当前 `npm test` | **68/68 通过** | 普通币、买卖两向税、非 canonical 方向、净额选路、2/3 跳、收费模式、全部六种收费资产、原生币／包装、整数边界、零滑点、DTO、税读取及提交前校验；不是仓库所有历史测试的统称 |
| `npm run test:browser` | **43/43 通过** | `#/analysis`、`#/swap`、`#/pool`、`#/add`、`#/remove`、`#/my` 六条本地路由、构建产物、按路由加载、PC／手机代币选择与键盘相关验收；不是插件钱包签名或真实交易 |
| `npm run build:check` | 通过 | 重新生成并检查运行产物；当前入口 `fst-runtime-boot-VWV6ESW2.mjs`、`fst-runtime-app-I7RR35TU.mjs`，12 个运行文件 |
| 原有本地历史审计 | **73 个文件，758 项：728 通过、29 失败、1 跳过** | 保留旧 fixture／断言的独立兼容性审计，不能声称全量回归全绿 |
| 其中 23 个失败 | 在 `59b91a5` 基线已存在 | 主要涉及历史 fresh 语义、时钟、百分比／Gas、页面生命周期与旧构建兼容性；仍是已知债务，不能由本补丁测试绿色掩盖 |
| 其余 6 个失败 | 新增 fail-closed 兼容性差异 | 历史 fixture 用任意 ALT 地址但假定无转账税，现被 `TAX_UNVERIFIED` 拒绝；具体测试名见下方 delta 文件 |
| 另行调整的 5 个历史本地 fixture | 69/69 通过 | 本地研究性适配，未纳入本 PR；不拿这组结果替代上面的未修改历史审计 |

另以待提交 Git index 导出干净快照，排除工作区软链接和未追踪的历史文件后复核：根目录与 `tools/runtime` 的 `npm ci` 均在离线模式成功；同一快照 `npm test` 68/68、`npm run test:browser` 43/43、`npm run build:check` 通过。说明验收依赖已经进入候选提交，不以原工作区残留文件代替 checkout 可复现性。浏览器二进制仍按上面的 Playwright 安装命令准备。

历史失败差异的可审阅清单：[tax-quote-legacy-test-delta-20261121.json](tax-quote-legacy-test-delta-20261121.json)。其中 `baselineFailCount=23`、`patchFailCount=29`，`patchOnly` 为六项依赖未验证 ALT 的原断言，`baselineOnly=[]`。

为让浏览器检查可在 checkout 后复现，本次纳入原本只在本地 ignored 目录的五个验收文件和一个共用 fixture：`swap-runtime-routes-dom`、`swap-runtime-published-dom`、`swap-runtime-artifacts`、`swap-route-preload`、`swap-token-keyboard-dom` 测试及 `runtime-build-fixture.mjs`；新增 `test:browser` 入口。这里只纳入实际运行并记录的验收，不把其余本地历史修改混进 PR。

## 7. 报价正确性与性能证据

**同条件模拟数据：**[报告](tax-quote-benchmark-20261121.md) · [原始 JSON](tax-quote-benchmark-20261121.json) · 工具 `tools/quote-tax-benchmark.mjs`。

该工具交替运行基线和补丁的真实报价代码，使用固定池／税模型、固定 3 ms RPC 延迟，每侧每场景 20 次、预热 2 次。六个场景的补丁净额均与独立转账图精确一致；例如毛额 20,000、实际净额 19,400 的含税池会输给净额 19,800 的无税池。已提供税模型时，route-only RPC 次数维持每跳批量读取的原次数。该数据不是公网延迟或真实成交。

**真实主网只读证据：**[报告](tax-quote-mainnet-readonly-20261121.md) · [原始 JSON](tax-quote-mainnet-readonly-20261121.json) · 工具 `tools/reviews/check-tax-quote-mainnet.mjs`。

区块 `0x8095419`（134829081）、hash `0x3d944a1eb9978b2e07bfce6888c8e36d9c7b1c3acf6ddd427254ea58ea15c31f` 的公开 RPC 样本中：

- canonical 池以 0.001 WBNB 买入，税前池输出为 `143.706166361160199380 FSTSI`；净输出为 `139.394981370325393399 FSTSI`。
- 以 1,000 FSTSI 卖出，实际入池为 970 FSTSI；未计平台费的 WBNB 输出从原税前报价 `0.006922968944675244` 修正为 `0.006715303400294177`。
- 独立整数公式与补丁精确到最小单位一致；平台费和 0.5% 最低到账也按独立计算核对。

此主网工具刻意只允许已验证的 canonical 池，以隔离税计算；不是完整 Oracle／主池发现或 `/api/swap/quote` 服务端到端验收。仅调用公开 RPC，没有构造、模拟、签署或广播账户交易。

冷态 FSTSI 税模型确认明确增加 **2 个顶层 RPC**：`eth_getCode` 与含 8 个子调用的 Multicall，并行发起；普通已知结算资产不增加税识别 RPC。不要将预先传入模型的 route-only 数字解释成冷态总耗时。真实公网样本存在网络波动，本次不承诺“毫秒级”或“首次必达 1 秒”。具体最新耗时以所链接的报告与 JSON 为准。

## 8. 剩余风险与发布前提

1. 当前可靠税模型范围有限。未知币、反射币、rebase、额外扣款、动态外部回调或其他特殊实现不能仅凭 `tradeTaxBps` 返回值接受；需要独立实现识别和执行证据，否则继续拒绝。
2. 新旧客户端和后端应协调升级。旧客户端严格 DTO whitelist 可能拒绝新增字段并回退旧逻辑；只更新服务端不能宣称所有终端都获得净报价保护。另一个使用 `/api/chain` 的 `fstswap.pro` 需要单独确认，不属于这次实现的自动发布目标。
3. profile 在客户端是受信接口声明，提交前 fresh recheck 与执行仿真仍不可省略。账户余额、allowance、状态变化、同块其他交易及最终 inclusion 都可能影响真实成交。
4. 公共健康接口只能确认 service/router/adapters 身份，不能证明后端精确 commit；未来发布应额外提供可核验构建身份，但本次未修改线上配置。
5. 历史测试仍有未解决失败。它们已与基线及新兼容性差异拆分，不应将本报告的 68/68 或 43/43 写成“仓库全量测试通过”。
6. 本次无部署、无主网交易。回滚候选代码可用普通 Git revert，但若未来已开放新版净报价保护，回滚不能静默恢复为未知收税币的可信毛额报价；应维持拒绝或暂停对应资产，直至有可靠模型。

本报告交付的是待审阅补丁、可复现测试与证据。PR、合并和任何线上发布状态应由后续实际操作与链接单独记录。
