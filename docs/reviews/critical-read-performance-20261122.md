# FstSwap 关键只读路径：实现、验证与优化前后实测

基于 PR #2 的 `d22667a20cf1c2a62d727d387e191c3bc78240cb`，在独立分支 `codex/critical-read-perf-20261122` 实现。实现提交为 `2cdcb604464c8374581091e12903cf06353f9f3c`，[PR #3](https://github.com/FstSwapFinance/FstSwap/pull/3) 基于尚未合并的 PR #2。本次仅提交代码和 PR；没有部署、合并、钱包签名或主网交易。当前线上接口和页面仍不是本候选版本。

## 改动范围

1. **阶段计时**：请求级 `Server-Timing` 覆盖 context/config/policy/route/canonical、余额、Oracle、V2/V3、转账税和编码阶段；固定名称数值计数记录物理 HTTP/JSON-RPC/子调用与缓存命中。并行阶段耗时会重叠，共享任务只归属创建者，不能相加当作请求总耗时。
2. **余额减少一轮**：只在同一节点、原始观察时间 500ms 内，复用完成且已通过 canonical 检查的区块头；余额本身仍重新读。`fresh` 端到端传递，回执后刷新绕过区块头缓存；回滚时钟、节点切换、乱序完成、重组和取消均有回归。慢节点可能耗尽 500ms 预算，此时保持重新读头，不放宽期限。
3. **同层报价并行**：同一依赖层每批最多 80 子调用、最多两批同时进行；后续层等待前层已启动批全部结束，保持候选、数量关联、收税、费用和最低到账计算。物理批失败不发布部分报价。
4. **共享热池快照**：USDT/FIST、BNB/USDT、USDT/BNB 在一个预热周期共享同一节点、真实固定区块及原始数据缓存，各币对仍独立构建准入策略。整组选定币对完成并通过原有期限/canonical 检查后才发布；匹配前台打断时丢弃未完成新周期，保留旧完成缓冲。原生默认预热由一组增加为三组，会增加相对旧默认的后台工作；下方比较显式给两侧相同三组币对，单列全部预热成本。

`src/swap-transfer-tax.mjs`、`src/swap-view.mjs`、`src/swap-preflight.mjs`、`src/swap-send.mjs`、`contracts/fstswap-v21/src/FstSwap.sol` 及所有 CSS 相对基线字节不变。修改到的路由/流动性模块只加入调度和计时钩子，费用、滑点、最低到账及池准入表达式不变。未修改页面布局或样式。

## 验证

- 基线完整测试 **860/860**；最终候选完整 `npm test` **914/914**，59.45 秒；独立干净 checkout 实际安装依赖后 **914/914**，59.81 秒，均无失败、跳过、取消。
- 新增 54 项测试，覆盖头缓存/fresh、并发与失败关联、共享周期完整发布、取消/重组/期限、阶段计时与 API 计数。现有转账税、净到账、最低到账、钱包生命周期、运行时路由及兼容历史构建测试全部随完整套件执行。
- 运行时已重新生成，`npm run build:check` 通过；boot 为 `fst-runtime-boot-KMETWKW3.mjs`，app 为 `fst-runtime-app-A54YM2IB.mjs`。源代码/测试/运行时与独立干净 checkout 逐文件 SHA256 一致；工具及报告在该导出后补齐，另做语法、CLI 和实际基准运行验证。
- 独立复核发现并修复了多币对预热被前台打断时可能部分发布的问题，新增红绿回归。最终源代码独立评审无未解决 P0/P1/P2；另有受控两币对 30 轮 GC 检查，仅保留当前 2 份 config/policy/block，不据此声称生产堆内存已全面验证。
- 没有新增本次人工真机钱包或页面截图检查。完整套件包含现有 DOM/响应式/运行时路由检查；页面源码和 CSS 保持不变。

测试日志、独立评审及原始测量见本文件末尾；证据 SHA 和干净目录导出 tree 记录于 [证据索引](critical-read-performance-20261122.json)。

## 测量结论

结论：短延迟夹具证明余额 hot 少一轮和报价同层最多两批并发；共享三交易对预热在真实公网减少了重复读取。两个公网节点都没有命中 500 ms 余额头缓存，因此没有观察到公网余额少一轮。公网冷报价调用数不变，个别候选耗时更慢，不能承诺普遍提速。

基线 d22667a 完整归档；最终 service SHA256：882ec30e5ef178e509c68bdba01a5422d3146fca98322618538aa3074a55aef1。三个正式实验的 12 个关键源码 SHA 完全一致，import/finish 检查均未改变。

- 最终稳定版本：合成 engine 96/96 有效，gate/固定延迟路线 12/12 有效，PublicNode 96/96 有效，额外 BNBChain 余额 18/18 有效。
- 144 次 minimum 公式检查、72 组前后费用检查全部通过。有效配对净额/minimum/选中路线/余额一致；170 条完整候选在 6 组 gate/固定延迟配对中 hash 一致。
- 公网报价返回时最低真实剩余 TTL 为 752 ms，没有替换 Date.now 或延长原始 15 秒 expiry。
- 首次在合成后连接 PublicNode 出现 9 次 anchor 获取失败（1 timeout、8 fetch failed），全部保留在附带的 `synthetic-and-initial-anchor-errors.json.gz`；随后独立公网进程成功。失败不计作有效报价或速度样本。

## 真实公网 PublicNode

节点：https://bsc-rpc.publicnode.com。每组每侧 3 次；顺序交替为 before/after、after/before、before/after。各场景组先读真实新区块，两侧 latest 请求固定到该真实高度；canonical hash 仍真实向同一节点读取。所有 clock/Oracle/snapshot/expiry 保持真实。额外诊断 anchor 获取成本在 anchors 单列；操作计时仍包含 engine 自己的 header 请求。

冷态指新 engine/provider pool；进程、TCP/TLS、DNS 和纯 ABI 缓存可能已热。USDT/FIST 与 BNB/USDT 各自独立冷起。两侧显式配置相同三条预热 pair，避免基线默认1条、候选默认3条造成不公平比较。

| 场景 | 基线中位 / 经验 p95 ms | 候选中位 / 经验 p95 ms | 三样本 HTTP：基线 → 候选 |
|---|---:|---:|---|
| balance-cold | 1070.67 / 3111.78 | 1079.32 / 2667.23 | 3,3,3 → 3,3,3 |
| balance-hot | 722.21 / 1046.01 | 719 / 1130.62 | 2,2,2 → 2,2,2 |
| balance-fresh | 713.41 / 724.34 | 728.34 / 735.18 | 2,2,2 → 2,2,2 |
| quote-usdt-fist-cold | 4966.68 / 9962.84 | 3627.37 / 3789.04 | 16,16,16 → 16,16,16 |
| quote-usdt-fist-completed | 353.86 / 1340.8 | 356.38 / 359.95 | 1,1,1 → 1,1,1 |
| quote-usdt-fist-new-amount | 778.07 / 2897.45 | 728.72 / 734.13 | 2,2,4 → 2,2,2 |
| quote-usdt-fist-fresh | 368.93 / 736.25 | 403.8 / 610.81 | 2,1,1 → 1,1,1 |
| quote-bnb-usdt-cold | 6732.1 / 10513.62 | 4482.87 / 12855.7 | 15,15,15 → 15,15,15 |
| quote-bnb-usdt-completed | 359.49 / 1443.19 | 351.88 / 1739.06 | 2,1,1 → 2,1,1 |
| quote-bnb-usdt-new-amount | 2037.75 / 6312.37 | 1510.4 / 3908.23 | 14,4,4 → 14,4,4 |
| quote-bnb-usdt-fresh | 3348.78 / 6989.53 | 2656.26 / 2716.95 | 4,6,6 → 4,6,6 |
| quote-usdt-bnb-reverse | 4741.4 / 8497.1 | 2707.37 / 12028.94 | 15,15,15 → 6,6,14 |
| warm-three-configured-pairs | 10073.39 / 11622.07 | 5639.39 / 5751.35 | 37,37,37 → 21,21,21 |
| quote-usdt-fist-prewarmed | 3919.81 / 3968.65 | 728.63 / 731.94 | 8,2,9 → 2,2,2 |
| quote-bnb-usdt-prewarmed | 3658.8 / 4045.35 | 1508.23 / 1548.74 | 15,4,14 → 4,4,4 |
| quote-usdt-bnb-prewarmed | 2288.75 / 2586.38 | 1856.25 / 4708.44 | 6,5,6 → 4,4,4 |

只有3个样本，经验 p95 等于最大值，不能外推总体尾延迟。BNB/USDT 冷报价候选最大12855.70ms，高于基线10513.62ms；反向候选最大12028.94ms，高于基线8497.10ms，均完整保留。

公网三 pair 预热每次37→21 HTTP，1373→521合约子调用，latest头3→1；预热中位10073.39→5639.39ms。预热成本完整单列，后续每次报价成本另列。新数量/反向/fresh物理调用数受真实context/completed cache期限影响，不能根据一条记录推导固定节省比例。

## 第二公网节点余额

节点：https://bsc-dataseed.bnbchain.org。独立3组、18/18有效。PublicNode与该节点candidate balance-hot均为2 HTTP/3 JSON-RPC，balance_head_hits=[0,0,0]；fresh也为2 HTTP/3 JSON-RPC。两个节点均未实际命中500ms缓存，不继续增加节点挑选结果。

| 场景 | 基线中位 / 经验 p95 ms | 候选中位 / 经验 p95 ms | 三样本 HTTP：基线 → 候选 |
|---|---:|---:|---|
| balance-cold | 1174.78 / 3282.42 | 1063.68 / 1083.31 | 3,3,3 → 3,3,3 |
| balance-hot | 981.86 / 1304.12 | 705.49 / 741.95 | 2,2,2 → 2,2,2 |
| balance-fresh | 710.56 / 889.86 | 706.43 / 715.75 | 2,2,2 → 2,2,2 |

## 明确合成：40ms与gate

合成响应、储备、价格、余额均为虚构整数单位；执行真实engine、policy、route和Multicall编解码/关联/选路。它与公网测速严格分开。

| 场景 | 基线中位 / 经验 p95 ms | 候选中位 / 经验 p95 ms | 三样本 HTTP：基线 → 候选 |
|---|---:|---:|---|
| balance-cold | 134.73 / 135 | 129.12 / 132.26 | 3,3,3 → 3,3,3 |
| balance-hot | 84.03 / 90.62 | 47.48 / 47.8 | 2,2,2 → 1,1,1 |
| balance-fresh | 85.5 / 92.62 | 90.4 / 92.58 | 2,2,2 → 2,2,2 |
| quote-usdt-fist-cold | 379.26 / 409.78 | 380.9 / 402.89 | 10,10,10 → 10,10,10 |
| quote-bnb-usdt-cold | 344.46 / 363.91 | 349.46 / 367.56 | 9,9,9 → 9,9,9 |
| warm-three-configured-pairs | 827.07 / 833.17 | 517.01 / 528.59 | 23,23,23 → 13,13,13 |

短延迟余额hot：2→1 HTTP、3→2 JSON-RPC，candidate header_hits=[1,1,1]；fresh恢复2 HTTP/3 JSON-RPC且保留canonical核对。三pair预热HTTP23→13，子调用375→149，latest3→1。

170条独立三跳V2/V3/V2路线，每层[80,80,10]；两侧均9 HTTP/510子调用/170候选，完整候选和净额hash一致。活跃批峰值1→2，gate释放9→6轮，后继层等待前层全部已启动批完成。40ms固定延迟模型中位616.07→466.82ms。gate墙钟不用于速度承诺，固定延迟结果只适用于该模型。

## 阶段计时与归属

两侧相同wrapper保留config/policy/route时长；候选额外runtimeTiming保留oracle/v2/V3/tax/canonical/RPC/counter。下表为USDT→FIST公网冷报价物理RPC分类耗时和的中位，批可以并行，阶段之间会重叠，不能相加为总延迟。

| 物理RPC阶段 | 基线 HTTP / 子调用 / 耗时和 ms | 候选 HTTP / 子调用 / 耗时和 ms |
|---|---:|---:|
| config | 1 / 13 / 392.59 | 1 / 13 / 360.15 |
| oracle | 1 / 10 / 404.36 | 1 / 10 / 419.67 |
| v2 | 1 / 42 / 411.76 | 1 / 42 / 431.76 |
| v3_discovery | 2 / 84 / 1437.99 | 2 / 84 / 1101.43 |
| v3_state | 4 / 288 / 1632.72 | 4 / 288 / 1734.76 |
| v3_depth | 2 / 82 / 1052.55 | 2 / 82 / 770.03 |
| route | 1 / 1 / 360.33 | 1 / 1 / 357.33 |
| canonical | 1 / 0 / 364.38 | 1 / 0 / 353.62 |

- AsyncLocalStorage按创建实际工作的调用者归属；后续缓存订阅者不会重复获得同一物理RPC的计数。原始phase/counter、外部trace与wrapper时长全部保留。
- 全局RPC并发含policy并行读；“最多两批”指quote同一依赖层，由受控gate验证。
- 初版主公网诊断codec缺少V3 slot/token selector，曾把policy state批标成balance_read。原JSON未修改；summary仅将policy+balanceOf+unknown批归为v3_state，不改变任何时间、次数、区块、数额、错误。工具现已补全selector，复现无需后处理。
- retained raw trace包含每HTTP的methods、category、child methods/query hash、请求/响应字节、起止偏移、耗时、错误及区块；不包含完整calldata或RPC响应全文。
- 公网DTO不暴露完整候选，核对的是净额/minimum/费用/选中路线；完整候选一致由170路线夹具检查。quoteQueryFootprint受物理缓存影响，不等同完整候选集合。

## 复现与证据

需要 Node.js 和本仓库依赖。基线必须显式指定，不能把未提交修改当作基线；基准可使用指定提交的归档，完整回归测试则要使用带 Git 历史的 checkout，供历史运行时兼容性用例读取旧版本。

```sh
BASELINE_DIR=$(mktemp -d /tmp/fstswap-perf-baseline.XXXXXX)
git archive d22667a20cf1c2a62d727d387e191c3bc78240cb | tar -x -C "$BASELINE_DIR"
npm ci --prefix "$BASELINE_DIR" --ignore-scripts --no-audit --no-fund
node tools/critical-read-benchmark.mjs --help
node tools/critical-read-benchmark.mjs --mode synthetic --baseline "$BASELINE_DIR" --samples 3 --output /tmp/synthetic.json
node tools/critical-read-benchmark.mjs --mode public --baseline "$BASELINE_DIR" --samples 3 --rpc https://bsc-rpc.publicnode.com --output /tmp/public.json
node tools/critical-read-benchmark.mjs --mode public --baseline "$BASELINE_DIR" --samples 3 --cases balances --rpc https://bsc-dataseed.bnbchain.org --output /tmp/balances.json
```

所有原始文件以确定性 gzip 保存，内容未改；解压后的 SHA256 在索引中。比如 `gzip -dc docs/reviews/critical-read-performance-20261122/publicnode.json.gz > /tmp/publicnode.json`。汇总仅做阶段归类修正，说明见上文，不更改时间、数额或失败记录。

- [PublicNode 原始 96 次操作](critical-read-performance-20261122/publicnode.json.gz)
- [第二节点余额原始 18 次操作](critical-read-performance-20261122/bnbchain-balances.json.gz)
- [合成 96 次操作、12 次路线实验与首次 9 次 anchor 失败](critical-read-performance-20261122/synthetic-and-initial-anchor-errors.json.gz)
- [统计和正确性复核](critical-read-performance-20261122/benchmark-summary.json)
- [独立代码评审记录](critical-read-performance-20261122/independent-review.md)
- [基线测试日志](critical-read-performance-20261122/baseline-test.log.gz)、[候选测试日志](critical-read-performance-20261122/candidate-test.log.gz)、[独立干净 checkout 测试日志](critical-read-performance-20261122/clean-checkout-test.log.gz)

正式实验使用的 12 个关键源码 SHA 在三个原始数据文件和汇总中一致，载入与完成时相同；最新工具补全诊断 selector、限制两个公开 hostname，并把跨区块配对纳入 invariant failure；另做语法、独立 `--help`、16 项非法参数拒绝，以及双侧 synthetic engine 32/32 与路线 4/4 smoke（[原始记录](critical-read-performance-20261122/final-tool-smoke.json.gz)）。独立复核确认工具两项 P3 均已修复、无新增发现。最早手填错误 FIST 地址的临时试跑作废，不进入正式结论。所有实验只读；没有读取私钥、`.env`、SSH 或私有 RPC 配置。
