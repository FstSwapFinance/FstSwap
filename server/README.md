# FstSwap 聚合报价与余额服务

入口：`fstswap-service.mjs`。复用当前聚合引擎、选池规则和手续费计算，只读 BSC 主网。授权、签名、模拟及最终交易提交仍由前端钱包完成。

- `GET /api/swap/health`：服务状态。
- `POST /api/swap/quote`：`chainId:56, tokenIn, tokenOut, amountIn, slippageBps, singleHop`。`amountIn` 为最小单位十进制字符串；原生 BNB 地址为全零地址。
- `POST /api/swap/balances`：`chainId:56, account, tokens`，最多 64 个资产。成功余额为整数字符串；读取失败单独列入 `failedTokens`。

报价返回对应区块、路径、配置和过期时间；大整数以 `{"$bigint":"整数"}` 传输。相同进行中报价合并，配置/池上下文在读取完成后复用最多 2.5 秒，原始报价有效期不延长；余额每次读取当前区块。客户端共享 3 秒展示缓存，交易后刷新绕过缓存。

安装依赖：`npm install --prefix server --omit=dev`。启动：`node server/fstswap-service.mjs`。默认仅监听 `127.0.0.1:4375`。

生产目录 `/opt/fstswap-api/current`，服务 `fstswap-api.service`，私有配置 `/etc/fstswap-api/service.env`。`FSTSWAP_RPC_URLS` 为逗号分隔 HTTPS 节点，`FSTSWAP_API_PORT` 为监听端口。配置文件和凭据不放入仓库。

现有 HTTPS 入口：`https://logo-api.fstswap.si/api/swap`。Apache 仅转发上述三个路径，并覆盖 `X-Fstswap-Client-IP` 为真实连接 IP。前端直接访问该 HTTPS 服务，CORS 允许本地 8124 和当前正式站点；新域名需加入允许列表。接口不接收 RPC 方法、上游 URL、交易 calldata、私钥或签名交易。

发布时先验证服务健康和报价，再切换 `current`；回退时指回上一份 release 后重启此服务。无需重启其他应用。

当前版本支持调用方取消：同输入/同节点上下文按消费者共享，最后一个消费者退出才中断上游。RPC 按真实合约读取延迟与限流/错误评分；仅完整只读报价允许限频备用竞速，最多两个并发备用，不混合不同节点的状态。

主进程默认预热 USDT/FIST 和最多三个近期活跃币对，每轮最多四个、串行执行，前台请求优先。预热不延长原始 `checkedAt + 15秒` 报价截止时间；通过 `FSTSWAP_CONTEXT_WARMUP=0` 可关闭。
