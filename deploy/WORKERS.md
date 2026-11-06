# 在另一台电脑上完成 Cloudflare Workers 部署

## 当前进度

部署代码已在 GitHub；完整自动测试、前端构建、部署包检查均通过。本地 Workers 运行环境已验证真实 QQQ/AAPL 数据，以及缓存由 MISS 变为 HIT。

**尚未部署到 Cloudflare，也未修改正式域名路由。现有网站仍由 VPS + Tunnel 提供。**

## 1. 在新电脑克隆

需要 Git、Node.js 22 LTS 或更新的受支持 LTS 版本，以及管理 `kaida.sbs` 的 Cloudflare 账号。

```sh
git clone https://github.com/ckd0817/buythedip.git
cd buythedip
npm ci
```

已经克隆过则先运行 `git pull --ff-only`，再 `npm ci`。有本地改动时先处理，不要强行覆盖。

**仅部署 Workers 无需 Python，无需复制原电脑的行情文件、缓存或凭证。** 行情继续使用 VPS 上的数据。

## 2. 本机验证和登录

```sh
node --test tests/worker.test.mjs
npm run build
npx wrangler deploy --dry-run
npx wrangler login
npx wrangler whoami
```

`dry-run` 不会上线。`login` 会打开浏览器，使用 Google 登录也可以，然后确认 Wrangler 授权。`whoami` 应显示管理 `kaida.sbs` 的账号。

账号有多个时，在 `wrangler.jsonc` 顶层填写 `"account_id": "实际账号ID"`，确保选中域名所属账号。不要把 API Token 或登录凭证写入仓库。

## 3. 先部署到测试地址

```sh
npm run deploy:worker
```

当前 `wrangler.jsonc` **没有正式域名 Route**。这次部署只创建 Worker 和测试地址，不切换现有网站。输出地址类似：

```text
https://buythedip.<你的Workers子域名>.workers.dev
```

若提示未设置 Workers 子域名，先按提示在控制台设置，再部署。如果账号已有同名 Worker，确认是不是本项目，不要覆盖其他应用。

打开命令输出的实际地址，检查首页真实行情、QQQ/SPY/SMH 切换、AAPL 搜索、股票/基金同码选择、历史图表、分享图片、中英文和手机排版。

也打开测试地址下的 `/data/QQQ.json` 与 `/api/market?symbol=AAPL`，应返回 JSON，不能返回网页或登录页面。浏览器开发者工具 Network → 请求 → Response Headers 应有 `X-Market-Cache: MISS` 或 `HIT`；同一节点重复请求可命中缓存。

检查缓存时可以禁用浏览器缓存，但不要添加随机查询参数，API 不接受额外参数。测试地址打不开时，先区分 workers.dev 网络问题和应用错误，不要跳过验证直接切正式域名。

## 4. 验证后接入正式域名

**保留现有 Tunnel 和代理 DNS。这里用 Worker Route，不用 Worker Custom Domain。**

在 `wrangler.jsonc` 顶层增加下面的 `routes`，与 `assets`、`vars` 同级：

```json
"routes": [
  {
    "pattern": "buythedip.kaida.sbs/*",
    "zone_name": "kaida.sbs"
  }
],
```

保留 `vars.ORIGIN_BASE` 为 `https://buythedip.kaida.sbs`，然后再次运行：

```sh
npm run deploy:worker
```

**这次部署会切换正式网站流量。** 输出应包含 `buythedip.kaida.sbs/*`。控制台 Workers & Pages → buythedip → Settings → Domains & Routes 中也应看到这条 Route。

同区域 Route 下，Worker 回源 fetch 使用主机名的原有源站连接，不会再次执行同一个 Route。静态页面由 Workers 提供，行情仍经过原有 Tunnel。

不要同时把正式主机名配置成 Worker Custom Domain；该模式会改变回源语义。以后如要改 Custom Domain，先创建独立的 Tunnel 回源主机名，再修改 ORIGIN_BASE，避免循环。

## 5. 正式验证

强制刷新 `https://buythedip.kaida.sbs/?etf=QQQ`，重复测试地址的功能检查。再检查：

```text
https://buythedip.kaida.sbs/data/QQQ.json
https://buythedip.kaida.sbs/api/market?symbol=AAPL
```

应返回真实行情 JSON，且有 `X-Market-Cache` 响应头。这比仅看到旧页面更能确认正式流量已经过 Worker。

有错误时查看日志，再刷新出错页面：

```sh
npx wrangler tail buythedip
```

按 Ctrl+C 退出日志。

## 6. 保存配置并连接 GitHub 自动部署

上线成功后，把新增 routes 配置提交回仓库：

```sh
git add wrangler.jsonc
git commit -m "Route production domain through Workers"
git push
```

在 Cloudflare 控制台打开**已有的** buythedip Worker，进入 Settings → Builds，连接 Git repository。若入口名称改变，寻找 Connect repository。不要另建一个不同名称的 Worker。

| 设置 | 值 |
| --- | --- |
| 仓库 | ckd0817/buythedip |
| 生产分支 | main |
| 项目根目录 | 仓库根目录，留空或 / |
| 构建命令 | npm run build |
| 部署命令 | npx wrangler deploy |
| Worker 名称 | buythedip，必须与配置一致 |

需要 GitHub 授权时尽量仅授权本仓库。检查首次构建成功后，后续推送 main 会自动发布前端。Python 后端不随 Workers 发布，仍按根目录 DEPLOYMENT.md 部署 VPS。

## 7. 回滚

若切换后异常，先暂停已连接的自动生产部署，再在 Worker 的 Domains & Routes 中移除 `buythedip.kaida.sbs/*` 这条 Route，恢复原有 Tunnel + Nginx 页面。

**不要删除 Tunnel、DNS、VPS 服务或实时数据。** 原有网站文件仍保留在 VPS。

随后从 wrangler.jsonc 删除 routes 配置并提交回仓库，避免后续自动部署重新加回 Route。如果只是某次前端发布有问题，也可在 Worker 的 Deployments 中回滚到之前可用的 Worker 版本。

## 技术参考

前端由 Workers Static Assets 托管；`/data/{SPY,QQQ,SMH,market}.json` 和 `/api/market` 回源 VPS。VPS 上的 Python、定时任务、精确行情缓存保持独立。

## 构建和测试

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
npm run preview:worker
```

`public/.assetsignore` 排除本地行情快照，防止旧行情随前端发布；`/data/*` 和 `/api/*` 必须优先运行 Worker，不能落入 SPA 页面回退。

### 控制台部署参数参考

1. 在 Cloudflare Workers & Pages 中连接本仓库，项目名为 `buythedip`。
2. 生产分支为 `main`，构建命令 `npm run build`，部署命令 `npx wrangler deploy`，根目录为仓库根目录。
3. 先通过生成的 `workers.dev` 地址检查页面、静态资源、QQQ/SPY/SMH、股票/基金搜索、历史图表及分享卡片。
4. 保留现有 Tunnel 和 `buythedip.kaida.sbs` 的代理 DNS 记录，在 Worker 路由中添加 `buythedip.kaida.sbs/*`，所属区域 `kaida.sbs`。

此处使用 Worker **Route**，不将正式主机名改成 Worker Custom Domain。Worker 在现有 Tunnel 源站前提供静态页面；同区域回源 `fetch()` 到原主机名时走原源站，不重新调用 Route。不要把该主机名同时配置成 Worker Custom Domain，否则会改变回源语义。

`ORIGIN_BASE` 在 `wrangler.jsonc` 中配置为现有正式主机名。未来如果改为 Custom Domain，必须先创建独立的 Tunnel 回源主机名，并同步修改该变量以避免循环。

### 缓存

- 哈希 JS/CSS：浏览器长期缓存；版本发布更换文件名。
- 行情静态快照：边缘缓存 300 秒。
- 代码查询与同码选择结果：边缘缓存 60 秒。
- 错误、重定向或非 JSON 回源结果：不缓存。
- 浏览器行情响应 `max-age=0`，不在浏览器长期保存。
- Cookie、Authorization 不转发给行情源站；只允许已定义的公开路径和查询参数。

响应头 `X-Market-Cache: HIT/MISS` 可用于验证边缘缓存。Cache API 是按数据中心缓存，并非全网每个代码只回源一次；原有服务端并发合并和持久缓存仍负责限制上游行情请求。

### 回滚原理

删除 Worker 的 `buythedip.kaida.sbs/*` Route，立即恢复现有 Tunnel + Nginx 页面。不要删除 Tunnel、DNS 或 VPS 的实时数据。Worker 内的前端版本也可以独立回滚。

Workers 不会自动部署 GitHub 中的 Python 更改。后端发布仍按 `DEPLOYMENT.md` 执行。部署平台改变不保证中国大陆运营商到 Cloudflare 的线路改善。

本次尚未拆分首页摘要与完整历史数据；不要把当前迁移理解为已完成该项优化。
