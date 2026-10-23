# devr（Short URL · v1.0.0）

将长链接转为短链接的小工具，完全开源、免费，可私有化部署，短链接可永久有效。

体验地址 👉 [devr.cn](https://devr.cn) —— 简单易用的短链接生成工具，链接永久有效！
Demo 地址 👉 [u.hecady.com](https://u.hecady.com)

> 当前版本为 **Node.js 24 + 内置 SQLite 后端 / Vue 3 + Vite 前端**，并内置管理后台：
> - 后端零原生依赖（仅 `bcryptjs` 一个纯 JS 包），数据库使用 Node 24 内置的 `node:sqlite`；
> - 短码算法、公开 API 与存量数据**完全兼容**，可从 PHP 版本无缝切换（同一个 SQLite 文件直接可用）；
> - **外链巡检在进程内定时执行**，不再需要外部 cron / supervisord 定时器；
> - 前端已用 Vue 3 + Vite 重写，视觉与交互保持一致。

![首页 · 浅色主题](docs/screenshot-home-light.png)

![首页 · 深色主题](docs/screenshot-home-dark.png)

## 功能特性

- **短链生成**：62 进制乱序编码短码，支持批量复制、逐条复制、下载二维码（前端生成）；
- **永久跳转**：短码 302 跳转到原链接，数据存 SQLite 单文件，不依赖独立数据库服务；
- **亮/暗双主题**：默认跟随系统偏好，可在页头手动切换并记忆（localStorage 持久化，首帧应用主题无白屏闪烁）；
- **管理后台**（`/admin`）：单管理员登录、全站概览与趋势（日/周/月/年四种粒度）、点击 Top 10、单链统计
  （独立访客 / 来源域名 / 设备分布）、短链编辑与删除、运行时设置、后台改密；
- **开放 API**：在后台「设置」页创建 API Key 后，外部程序可经 `POST /api/open/shorten`
  程序化创建短链（Bearer / X-API-Key 鉴权，明文 Key 仅创建时展示一次）；
- **短链缓存**：跳转结果缓存于 Memcached（本机或独立容器），命中时免查数据库；
  支持缓存有效期与负缓存配置，服务不可用时自动降级为直连数据库，跳转不受影响；
- **外链巡检**：进程内定时检测目标地址是否仍可访问（403/404/410/5xx/超时记为失效），
  后台可按状态筛选、一键清理失效项或就地更新链接；默认 24 小时复检一次；
- **点击统计**：跳转时自动记录点击（UTC 日切分、来源域名、设备类型、IP 匿名哈希估算独立访客），
  原始 IP 与 User-Agent 不入库；
- **SEO 与分享卡片**：内置 title/description、canonical、Open Graph、Twitter Card、微信/QQ 抓取器读取的
  `itemprop` 与 300×300 缩略图、JSON-LD 结构化数据；构建时生成 `robots.txt` 与 `sitemap.xml`。
  后台与短码跳转统一标记 `noindex`，避免短链与目标页重复收录；
- **隐私与安全**：登录态 HttpOnly Cookie、登录失败限流（15 分钟 5 次）、创建短链限流（默认 60 次/分钟/IP）、
  写操作同源校验、请求体与 URL 长度上限、安全响应头（CSP 等）默认开启、密码与 API Key 仅存哈希。

## 架构

```text
Vue 3 前端（apple-frontend/，Vite 构建，含 /admin 管理面板；端口 3000）
    ｜  另一套可选前端：src/（旧版，共用同一后端；端口 3300）
    ↓ HTTP（VITE_API_BASE_URL，留空同源）
Nginx（静态资源 /，其余反向代理）
    ↓ HTTP (proxy_pass)
Node.js 24 API（backend/，路由 → 服务 → 仓储）
    ↓ node:sqlite           ↑ ↓ 短链跳转缓存（未命中回源，写操作主动失效）
SQLite（backend/storage/short-url.sqlite3，单文件永久化，WAL 模式）
                             Memcached（本机或独立容器；不可用时自动降级为直连 SQLite）
    ↑ 进程内定时器（每日 12:00，后台可改）——外链巡检
```

## 两套前端

默认前端为 `apple-frontend/`（Apple 设计语言）：`npm run dev` 与 `npm run build` 都作用于它，
构建产物输出到项目根的 `dist/`，因此后端与部署脚本无需区分前端来源。
旧前端 `src/` 保留作为对照版本，通过 `legacy` 后缀的脚本运行。

| | Apple 设计语言前端（默认） | 旧前端（对照） |
| --- | --- | --- |
| 目录 | `apple-frontend/` | `src/` |
| 开发 | `npm run dev`（端口 3000） | `npm run dev:legacy`（端口 3300） |
| 构建 | `npm run build` → `dist/` | `npm run build:legacy` → `dist-legacy/` |
| 说明 | [apple-frontend/README.md](apple-frontend/README.md) | 本 README 其余部分 |

Apple 前端按 Apple 设计原则（弹簧动效、跟手 Sheet、分段控件滑动等）重写交互，
配色令牌与旧前端逐值一致（`npm run verify:tokens` 可断言）。

## 环境依赖

- **Node.js 24+**（必需：使用内置 `node:sqlite`，无需安装任何数据库）
- Node.js 20+（仅构建前端用，Vite 6 要求）
- Memcached（可选：未安装时缓存自动降级为直连数据库，功能不受影响）

> 从 PHP 版本升级：直接把 `backend/storage/short-url.sqlite3` 拷到新目录即可，表结构与短码算法完全一致；
> 后台改过的密码（bcrypt `$2y$` 哈希）继续有效。

## 快速开始（本地开发）

```bash
# 1. 安装后端依赖（只有一个纯 JS 依赖）
cd backend && npm install

# 2. 配置环境变量：复制 .env.example 为 backend/.env
#    （SQLite 默认路径即可直接使用，默认管理员 admin / admin123）
cp ../.env.example .env

# 3. 启动后端（端口 3001）
npm start          # 等价于 node src/server.js

# 4. 另开终端，安装前端依赖并启动开发服务（端口 3000）
cd .. && npm install
npm run dev
```

访问 <http://localhost:3000> 即可使用；直接访问后端 <http://localhost:3001/admin> 也可以。
API 细节见 [docs/API.md](docs/API.md)。

## 外链巡检

短链指向的外部页面可能失效（403/404/410、域名过期、服务下线等）。巡检会定期请求目标地址，
把结果记录在 `short_urls.health_status`，**不删除任何数据**；清理动作必须由管理员在后台确认。

- **每日定时巡检**：在后台「设置 → 定时巡检」中配置每天的执行时刻（默认 12:00，服务器本地时间）
  与开关，进程内调度、**无需外部 cron**；多进程部署时当天只有一个进程执行；
  也可用 `HEALTH_SCAN_ENABLED` / `HEALTH_SCAN_HOUR` / `HEALTH_SCAN_MINUTE` 作为默认值；
- **手动扫描**：后台列表上方「扫描外链」按钮，每次检测一批（默认 20 条），按钮上实时显示剩余待检数；
- **失效判定**：同一短链连续失败达到阈值（后台可设，默认 3 次）即视为「失效」，
  中途恢复会清零计数；列表页可按「失效」筛选，并「一键清理失效」批量删除（含点击记录）；
- **筛选与处理**：按「全部 / 失效 / 正常 / 未知」筛选；失效行会标红并给出 HTTP 状态码与连续失败次数，
  可直接点「更新链接」改目标地址；
- **判定口径**：2xx/3xx 为正常；401/403/404/410/451 等 4xx、5xx、连接被拒绝/重置（浏览器
  `ERR_CONNECTION_CLOSED`）、超时、域名不存在（NXDOMAIN）均判为失效；
  429/408（目标限流或请求超时）、内网/保留地址（主动跳过）、DNS 临时故障记为「无法判定」，
  不覆盖原状态、也不会被清理；「无法判定」的条目 10 分钟后会自动重试，避免状态长期停留；
- **安全边界**：巡检只允许 http/https，解析主机名后拒绝内网/环回/保留地址，
  连接时把已验证的 IP 固定下来（防 DNS 重绑定），不自动跟随跳转（逐跳重新校验），
  不读取响应体（HEAD 或 `Range: bytes=0-0`），单次请求 8s 超时。

```bash
# 手动补扫一轮（定时巡检已内置在服务进程里，这个命令用于排查）
cd backend && npm run scan-links -- --budget=600
```

## SEO 与分享

首页的 title、description、canonical、Open Graph、Twitter Card、微信/QQ 抓取器读取的 `itemprop`
与 `image_src`、JSON-LD 结构化数据都写在 `apple-frontend/index.html`，构建时由 `VITE_SITE_URL`
替换为绝对地址，并生成 `dist/robots.txt` 与 `dist/sitemap.xml`：

```bash
# .env（项目根目录）
VITE_SITE_URL=https://your-domain.com
```

- **必须是 https**：微信、QQ 等抓取器要求分享图与页面使用绝对 HTTPS 地址；未配置时回退到
  `APP_URL`（仅当其协议为 https），再回退到 `https://devr.cn`；
- **分享封面**：`apple-frontend/public/og-cover.png`（1200×630，Open Graph）与
  `share-thumb.png`（300×300，微信/QQ 缩略图），替换这两个文件即可换图；
- **不收录的路径**：后台 `/admin` 返回 noindex 且带 `X-Robots-Tag`；短码跳转同样带
  `X-Robots-Tag: noindex, nofollow`，避免短链与目标页重复收录；`robots.txt` 另禁止 `/api/` 与 `/healthz`；
- **访客访问**：若在后台关闭「访客访问」（要求创建短链必须登录），首页会把未登录访问者重定向到
  `/admin`，搜索引擎也无法收录首页。需要 SEO 时请保持访客访问开启；
- **微信自定义分享**：不带公众号 JS-SDK 时，微信使用页面 title、description 与页面内图片生成分享卡片；
  若需精确控制微信好友/朋友圈的标题、摘要与缩略图，需要公众号的 AppID/AppSecret 并接入
  `wx.config` 与 `updateAppMessageShareData`（当前未集成，避免在无凭据时暴露密钥）。

## 管理后台

访问 `/admin` 进入管理面板（首页页头也有入口），支持：

- **登录**：单管理员账号，凭据由环境变量配置；登录态为 HttpOnly + SameSite=Strict Cookie，有效期默认 7 天；
- **统计**：全站概览（短链总数/累计/今日点击）、趋势（日/周/月/年可切换）、点击 Top 10；单链维度含独立访客、来源域名 Top 10、设备分布（统计按 UTC 口径聚合）；
- **编辑**：修改目标链接与短码（改短码后旧码立即失效，点击统计自动迁移）；
- **删除**：删除短链并级联清除点击记录。

默认账号 `admin` / `admin123`，**生产环境务必修改**（推荐直接在后台「设置」页修改，或设置 `ADMIN_PASSWORD_HASH`）。

### 设置页

![管理后台 · 设置页](docs/screenshot-admin-settings.png)

「设置」选项卡提供运行时配置（**改动即自动保存**，即时生效，存于 SQLite，无需改环境变量重启）：

- **短链最小长度**（1-16）：新短码不足该长度时自动补齐，已有短链不受影响；
- **随机短码**：开启后新短码随机生成、不可预测（要求长度 ≥ 3，落库前查重）；
- **允许游客访问**：默认开启；关闭后首页仅管理员可用，未登录访客无法生成短链，访问首页将跳转登录页
  （此时登录页不再显示「返回首页」，避免往返循环）；
- **修改密码**：校验当前密码后更新（新密码至少 8 位），哈希优先于环境变量配置，并**撤销全部登录态**（所有端强制重新登录）。
- **短链缓存**：查看 Memcached 运行状态与命中统计，并配置缓存有效期与负缓存时长（0 = 关闭）。
- **定时巡检**：开关每日外链巡检、设置每天的执行时刻（HH:MM，服务器本地时间）与失效确认阈值
  （连续失败几次判定为失效，1-10）；修改后无需重启，多进程部署下当天只由一个进程执行。

「设置」页同时提供 **API Key 管理**（创建 / 重置 / 删除），供开放 API 程序化调用，见下文「开放 API」。

关闭后台自定义密码（恢复环境变量密码）目前需清空数据库 `settings` 表的 `admin_password_hash` 键。

```bash
# 生成密码哈希（用于 ADMIN_PASSWORD_HASH，兼容旧 PHP 版本的 bcrypt 哈希）
cd backend && node -e "console.log(require('bcryptjs').hashSync('你的密码', 10))"
```

```bash
# Docker Compose 部署时在项目根 .env 或 docker-compose.yml 中注入：
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2b$10$...
```

### 开放 API

在「设置」页创建 API Key 后，外部程序即可程序化创建短链（不受「创建需登录」门控影响）：

- Key 格式 `devr_` + 32 位十六进制；**明文仅在创建/重置时展示一次**，服务端只保存 sha256 哈希；
- 支持重置（旧 Key 立即失效、名称保留）与删除；列表展示 Key 前缀与最近使用时间；
- 鉴权方式：`Authorization: Bearer <key>` 或 `X-API-Key: <key>` 请求头。

```bash
# 调用开放 API（先在管理后台「设置」页创建 Key）：
curl -s -X POST https://your-domain/api/open/shorten \
    -H 'Authorization: Bearer devr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' \
    -H 'Content-Type: application/json' \
    -d '{"url": "https://github.com"}'
# => {"url":"https://github.com","code":"GGGS"}
```

接口细节见 [docs/API.md](docs/API.md)「开放 API」章节。

## 质量工具（backend/ 目录内执行）

```bash
npm test           # node:test：核心契约 / 管理后台 / 安全 / 巡检与缓存 / 仓储迁移
npm run scan-links # 手动补扫外链（定时任务已内置）
```

## 部署

### 方式一：Docker Compose（nginx + Node，推荐）

```bash
docker compose up -d --build
# 访问 http://localhost:3001
```

SQLite 数据文件通过命名卷 `app-data` 持久化（挂载到容器内 `/app/backend/storage`）。
compose 同时启动 `memcached` 服务，app 容器已通过 `MEMCACHED_SERVERS=memcached:11211` 接入；
设 `CACHE_DRIVER=none` 可关闭缓存。外链巡检由 app 进程内定时器执行，不需要额外的定时任务容器。

### 方式二：单容器（单机）

```bash
docker build -t devr .             # 默认 target：nginx + node + memcached 单容器
docker run -d -p 3001:80 devr
```

注意：单容器未挂载卷时，重建容器会丢失 SQLite 数据；持久化部署请为 `/app/backend/storage` 挂载卷。

### 方式三：裸机 / 宝塔（Node + Nginx 反代）

```bash
# 1. 构建前端
npm run build

# 2. 安装后端依赖并启动
cd backend && npm install --omit=dev
APP_PORT=3001 node src/server.js      # 建议用 PM2 / 宝塔 Node 项目管理器托管

# 3. Nginx：静态资源指向 dist/，其余 proxy_pass 到 127.0.0.1:3001
#    参考 deploy/nginx/short-url.conf 与 deploy/baota/nginx-rewrite.conf
```

要点：

- Node.js 24+（`node:sqlite` 依赖该版本）；
- 网站根目录指向 `dist/`；
- 反向代理需保留原始 `Host` 与 `X-Forwarded-Proto`（后端 CSRF 与 Cookie Secure 判定依赖它们）；
- 数据目录 `backend/storage/` 需要可写。

### 方式四：宝塔开箱即用部署包

```bash
npm run build
node deploy/build-baota-package.mjs   # 生成 baota-package/ 与 baota-package.zip（均已 gitignore）
```

包内为「前端产物 + Node 后端源码 + 依赖清单 + 伪静态 + 部署说明」，
上传解压后执行 `npm install --omit=dev` 并在宝塔 Node 项目管理器中启动即可。
**zip 内不含数据库**（`backend/storage/` 为空目录），覆盖解压永远不会影响已有短链数据。
详见包内 `部署说明.md`，或 [deploy/baota/部署说明.md](deploy/baota/部署说明.md)。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| DATABASE_PATH | backend/storage/short-url.sqlite3 | SQLite 数据库文件路径，目录不存在时自动创建 |
| APP_ENV | production | 运行环境 |
| APP_DEBUG | false | 调试模式，生产必须 false |
| APP_URL | 空 | 站点对外地址；为 https 时登录 Cookie 附带 Secure |
| APP_PORT | 3001 | 后端监听端口 |
| ADMIN_USERNAME | admin | 管理后台用户名 |
| ADMIN_PASSWORD | admin123 | 管理后台密码（生产务必修改） |
| ADMIN_PASSWORD_HASH | 空 | 密码哈希，设置后优先于 ADMIN_PASSWORD（兼容 PHP bcrypt） |
| ADMIN_TOKEN_TTL_DAYS | 7 | 登录态有效期（天） |
| DIST_INDEX | dist/index.html | `/admin` 返回的 SPA 入口 |
| VITE_API_BASE_URL | 空 | 前端 API 地址，构建时读取，留空为同源 |
| VITE_SITE_URL | https://devr.cn | 构建时写入 canonical / Open Graph / sitemap 的站点地址，须为 https；未配置时优先沿用协议为 https 的 APP_URL |
| ALLOWED_ORIGINS | 空 | 额外允许的跨站写操作来源（逗号分隔）；留空 = 仅同源 |
| CSRF_ALLOW_MISSING_ORIGIN | false | 写请求缺少 Origin/Referer 时是否放行（默认拒绝） |
| IP_HASH_SECRET | 空 | 设置后 IP 匿名哈希改用 HMAC-SHA256，密钥不随库存储（推荐设置） |
| MAX_BODY_BYTES | 16384 | 请求体上限（字节），超出返回 413 |
| CREATE_RATE_LIMIT_MAX | 60 | 单 IP 在窗口内允许创建的短链数；0 = 关闭限流 |
| CREATE_RATE_LIMIT_WINDOW | 60 | 创建限流窗口（秒） |
| PRIVACY_STORE_REFERER | false | 是否保存完整 Referer；默认仅保存来源域名 |
| HSTS_MAX_AGE | 0 | HSTS 有效期（秒）；确认全站 HTTPS 后设为 31536000 |
| CSP_SCRIPT_EXTRA | 空 | CSP 额外放行的脚本来源；留空默认放行 Google Analytics |
| CSP_CONNECT_EXTRA | 空 | 跨域部署时加入 CSP connect-src 的后端源 |
| CACHE_DRIVER | memcached | 短链跳转缓存驱动：memcached / none |
| MEMCACHED_SERVERS | 127.0.0.1:11211 | memcached 服务地址（逗号分隔 host:port） |
| CACHE_TTL | 300 | 缓存有效期（秒），0 = 不缓存；后台设置页可覆盖 |
| CACHE_NEGATIVE_TTL | 30 | 负缓存时长（秒），缓存“短码不存在”，0 = 关闭 |
| MEMCACHED_TIMEOUT_MS | 200 | memcached 连接/读写超时（毫秒） |
| HEALTH_TIMEOUT_SECONDS | 8 | 外链探测单次请求超时（秒） |
| HEALTH_CONNECT_TIMEOUT_SECONDS | 5 | 外链探测建连超时（秒） |
| HEALTH_STALE_HOURS | 24 | 同一短链的复检间隔（小时） |
| HEALTH_BATCH_SIZE | 20 | 每批扫描条数 |
| HEALTH_SCAN_ENABLED | true | 是否启用每日定时巡检（后台可覆盖） |
| HEALTH_SCAN_HOUR | 12 | 每日巡检小时（0-23，服务器本地时间） |
| HEALTH_SCAN_MINUTE | 0 | 每日巡检分钟（0-59） |
| HEALTH_DEAD_THRESHOLD | 3 | 连续失败多少次判定为失效（1-10） |

> 前端主题（亮/暗）不依赖环境变量：由页头按钮切换，存于浏览器 localStorage（`devr-theme`），
> 未设置时跟随系统 `prefers-color-scheme`。

### 安全默认值说明

- **`IP_HASH_SECRET` 建议设置**（例如 `openssl rand -hex 32` 的输出）。未设置时使用库内随机盐，
  数据库泄露后仍可离线爆破 IPv4 空间反推 IP；设置后改用 HMAC，密钥不随库存储。
  注意：变更该值会使历史独立访客数从零重新累计。
- **创建接口默认限流 60 次/分钟/IP**（公开接口与开放 API 共用）。内网或仅管理员使用时可用
  `CREATE_RATE_LIMIT_MAX=0` 关闭。
- **写操作默认要求同源**（校验 Origin/Referer，与 `SameSite=Strict` 双重防护）。跨域部署
  （`VITE_API_BASE_URL` 指向独立域）时需把后端信任的前端源写入 `ALLOWED_ORIGINS`，否则 403。
- **完整 Referer 默认不落库**，仅保留来源域名供「来源域名 Top 10」统计；需要原始 Referer 时设置
  `PRIVACY_STORE_REFERER=true`（注意来源页查询串可能含 token）。
- **安全响应头默认开启**（CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy /
  Permissions-Policy）。CSP 对 HTML 响应按内容哈希放行内联脚本，前端重新构建后自动匹配。
- **健康检查**：`GET /healthz` 返回 `{"ok":true,"links":N}`，可直接用于容器探活与监控。

## 目录结构

```text
short-url/
├── backend/               # Node.js 24 后端（零原生依赖）
│   ├── src/
│   │   ├── http/          # 路由、请求/响应、CSRF、限流、安全头、静态资源、服务器
│   │   ├── services/      # 短码、URL 校验、短链、点击、鉴权、设置、管理、API Key、巡检
│   │   ├── db/            # node:sqlite 连接、建表迁移与各仓储
│   │   ├── cache/         # Memcached 文本协议客户端 + 缓存装饰器
│   │   ├── support/       # 配置、.env、日志、加密、IP 匿名哈希
│   │   ├── cron.js        # 进程内定时巡检
│   │   └── server.js      # 服务入口
│   ├── tools/             # scan-links.js（手动补扫）、mock-memcached.js（本地验证缓存）
│   ├── tests/             # node:test（核心 / 管理 / 安全 / 巡检缓存 / 仓储迁移）
│   ├── storage/           # SQLite 数据库与 app.log / error.log
│   └── package.json
├── apple-frontend/        # 默认前端（Apple 设计语言，独立 Vite 配置，共用同一后端）
│   ├── index.html         # 入口（首帧前应用主题）
│   ├── vite.config.js     # 端口 3000；构建输出到项目根 dist/
│   └── src/               # motion/（弹簧引擎）/ styles/（设计令牌）/ components / home / admin
├── src/                   # 旧前端（对照保留，端口 3300）
├── public/                # 旧前端静态资源（favicon、manifest 等）
├── deploy/
│   ├── nginx/             # 通用(宝塔) / docker 单容器 / compose 三种 Nginx 配置
│   ├── baota/             # 宝塔部署包模板（伪静态、部署说明）
│   ├── build-baota-package.mjs  # 打包脚本（生成 baota-package/ 与 zip）
│   └── supervisord.conf   # 单容器进程托管（nginx + node + memcached）
├── tools/
│   └── generate-icons.mjs # 站点图标生成脚本
├── docs/                  # API / 历史迁移记录等文档
├── Dockerfile             # 多阶段构建（默认：nginx+node+memcached 单容器；--target app/web 供 compose 用）
└── docker-compose.yml     # 三容器部署（web + app + memcached）
```

## License

MIT（见 [License](License)）
