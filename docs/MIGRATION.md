# 迁移与演进记录（Node → PHP → Node.js 24 · Redis → SQLite · React → Vue）

> **当前版本**：后端为 **Node.js 24 + 内置 `node:sqlite`**，前端为 Vue 3 + Vite（默认 `apple-frontend/`）。
> 接口契约、数据库结构与短码算法在历次重写中保持一致，可直接沿用既有 SQLite 数据文件。

本文记录 short-url / devr 从原版（Node.js 单文件 + Redis + React）到当前版本
（Node.js 24 + SQLite + Vue 3）的完整演进：变更清单、行为差异与回滚方案。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 2 | Node.js/Express → PHP 8.2（分层后端） | ✅ 完成（历史） |
| Phase 3 | Redis → SQLite（存储层） | ✅ 完成，详见 [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md) |
| Phase 4 | React 18 (CRA) → Vue 3 (Vite)（前端重写） | ✅ 完成 |
| 增强 | 管理后台、登录认证、点击统计、运行时设置、开放 API（API Key）、安全加固（CSRF / 限流 / 请求体与 URL 上限 / 安全响应头）、短链缓存（Memcached，可降级）、统计趋势多粒度（日/周/月/年） | ✅ 完成，详见 [API.md](API.md) |
| 新前端 | `apple-frontend/`：Apple 设计语言前端，现为**默认前端**；旧 `src/` 保留为对照版本 | ✅ 完成，见 [apple-frontend/README.md](../apple-frontend/README.md) |
| 当前 | PHP 8.2 → **Node.js 24**（零原生依赖，内置 SQLite；新增外链巡检） | ✅ 完成（见 §1） |

历史分析文档（原项目架构与短码算法分析）见 [PHASE1_ANALYSIS.md](PHASE1_ANALYSIS.md)。

## 1. 当前版本：PHP 8.2 → Node.js 24 重写

### 1.1 动因与收益

- **零原生依赖**：数据库改用 Node 24 内置的 `node:sqlite`，唯一第三方依赖是纯 JS 的 `bcryptjs`；
  不再需要 PHP-FPM、Composer、`pdo_sqlite` 扩展，容器与裸机部署都更简单；
- **定时任务内置**：外链巡检由进程内 `setInterval` 执行，不再依赖外部 cron / supervisord 定时器；
- **部署链路统一**：前后端同为 Node 生态，Nginx 由 FastCGI 改为 `proxy_pass`，
  构建、依赖安装、进程托管都只需一套工具链。

### 1.2 模块映射（PHP → Node.js 24）

| PHP 版 | Node.js 版 |
| --- | --- |
| `backend/public/index.php`（前端控制器） | `backend/src/server.js` + `src/http/server.js` |
| `app/Http/{Router,Request,Response,ExceptionHandler}.php` | `src/http/{router,request,response}.js`（异常统一在 app 层兜底） |
| `app/Foundation/App.php`（组合根） | `src/http/app.js`（依赖装配与路由注册） |
| `app/Security/{CsrfGuard,RequestRateLimiter,SecurityHeaders}.php` | `src/http/security.js` |
| `app/Controllers/*.php` | `src/http/app.js` 内的路由处理（薄层，逻辑在 service） |
| `app/Services/*.php` | `src/services/*.js`（命名一一对应，如 `ShortUrlService` → `shortUrlService.js`） |
| `app/Repositories/Sqlite*.php` | `src/db/*Repository.js` |
| `app/Services/DatabaseService.php`（PDO + 建表） | `src/db/database.js`（`node:sqlite` + 幂等建表/加列迁移） |
| `app/Cache/*.php`（Memcached 扩展） | `src/cache/*.js`（自实现 Memcached 文本协议客户端，无扩展依赖） |
| `app/Support/{Config,Env,Logger,IpHasher}.php` | `src/config.js`、`src/support/{env,logger,crypto}.js` |
| `app/Validation/UrlValidator.php` | `src/services/urlValidator.js` |
| （无） | `src/cron.js`（进程内巡检定时器） |
| （无） | `src/services/linkHealthService.js` + `httpLinkProbe.js`（外链巡检） |
| `tests/`（PHPUnit） | `tests/*.test.js`（`node --test`） |
| `tools/*.php` | `tools/scan-links.js`、`tools/mock-memcached.js` |

### 1.3 兼容性说明

| 维度 | 结论 |
| --- | --- |
| 公开 API | 路由、请求/响应结构、状态码完全不变（见 [API.md](API.md)），前端与开放 API 调用方无需改动 |
| 数据库 | 同一个 SQLite 文件直接可用：表结构与字段一致，短码算法逐位一致 |
| 管理员密码 | 兼容 PHP 写入的 bcrypt `$2y$` 哈希，改密后写出的 `$2b$` 亦被两种运行时识别 |
| 登录态 | 仍为 HttpOnly + SameSite=Strict Cookie；迁移后既有 Cookie 继续有效（token 表结构未变） |
| 缓存 | 数据不共享（Memcached 为纯缓存），切换后自动重新回填，无需处理 |
| 新增字段 | `short_urls` 增加巡检列（`health_status` 等），启动时自动加列，旧库无需手工迁移 |

### 1.4 新增能力（本次重写引入）

- **外链巡检**：定时（默认每小时一轮）检测目标地址，结果写入 `short_urls.health_*`，**从不自动删除数据**；
  后台可按状态筛选、手动分批扫描、更新失效链接、一键清理失效项；
  判定口径与安全边界（拒绝内网/环回地址、防 DNS 重绑定、不跟随跳转、不读响应体）见 README「外链巡检」；
- **`GET /healthz`**：返回 `{"ok":true,"links":N}`，供容器探活与监控；
- **手动补扫工具**：`cd backend && npm run scan-links -- --budget=600`。

### 1.5 环境变量变更

| 变化 | 变量 |
| --- | --- |
| 新增 | `HEALTH_TIMEOUT_SECONDS`、`HEALTH_CONNECT_TIMEOUT_SECONDS`、`HEALTH_STALE_HOURS`、`HEALTH_BATCH_SIZE`、`HEALTH_SCAN_ENABLED`、`HEALTH_SCAN_INTERVAL_SECONDS` |
| 语义调整 | `MEMCACHED_SERVERS`（不再依赖 PHP 扩展，服务不可用即降级）；`ADMIN_PASSWORD_HASH` 兼容 `$2y$`/`$2b$` |
| 保持不变 | 其余全部变量含义与默认值不变（`APP_*`、`DATABASE_PATH`、`ADMIN_*`、`CACHE_*`、`CSRF_*`、`ALLOWED_ORIGINS`、`MAX_BODY_BYTES`、`CREATE_RATE_LIMIT_*`、`IP_HASH_SECRET`、`PRIVACY_STORE_REFERER`、`HSTS_MAX_AGE`、`CSP_*`、`DIST_INDEX`、`VITE_API_BASE_URL`） |

### 1.6 部署变化

| 项目 | PHP 版 | Node.js 版 |
| --- | --- | --- |
| Nginx 上游 | `fastcgi_pass` → PHP-FPM | `proxy_pass http://127.0.0.1:3001`，需保留原始 `Host` 与 `X-Forwarded-Proto` |
| 进程托管 | PHP-FPM / supervisord | PM2 / 宝塔 Node 项目管理器 / supervisord |
| 依赖安装 | `composer install --no-dev` | `npm install --omit=dev`（仅 bcryptjs） |
| 运行时要求 | PHP 8.2 + 扩展 | **Node.js 24+**（`node:sqlite` 依赖该版本） |
| 自检 | `check.php` 页面 | `GET /healthz` |
| 定时任务 | 外部 cron / supervisord | 进程内定时器（无需外部调度） |

## 2. 原始 → 现状总览

| 原始（Node.js 单文件版） | 现状（当前版本） |
| --- | --- |
| `server.js` 单文件后端（67 行） | `backend/` 分层应用（router → service → db），Node.js 24 |
| Express + node-redis + dotenv + morgan | Node 原生 `http` 模块 + 内置 `node:sqlite`，唯一依赖 `bcryptjs` |
| Redis（`short-url:code` 计数器 + `short-url:map` 哈希） | SQLite 单文件（WAL 模式，9 张表，见 [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md)） |
| React 18 + CRA 5 + Redux Toolkit | Vue 3.5 + Vite 6（默认 apple-frontend，原 React 版已退役） |
| `npm run server`（端口 3001） | `node src/server.js` / PM2 + Nginx 反代 |
| Express 托管 `build/` 静态资源 | Nginx 托管 `dist/`，其余 `proxy_pass` 到 Node |
| Dockerfile：node:16 单容器 | 多阶段构建：Vite 构建 → npm ci → nginx + node（+ memcached） |
| fly.io 部署（fly.toml + GitHub Actions） | 移除；提供 Docker Compose / 单容器 / 宝塔三种部署 |
| 仅创建短链 + 跳转 | 管理后台 `/admin`（认证、统计、编辑、设置）、开放 API、缓存、外链巡检 |

## 3. server.js → PHP 模块映射（历史，Phase 2）

> 以下为当时的 PHP 实现记录，现已被 Node.js 24 实现取代（映射关系见 §1.2）。

| server.js 中的代码 | PHP 对应 |
| --- | --- |
| `redis.createClient({...})` 连接/认证/重连 | 先 `RedisService`，后由 `DatabaseService`（PDO SQLite）取代 |
| `redisKey = {code, map}` | 先 `config('redis.keys.*')`，后由 SQLite 表 `short_url_counter` / `short_urls` 取代 |
| `_alphabet` + `encode(id)` | `app/Services/ShortCodeService.php::encode()`（逐位一致） |
| `app.get('/:code')` 跳转 | `app/Controllers/UrlController.php::redirect()`（302） |
| `app.post('/url')` 创建 | `app/Controllers/UrlController.php::create()`（200） |
| `encodeURI(url)` + 正则校验 | `app/Validation/UrlValidator.php`（重新设计，见 §5） |
| `morgan` 请求日志 | `app/Support/Logger.php`（JSON 行日志，不记录请求体） |
| `express.json()` | `app/Http/Request.php::json()` |
| `dotenv` | `app/Support/Env.php` + `config/config.php` |

## 4. 前端 React → Vue 映射

| React 版 | Vue 3 版（默认 apple-frontend / 对照 src） |
| --- | --- |
| `public/index.html` + `src/index.js`（CRA 入口） | `apple-frontend/index.html` + `apple-frontend/src/main.js`（Vite 入口） |
| `src/App.js`、`src/components/{Header,Search,Entity,Body,Button,Error}.js` | `apple-frontend/src/home/*`（首页三件套）与 `components/*` |
| `src/store.js` + `src/reducers/{entityReducer,errorReducer}.js`（Redux Toolkit） | `apple-frontend/src/stores/shortUrl.js`（Pinia） |
| `src/services/entity.js`（`REACT_APP_API_BASE_URL`） | 同名文件，改读 `VITE_API_BASE_URL`，并扩展管理端 API 封装 |
| `react-scripts`（webpack，dev 3000 + proxy） | Vite 6（dev 3000，`/url`、`/api`、`/admin` 与短码路由代理到 3001；`changeOrigin: false` 保留浏览器原始 Host 头，供后端 CSRF 同源判定） |
| （无对应物，后续新增） | 亮/暗主题（设计令牌 + 首帧防闪烁）、Apple 设计语言交互（弹簧动效、跟手 Sheet、分段控件） |
| `qrcode` / `copy-to-clipboard` / `file-saver` / `axios` | 原样保留，功能不变 |

二维码仍在浏览器端生成，服务端不参与。两套前端共用同一后端与数据库：
`npm run dev` / `npm run build` 作用于 `apple-frontend/`（产物 `dist/`），
`npm run dev:legacy` / `npm run build:legacy` 作用于 `src/`（产物 `dist-legacy/`）。

## 5. 行为差异（相对原 Node 单文件版，逐项声明）

| # | 差异 | 原因 | 影响 |
| --- | --- | --- | --- |
| 1 | URL 中含空白字符由"编码后放行"改为"400 拒绝" | 原行为会把脏 URL 存入存储 | 仅影响新链接创建 |
| 2 | 已含合法 `%XX` 的 URL 不再二次编码 | 原 `encodeURI` 会把 `%` 编成 `%25`，导致存量常见带参链接跳转错误，属缺陷修复 | 仅影响新链接创建 |
| 3 | 首尾空白 trim 后存储 | 原版会把空格一并编码存入 | 仅影响新链接创建 |
| 4 | 方法不允许返回 405（原为 404） | 状态码规范化 | 对旧前端无影响（它只用 200/400/404/302） |
| 5 | 存储不可用返回 503 JSON | 原版进程会不断重连重试 | 对旧前端无影响 |
| 6 | 多段路径 404 响应体由 Express HTML 改为 JSON `{"error":"Not Found"}` | 状态码仍 404，语义不变 | 无 |
| 7 | 日志不再输出完整请求体（morgan `:body`） | 日志安全 | 无 |
| 8 | 新增 `POST /api/url` 规范别名 | 接口规范化 | 原 `/url` 保留，旧调用不受影响 |

除上表外，公开 API 的请求/响应结构、状态码、短码与原版一致。

## 6. 环境变量变更汇总

| 原版（Node + Redis） | 现状 | 说明 |
| --- | --- | --- |
| REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD / REDIS_DATABASE | （删除） | SQLite 无需这些配置 |
| REACT_APP_API_BASE_URL | VITE_API_BASE_URL | 前端 API 地址，构建时读取，留空同源 |
| （无） | APP_ENV / APP_DEBUG / APP_URL / APP_PORT | 应用基础配置 |
| （无） | DATABASE_PATH | SQLite 文件路径，默认 `backend/storage/short-url.sqlite3` |
| （无） | ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_PASSWORD_HASH / ADMIN_TOKEN_TTL_DAYS | 管理后台凭据（哈希兼容 `$2y$`/`$2b$`） |
| （无） | DIST_INDEX | `/admin` 返回的 SPA 入口路径 |
| （无） | CACHE_DRIVER / MEMCACHED_SERVERS / CACHE_TTL / CACHE_NEGATIVE_TTL / MEMCACHED_TIMEOUT_MS | 短链跳转缓存（Memcached，可降级为直连数据库） |
| （无） | ALLOWED_ORIGINS / CSRF_ALLOW_MISSING_ORIGIN / MAX_BODY_BYTES / CREATE_RATE_LIMIT_MAX / CREATE_RATE_LIMIT_WINDOW / IP_HASH_SECRET / PRIVACY_STORE_REFERER / HSTS_MAX_AGE | 安全加固相关配置 |
| （无） | HEALTH_TIMEOUT_SECONDS / HEALTH_CONNECT_TIMEOUT_SECONDS / HEALTH_STALE_HOURS / HEALTH_BATCH_SIZE / HEALTH_SCAN_ENABLED / HEALTH_SCAN_INTERVAL_SECONDS | 外链巡检配置（进程内定时任务） |

`.env` 加载顺序：`backend/.env` → 项目根 `.env`（先找到的生效）；真实环境变量始终优先于 `.env`。

## 7. 删除的文件汇总

| 文件 | 原因 |
| --- | --- |
| `server.js` / `server.rest` | 已被 `backend/` 完整替代（Git 历史中可随时找回） |
| `Jenkinsfile` | 内容为错误命令（`sh 'node build'`），且未被任何流水线引用 |
| `fly.toml` / `.github/workflows/fly.yml` | fly.io 部署链路，不再使用 |
| `src/**.js`（React 组件、reducer、store、CRA 入口） | 被 Vue 3 版本替代（同名功能见 `src/**.vue` 与 `src/stores/`） |
| `backend/**/*.php`、`composer.json`、`composer.lock`、`phpunit.xml`、`phpstan.neon`、`.php-cs-fixer.dist.php` | Node.js 24 重写后不再需要（Git 历史中可找回） |
| `deploy/build-baota-package.php`、`deploy/baota/public/{index.php,check.php,.htaccess}` | 打包脚本改为 `build-baota-package.mjs`；自检改为 `GET /healthz` |

## 8. 部署拓扑变化

```text
原版： React build ── Express(3001) ── Redis（既是唯一存储，也是唯一数据源）
历史： Nginx ── FastCGI ── PHP-FPM ── PDO ── SQLite
现版： Nginx ─┬─ 静态：Vue dist/
              └─ HTTP 反代 ── Node.js 24 ── node:sqlite ── SQLite（单文件，唯一数据源）
                                    └─ 短链跳转缓存 ── Memcached（可降级，非数据源）
                                    └─ 进程内定时器 ── 外链巡检
```

- Docker Compose：`web`(nginx) + `app`(node) + `memcached` 三容器，命名卷 `app-data` 持久化数据库；
  memcached 仅内网可达（不暴露端口），不可用时 app 自动降级为直连 SQLite；
- 单容器：nginx + node + memcached 由 supervisord 托管；
- 宝塔：见 [BAOTA_DEPLOY.md](BAOTA_DEPLOY.md)；开箱即用部署包由
  `node deploy/build-baota-package.mjs` 生成（前端产物 + Node 源码 + 依赖清单，解压后 `npm install --omit=dev`）。

## 9. 回滚方案

1. **Node → PHP 回滚**：接口与数据库完全兼容，回滚代码后沿用同一个 SQLite 文件即可；
   巡检新增的 `health_*` 列对旧代码无影响（PHP 版会忽略）。注意 `$2b$` 密码哈希需 PHP ≥ 7.4。
2. **数据层**：SQLite 与 Redis 为两套独立数据，不互通。从最早期 Redis 版升级产生的短链只存在 SQLite 中；
   回滚到 Redis 版前请先评估数据取舍（见 [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md) §6）。
3. **应用层回滚**：`git checkout <对应提交>` 重新部署即可；建议升级前为当前可用镜像保留 tag。
4. **管理后台回滚不可逆项**：在后台「设置」页修改过的密码（哈希存于 SQLite `settings` 表）
   回滚代码后不生效，需用环境变量凭据登录。

## 10. 迁移后验证清单

```bash
# 后端测试（node:test）
cd backend && npm install && npm test

# 真机冒烟
npm start
curl -s http://127.0.0.1:3001/healthz          # {"ok":true,"links":N}
curl -s -X POST http://127.0.0.1:3001/url \
    -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3001' \
    -d '{"url":"https://example.com"}'
curl -sI http://127.0.0.1:3001/<上一步返回的 code>
curl -s http://127.0.0.1:3001/api/auth/me      # {"authenticated":false,"require_login":false}

# 外链巡检补扫（定时任务已内置）
npm run scan-links -- --budget=60
```

浏览器访问 `/admin`，用默认账号登录后检查统计、设置、巡检筛选与改密。
