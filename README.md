# FstSwap

BSC 主网聚合交易。

- `src/`：页面、样式和聚合交易逻辑。
- `assets/`：页面使用的图片、字体和钱包依赖。
- `admin/`：代币与 Logo 管理后台。
- `contracts/v10/`：当前主网合约源码及部署记录。
- `tokens.json`：默认代币列表。

前端：`npm run serve`，访问 http://127.0.0.1:8124 。也可直接部署到静态托管，无需构建。

后台：先完成 `gh auth login`，再执行 `npm run token-admin`，访问 http://127.0.0.1:8130 。修改保存到本仓库的 `main/tokens.json`。后台需要本地 Node.js，GitHub Pages 不运行后台服务。

主网路由：`0x6b149377b0d68c7cF09DDa6B6467861D997C9646`。
