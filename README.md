# FstSwap

BSC 主网聚合交易前端，支持兑换、行情、流动池与代币列表管理。

主网 v10 路由：`0x6b149377b0d68c7cF09DDa6B6467861D997C9646`。源码及部署记录位于 `contracts/fstsi-v10/`。

```sh
npm ci
npm run serve
```

打开 http://127.0.0.1:8124 。静态前端可以直接放在 GitHub Pages，无需构建。

```sh
npm test
gh auth login
npm run token-admin
```

代币和 Logo 后台：http://127.0.0.1:8130 。本机后台使用 GitHub 登录权限，将修改保存至 `FstSwapFinance/FstSwap` 的 `main/tokens.json`；GitHub Pages 本身不运行后台服务。Logo 使用 HTTPS 图片地址。

合约测试：`forge test --root contracts/fstsi-v10 -vv`。依赖源码与许可证包含在 `contracts/fstsi-v10/lib/`。
