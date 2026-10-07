# devr（Short URL · v0.3.0）

将长链接转为短链接的小工具，完全开源、免费，可私有化部署，短链接可永久有效。

体验地址 👉 [devr.cn](https://devr.cn) —— 简单易用的短链接生成工具，链接永久有效！
Demo 地址 👉 [u.hecady.com](https://u.hecady.com)

> 当前版本为 **PHP 8.2 + SQLite 后端 / Vue 3 + Vite 前端** 的完全体，并内置管理后台：
> - 短码算法、公开 API 行为与原 Node.js 版**完全兼容**；SQLite 单文件永久化，无需独立数据库服务；
> - 前端已用 Vue 3 + Vite 重写（原 React 版退役），视觉与交互保持一致；
> - 新增管理后台：登录认证、全站/单链点击统计、短链编辑删除、运行时设置（无需重启即时生效）；
> - 迁移与演进记录见 [docs/MIGRATION.md](docs/MIGRATION.md)。

![首页 · 浅色主题](docs/screenshot-home-light.png)

![首页 · 深色主题](docs/screenshot-home-dark.png)

## 功能特性

- **短链生成**：62 进制乱序编码短码，支持批量复制、逐条复制、下载二维码（前端生成）；
- **永久跳转**：短码 302 跳转到原链接，数据存 SQLite 单文件，不依赖外部服务；
- **亮/暗双主题**：默认跟随系统偏好，可在页头手动切换并记忆（localStorage 持久化，首帧应用主题无白屏闪烁）；
- **管理后台**（`/admin`）：单管理员登录、全站概览与近 14 天趋势、点击 Top 10、单链统计
  （独立访客 / 来源域名 / 设备分布）、短链编辑与删除、运行时设置、后台改密；
- **开放 API**：在后台「设置」页创建 API Key 后，外部程序可经 `POST /api/open/shorten`
  程序化创建短链（Bearer / X-API-Key 鉴权，明文 Key 仅创建时展示一次）；
- **短链缓存**：跳转结果缓存于 Memcached（本机或独立容器），命中时免查数据库；
  支持缓存有效期与负缓存配置，服务不可用时自动降级为直连数据库，跳转不受影响；
- **点击统计**：跳转时自动记录点击（UTC 日切分、来源域名、设备类型、IP 匿名哈希估算独立访客），
  原始 IP 与 User-Agent 不入库；
- **隐私与安全**：登录态 HttpOnly Cookie、登录失败限流（15 分钟 5 次）、创建短链限流（默认 60 次/分钟/IP）、
  写操作同源校验、请求体与 URL 长度上限、安全响应头（CSP 等）默认开启、密码与 API Key 仅存哈希。

## 架构

```text
Vue 3 前端（src/，Vite 构建，含 /admin 管理面板）
    ↓ HTTP（VITE_API_BASE_URL，留空同源）
Nginx（静态资源 /，其余转发）
    ↓ FastCGI
PHP 8.2 API（backend/，Controller → Service → Repository）
    ↓ PDO                      ↑ ↓ 短链跳转缓存（未命中回源，写操作主动失效）
SQLite（backend/storage/short-url.sqlite3，单文件永久化，WAL 模式）
                                Memcached（本机或独立容器；不可用时自动降级为直连 SQLite）
```

## 环境依赖

- PHP 8.2+（扩展：pdo_sqlite、json、mbstring；可选 memcached 用于短链缓存）
- Memcached（可选：未安装时缓存自动降级为直连数据库，功能不受影响）
- Composer 2.x
- NodeJS 20+（仅构建前端用，Vite 6 要求）

## 快速开始（本地开发）

```bash
# 1. 前端依赖
npm install

# 2. PHP 后端依赖
cd backend && composer install

# 3. 配置环境变量：复制 .env.example 为 .env（SQLite 默认路径即可直接使用）

# 4. 启动 PHP 后端（端口 3001）
composer serve        # 等价于 php -S 0.0.0.0:3001 -t public public/index.php

# 5. 启动 Vue 前端开发服务（端口 3000，/url、/api 经 Vite proxy 转发到 3001）
npm run dev
```

访问 <http://localhost:3000> 即可使用；API 细节见 [docs/API.md](docs/API.md)。

## 管理后台

访问 `/admin` 进入管理面板（首页页头也有入口），支持：

- **登录**：单管理员账号，凭据由环境变量配置；登录态为 HttpOnly + SameSite=Strict Cookie，有效期默认 7 天；
- **统计**：全站概览（短链总数/累计/今日点击）、近 14 天趋势、点击 Top 10；单链维度含独立访客、来源域名 Top 10、设备分布（统计按 UTC 日切分）；
- **编辑**：修改目标链接与短码（改短码后旧码立即失效，点击统计自动迁移）；
- **删除**：删除短链并级联清除点击记录。

默认账号 `admin` / `admin123`，**生产环境务必修改**（推荐直接在后台「设置」页修改，或设置 `ADMIN_PASSWORD_HASH`）。

### 设置页

![管理后台 · 设置页](docs/screenshot-admin-settings.png)

「设置」选项卡提供运行时配置（**改动即自动保存**，即时生效，存于 SQLite，无需改环境变量重启）：

- **短链最小长度**（1-16）：新短码不足该长度时自动补齐，已有短链不受影响；
- **随机短码**：开启后新短码随机生成、不可预测（要求长度 ≥ 3，落库前查重）；
- **创建短链需要登录**：开启后首页仅管理员可生成短链，未登录访问首页将跳转登录页
  （此时登录页不再显示「返回首页」，避免往返循环）；
- **修改密码**：校验当前密码后更新（新密码至少 8 位），哈希优先于环境变量配置，并**撤销全部登录态**（所有端强制重新登录）。
- **短链缓存**：查看 Memcached 运行状态与命中统计，并配置缓存有效期与负缓存时长（0 = 关闭）。

「设置」页同时提供 **API Key 管理**（创建 / 重置 / 删除），供开放 API 程序化调用，见下文「开放 API」。

关闭后台自定义密码（恢复环境变量密码）目前需清空数据库 `settings` 表的 `admin_password_hash` 键。

```bash
# 生成密码哈希（用于 ADMIN_PASSWORD_HASH）
php -r "echo password_hash('你的密码', PASSWORD_DEFAULT);"
```

```bash
# Docker Compose 部署时在 backend 同级 .env 或 docker-compose.yml 中注入：
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2y$10$...
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
composer test      # PHPUnit：单元 + Feature（含 SQLite 仓库集成测试）
composer analyse   # PHPStan level 8 静态分析
composer lint      # PHP-CS-Fixer 代码风格检查（lint:fix 自动修复）
```

### 本地验证短链缓存

未安装 Memcached 时缓存会自动降级（功能不受影响）。需验证缓存链路时：

```bash
# 1. 启动仓库自带的 memcached 文本协议 mock（无需安装 memcached）
php tools/mock-memcached.php 11222

# 2. 指定该地址启动后端（PHP 需已启用 memcached 扩展：-d extension=memcached）
MEMCACHED_SERVERS=127.0.0.1:11222 composer serve
```

在后台「设置」页可看到驱动状态为运行中，命中统计随跳转次数增长。

## 部署

### 方式一：Docker Compose（nginx + php-fpm，推荐）

```bash
docker compose up -d --build
# 访问 http://localhost:3001
```

SQLite 数据文件通过命名卷 `app-data` 持久化（挂载到容器内 `/app/backend/storage`）。

compose 同时启动 `memcached` 服务，app 容器已通过 `MEMCACHED_SERVERS=memcached:11211` 接入；
设 `CACHE_DRIVER=none` 可关闭缓存。

### 方式二：单容器（单机）

```bash
docker build -t short-url .        # 默认 target：nginx + php-fpm 单容器
docker run -d -p 3001:80 short-url
```

注意：单容器未挂载卷时，重建容器会丢失 SQLite 数据；持久化部署请为 `/app/backend/storage` 挂载卷。

### 方式三：宝塔面板 / 裸机 Nginx + PHP-FPM

前端先构建：项目根目录执行 `npm run build`（生成 dist 目录，不要删除）。

Nginx 站点配置与逐项说明见 **[docs/BAOTA_DEPLOY.md](docs/BAOTA_DEPLOY.md)**，参考配置文件为 [deploy/nginx/short-url.conf](deploy/nginx/short-url.conf)。

要点：

- 网站根目录指向 `dist/`；
- PHP 版本 8.2，需启用 pdo_sqlite、mbstring、fileinfo 扩展；
- 伪静态/回退规则：非静态资源一律转发到 `backend/public/index.php`。

### 方式四：宝塔开箱即用部署包

不想从源码折腾，可打一个自包含部署包（含编译好的前后端与生产配置，标准 PHP 结构，
`public/` 为 Web 运行目录，Apache 零配置、Nginx 仅需粘贴一次伪静态）：

```bash
npm run build
php deploy/build-baota-package.php    # 生成 baota-package/ 与单文件 baota-package.zip（均已 gitignore）
```

上传 `baota-package.zip` 到站点目录解压即可完成首次部署或更新：**zip 内不含 `storage/`**
（数据库与日志由程序在服务器上自动创建），覆盖解压永远不会影响已有短链数据；
更新时唯一要注意的是 `.env`（zip 内含生产默认配置，覆盖会替换服务器上改过的值，
请在解压时跳过该文件或先备份）。

上传步骤与自检页（`/check.php`，排障完成后请删除）说明见包内 `部署说明.md`，
亦可参考 [deploy/baota/部署说明.md](deploy/baota/部署说明.md)。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| DATABASE_PATH | backend/storage/short-url.sqlite3 | SQLite 数据库文件路径，目录不存在时自动创建 |
| APP_ENV | production | 运行环境 |
| APP_DEBUG | false | 调试模式，生产必须 false |
| APP_URL | 空 | 站点对外地址；为 https 时登录 Cookie 附带 Secure |
| APP_PORT | 3001 | 本地开发服务器端口 |
| ADMIN_USERNAME | admin | 管理后台用户名 |
| ADMIN_PASSWORD | admin123 | 管理后台密码（生产务必修改） |
| ADMIN_PASSWORD_HASH | 空 | 密码哈希，设置后优先于 ADMIN_PASSWORD |
| ADMIN_TOKEN_TTL_DAYS | 7 | 登录态有效期（天） |
| DIST_INDEX | dist/index.html | `/admin` 返回的 SPA 入口；部署包布局下为 public/index.html |
| VITE_API_BASE_URL | 空 | 前端 API 地址，构建时读取，留空为同源 |
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
- **宝塔部署包自检页**：`/check.php` 逐项检查 PHP 版本、扩展、storage 可写与路由转发，
  探针短链用完即清理；排障完成后请删除 `public/check.php`。

## 目录结构

```text
short-url/
├── backend/               # PHP 8.2 后端
│   ├── app/               # Controller / Service / Repository / Http / Validation / Support
│   ├── config/            # 唯一读取环境变量的地方
│   ├── public/index.php   # 前端控制器
│   ├── routes/web.php     # 公开接口 + /api/auth/*、/api/admin/*、GET /admin、GET /{code}
│   ├── storage/           # SQLite 数据库（short-url.sqlite3）与 app.log / error.log
│   └── tests/             # PHPUnit（Unit / Feature / Compat / Doubles）
├── src/                   # Vue 3 前端（Vite）
│   ├── components/        # 通用组件 + admin/（登录、设置、编辑与统计弹窗）
│   ├── views/             # AdminPage.vue 管理面板页
│   ├── stores/            # Pinia 状态（shortUrl.js）
│   └── services/          # API 封装（entity.js）
├── public/                # 前端静态资源（favicon、manifest 等）
├── deploy/
│   ├── nginx/             # 通用(宝塔) / docker 单容器 / compose 三种 Nginx 配置
│   ├── baota/             # 开箱即用部署包的伪静态、public 骨架与部署说明
│   ├── build-baota-package.php  # 打包脚本（生成 baota-package/ 与单文件 baota-package.zip）
│   └── supervisord.conf   # 单容器进程托管
├── tools/
│   └── generate-icons.mjs # 站点图标生成脚本（node tools/generate-icons.mjs 重制 favicon.ico / logo100.png）
├── docs/                  # API / 迁移 / 宝塔部署等文档
├── Dockerfile             # 多阶段构建（默认：nginx+php-fpm 单容器；--target app/web 供 compose 用）
└── docker-compose.yml     # 双容器部署（web + app）
```

## License

MIT（见 [License](License)）
