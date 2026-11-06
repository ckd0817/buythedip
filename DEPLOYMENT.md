# 当前部署

URL: https://buythedip.kaida.sbs

初始SPY、QQQ、SMH，支持美股、沪深A股、港股/ETF搜索。所有标签等宽、无关闭按钮，容量满后从左向右替换最左侧标的，初始三个也参与替换。指标固定全部历史；图表快捷范围固定1年、3年、5年、10年。实验性其他市场指数入口保持关闭，API拒绝对应指数别名。

## 路由和目录

- Cloudflare Tunnel公开主机名 buythedip.kaida.sbs，源站 http://127.0.0.1:8080。
- Nginx保持既有8080监听，配置 /etc/nginx/sites-available/buythedip。
- /opt/buythedip/current 指向 /opt/buythedip/releases/ 下当前源码发布。
- /var/www/buythedip/current 指向当前发布的 dist。
- /data/ 独立映射 /var/www/buythedip/data/，发布前端时不要覆盖实时行情。
- /api/market 代理仅监听127.0.0.1:8081的 buythedip-api.service。其他/api路径404。
- 动态缓存 /var/lib/buythedip/instruments，由专用buythedip账号读写，不随发布替换。

## 服务

buythedip-api.service 开机启动，提供美股/ETF代码查询、共享缓存及后台刷新。

buythedip-update.timer 保持启用，纽约时间工作日18:30/20:30更新默认三个ETF。buythedip-update.service 使用 --market US。

CN/HK/JP区域定时器保持禁用，不重新启用。实验适配源码、旧行情和历史发布保留。

```sh
sudo systemctl status buythedip-api.service
sudo systemctl list-timers buythedip-update.timer
sudo journalctl -u buythedip-api.service -n 30 --no-pager
curl 'http://127.0.0.1:8081/api/market?symbol=AAPL'
```

## 发布和验证

本地 npm test 和 npm run build，打包dist、源码和Python脚本至新发布目录。切换源码链接后重启API，验证Nginx配置再重载，最后原子切换web链接。不要覆盖独立数据目录。恢复旧版本时同时恢复源码、web链接及相应API/Nginx配置。

验证HTTPS页面、构建资源、真实查询、固定快照、API服务和US定时器；检查手机和电脑标签布局、刷新记忆和失败查询。数据计算版本6，按标的单独静态JSON，所有精确行情缓存均位于发布外。

免费行情源仍为此前选定的Yahoo Finance及Cboe，公开展示授权未通过技术部署确立。

## 分享发布

新增浏览器本地生成的1080×1920 PNG分享卡片。发布需包含public/fonts及dist/fonts中的OFL字体；预置金句字体为小包，自定义汉字按Unicode范围加载额外字形包，首页不加载。Python行情API和独立实时数据无需调整。RSI名称统一使用半角括号 RSI (14)。

验证分享弹窗、中文28字/英文80字符上限、随机池边界0/50、PNG尺寸、两/三指标排版、链接参数及复制。Web Share API在真实HTTPS设备上由用户点击调用系统分享，未自动发送至任何社交平台。
