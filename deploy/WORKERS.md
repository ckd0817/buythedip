# Cloudflare Workers 前端部署

## 当前状态（2026-11-06 上线）

| 项目 | 值 |
| --- | --- |
| 正式地址 | https://buythedip.kaida.sbs |
| 测试地址 | https://buythedip.ckdckdckda.workers.dev |
| Cloudflare 账号 | ckdckdckda@gmail.com，Account ID `decd35ea10c2c64d7342b030b008b0c9` |
| Worker | `buythedip` |
| 接入方式 | Worker Route `buythedip.kaida.sbs/*`（zone `kaida.sbs`），**不是** Custom Domain |
| 行情源站 | `ORIGIN_BASE=https://buythedip.kaida.sbs`，经原有 Tunnel 到 VPS |
| 自动部署 | Workers Builds 连接 `ckd0817/buythedip` 的 `main` 分支，见第 4 节 |

前端（HTML/JS/CSS/字体/图标）由 Workers Static Assets 提供，不再访问 VPS。`/data/{SPY,QQQ,SMH,market}.json` 与 `/api/market` 由 Worker 回源 VPS 并做边缘缓存。

**保持不变：** Cloudflare Tunnel、`buythedip` 的代理 DNS 记录、VPS 上的 Nginx 与 Python API、定时更新任务、行情缓存和 VPS 上原有的网站文件。Python 后端不随 Workers 发布，仍按根目录 `DEPLOYMENT.md` 部署。

迁移只减少了前端对 VPS 和 Tunnel 的依赖，不保证改善中国大陆运营商到 Cloudflare 的线路。首页摘要与完整历史数据拆分没有做。

### 上线验证记录

在 workers.dev 测试地址和正式域名上分别执行同一套检查，均通过：

- `/data/QQQ|SPY|SMH|market.json`、`/api/market?symbol=AAPL` 与原 VPS 返回内容逐字节一致（SHA-1 相同）。
- 浏览器检查（桌面 1440×900，iPhone 13 尺寸中英文）：QQQ/SPY/SMH 切换、AAPL 搜索、`510300` 股票/基金同码选择并打开 `510300.OF`、历史图表、分享卡片生成（1080×1920）及分享链接、中英文切换、手机端无横向溢出。页面、行情请求均无错误。
- 响应头：行情首次 `X-Market-Cache: MISS`，重复请求 `HIT`；`Cache-Control: public, max-age=0, s-maxage=300`（快照）或 `s-maxage=60`（代码查询）；HTML `max-age=0, must-revalidate`；`/assets/*` `max-age=31536000, immutable`。
- 非法参数返回 400 `invalid_query`，未知代码返回 404，均为 `no-store`。
- `wrangler tail` 显示请求 `outcome: ok`，无异常；无回源循环（同区域 Route 的子请求直接走原 Tunnel 源站）。

上线时发现：缓存命中时，zone 的 Browser Cache TTL 设置把 `Cache-Control` 改写成 `max-age=14400`，浏览器会保存旧行情 4 小时。已在 `worker/index.mjs` 中对 HIT/MISS 都显式设置 `Cache-Control`，并补了测试。

页面中的 Cloudflare Web Analytics 脚本（`static.cloudflareinsights.com`）由 zone 设置注入，原来就有；部分网络下该脚本加载失败，不影响页面功能。

## 1. 日常更新网站

前端改动推送到 `main` 后，Workers Builds 会自动执行 `npm run build` 和 `npx wrangler deploy`，几分钟内生效。在 Worker → Deployments 中可以看到每次构建与版本。

推送前建议在本机运行：

```sh
npm ci
node --test tests/worker.test.mjs
npm run build
npx wrangler deploy --dry-run
```

完整测试需要 Python 3.12 及 `requirements.txt` 依赖，安装后运行 `npm test`。本地调试 Worker 可运行 `npm run preview:worker`。

需要手动发布时（例如 Builds 暂停），在本机 `npx wrangler login` 后运行 `npm run deploy:worker`。由于 `wrangler.jsonc` 已包含正式 Route，**手动部署会直接更新正式网站**。

Python 后端、定时任务或行情脚本的改动不会被 Workers 发布，需按 `DEPLOYMENT.md` 单独更新 VPS。

## 2. 配置说明

`wrangler.jsonc`：

```jsonc
"workers_dev": true,
"routes": [
  { "pattern": "buythedip.kaida.sbs/*", "zone_name": "kaida.sbs" }
],
"assets": {
  "directory": "./dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*", "/data/*"]
},
"vars": { "ORIGIN_BASE": "https://buythedip.kaida.sbs" }
```

- `ORIGIN_BASE` 与正式域名相同。Route 模式下，Worker 对同一主机名发出的 fetch 使用原有源站（Tunnel），不会再次进入 Worker，所以不会循环。
- **不要把正式主机名改为 Worker Custom Domain。** Custom Domain 模式下 Worker 本身就是源站，同名回源会失效或循环。将来如要改用 Custom Domain，先建立独立的 Tunnel 回源主机名（例如 `origin-buythedip.kaida.sbs`），把 `ORIGIN_BASE` 改过去并验证，再切换。
- `public/.assetsignore` 排除本地行情快照，防止旧行情随前端发布。`/data/*` 和 `/api/*` 必须优先运行 Worker，不能落入 SPA 页面回退。

### 缓存

- 哈希 JS/CSS：浏览器长期缓存；发布后文件名改变。
- 行情静态快照：边缘缓存 300 秒。
- 代码查询与同码选择结果：边缘缓存 60 秒。
- 错误、重定向或非 JSON 回源结果：不缓存。
- 行情响应对浏览器 `max-age=0`，命中边缘缓存时同样强制设置。
- Cookie、Authorization 不转发给行情源站；只允许已定义的公开路径和查询参数。

`X-Market-Cache: HIT/MISS` 用于确认请求经过 Worker 及缓存状态。Cache API 按数据中心缓存，不是全网只回源一次；VPS 上原有的并发合并和持久缓存仍负责限制上游行情请求。检查缓存时不要加随机查询参数，API 会拒绝额外参数。

## 3. 排错

```sh
npx wrangler tail buythedip
```

然后刷新出错页面，按 Ctrl+C 退出。

- 行情接口返回 `origin_unavailable`（502）：Worker 连不上源站，检查 Tunnel 与 VPS 上的 Nginx/API。
- 行情接口返回网页而不是 JSON：检查 `run_worker_first` 是否仍包含 `/api/*`、`/data/*`。
- 本机 wrangler 报 `fetch failed`：多为本机代理或网络问题，确认能访问 `api.cloudflare.com` 后重试。

## 4. GitHub 自动部署（Workers Builds）

在 Cloudflare 控制台打开**已有的** buythedip Worker → Settings → Builds → Connect（Git repository）。不要另建 Worker。

| 设置 | 值 |
| --- | --- |
| 仓库 | ckd0817/buythedip |
| 生产分支 | main |
| 项目根目录 | 留空或 `/` |
| 构建命令 | `npm run build` |
| 部署命令 | `npx wrangler deploy` |
| Worker 名称 | buythedip，必须与 `wrangler.jsonc` 一致 |

GitHub 授权时只授权本仓库。连接后首次构建成功，即表示后续推送 `main` 会自动发布。若需暂停自动发布，在同一页面关闭或断开 Builds。

## 5. 回滚

### 只是某次前端发布有问题

在 Worker → Deployments 中选择之前可用的版本回滚，或在本机运行：

```sh
npx wrangler rollback
```

然后在 GitHub 上修复或撤回有问题的提交，避免下次自动构建重新发布。

### 完全撤回 Workers，恢复原 Tunnel 访问

1. Worker → Settings → Builds：暂停或断开自动部署。
2. Worker → Settings → Domains & Routes：删除 `buythedip.kaida.sbs/*` 这条 Route。删除后正式域名立即恢复由 Tunnel + VPS Nginx 提供原有页面和接口。
3. 确认 `https://buythedip.kaida.sbs/api/market?symbol=AAPL` 不再带 `X-Market-Cache` 响应头，页面正常。
4. 从 `wrangler.jsonc` 删除 `routes` 配置并提交，避免以后部署把 Route 加回来。

**不要删除 Tunnel、DNS 记录、VPS 服务、定时任务或行情数据。** 这些在迁移中都没有改动，回滚只需删除 Route。workers.dev 测试地址可以保留，不影响正式网站。
