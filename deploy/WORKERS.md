# Cloudflare Workers 部署

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

## 首次上线

1. 在 Cloudflare Workers & Pages 中连接本仓库，项目名为 `buythedip`。
2. 生产分支为 `main`，构建命令 `npm run build`，部署命令 `npx wrangler deploy`，根目录为仓库根目录。
3. 先通过生成的 `workers.dev` 地址检查页面、静态资源、QQQ/SPY/SMH、股票/基金搜索、历史图表及分享卡片。
4. 保留现有 Tunnel 和 `buythedip.kaida.sbs` 的代理 DNS 记录，在 Worker 路由中添加 `buythedip.kaida.sbs/*`，所属区域 `kaida.sbs`。

此处使用 Worker **Route**，不将正式主机名改成 Worker Custom Domain。Worker 在现有 Tunnel 源站前提供静态页面；同区域回源 `fetch()` 到原主机名时走原源站，不重新调用 Route。不要把该主机名同时配置成 Worker Custom Domain，否则会改变回源语义。

`ORIGIN_BASE` 在 `wrangler.jsonc` 中配置为现有正式主机名。未来如果改为 Custom Domain，必须先创建独立的 Tunnel 回源主机名，并同步修改该变量以避免循环。

## 缓存

- 哈希 JS/CSS：浏览器长期缓存；版本发布更换文件名。
- 行情静态快照：边缘缓存 300 秒。
- 代码查询与同码选择结果：边缘缓存 60 秒。
- 错误、重定向或非 JSON 回源结果：不缓存。
- 浏览器行情响应 `max-age=0`，不在浏览器长期保存。
- Cookie、Authorization 不转发给行情源站；只允许已定义的公开路径和查询参数。

响应头 `X-Market-Cache: HIT/MISS` 可用于验证边缘缓存。Cache API 是按数据中心缓存，并非全网每个代码只回源一次；原有服务端并发合并和持久缓存仍负责限制上游行情请求。

## 回滚

删除 Worker 的 `buythedip.kaida.sbs/*` Route，立即恢复现有 Tunnel + Nginx 页面。不要删除 Tunnel、DNS 或 VPS 的实时数据。Worker 内的前端版本也可以独立回滚。

Workers 不会自动部署 GitHub 中的 Python 更改。后端发布仍按 `DEPLOYMENT.md` 执行。部署平台改变不保证中国大陆运营商到 Cloudflare 的线路改善。
