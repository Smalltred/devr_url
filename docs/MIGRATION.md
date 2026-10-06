# 迁移与演进记录（Node.js → PHP · Redis → SQLite · React → Vue）

本文记录 short-url 从原版（Node.js 单文件 + Redis + React）演进到当前版本
（PHP 8.2 + SQLite + Vue 3）的完整变更清单、行为差异与回滚方案。

三段迁移均已完成，公开 API 与短码算法保持兼容：

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 2 | Node.js/Express → PHP 8.2（分层后端） | ✅ 完成 |
| Phase 3 | Redis → SQLite（存储层） | ✅ 完成，详见 [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md) |
| Phase 4 | React 18 (CRA) → Vue 3 (Vite)（前端重写） | ✅ 完成 |
| 增强 | 管理后台、登录认证、点击统计、运行时设置、开放 API（API Key）、安全加固（CSRF / 限流 / 请求体与 URL 上限 / 安全响应头） | ✅ 完成，详见 [API.md](API.md) |

历史分析文档（原项目架构与短码算法分析）见 [PHASE1_ANALYSIS.md](PHASE1_ANALYSIS.md)。

## 1. 原始 → 现状总览

| 原始（Node.js 版） | 现状（当前版本） |
| --- | --- |
| `server.js` 单文件后端（67 行） | `backend/` 分层应用（Controller → Service → Repository） |
| Express + node-redis + dotenv + morgan | 纯 PHP 8.2，**零运行时 Composer 依赖** |
| Redis（`short-url:code` 计数器 + `short-url:map` 哈希） | SQLite 单文件（WAL 模式，7 张表，见 [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md)） |
| React 18 + CRA 5 + Redux Toolkit | Vue 3.5 + Vite 6 + Pinia + Tailwind 3.4 |
| `npm run server`（端口 3001） | `composer serve` / PHP-FPM + Nginx |
| Express 托管 `build/` 静态资源 | Nginx 托管 `dist/`，其余路径转发 PHP |
| Dockerfile：node:16 单容器 | 多阶段构建：Vite 构建 → composer → nginx+php-fpm |
| fly.io 部署（fly.toml + GitHub Actions） | 移除；提供 Docker Compose / 单容器 / 宝塔三种部署 |
| 仅创建短链 + 跳转 | 新增管理后台 `/admin`（认证、统计、编辑、设置） |

## 2. server.js → PHP 模块映射

| server.js 中的代码 | PHP 对应 |
| --- | --- |
| `redis.createClient({...})` 连接/认证/重连 | 先 `RedisService`，后由 `DatabaseService`（PDO SQLite）取代 |
| `redisKey = {code, map}` | 先 `config('redis.keys.*')`，后由 SQLite 表 `short_url_counter` / `short_urls` 取代 |
| `_alphabet` + `encode(id)` | `app/Services/ShortCodeService.php::encode()`（逐位一致） |
| `app.get('/:code')` 跳转 | `app/Controllers/UrlController.php::redirect()`（302） |
| `app.post('/url')` 创建 | `app/Controllers/UrlController.php::create()`（200） |
| `encodeURI(url)` + 正则校验 | `app/Validation/UrlValidator.php`（重新设计，见 §4） |
| `morgan` 请求日志 | `app/Support/Logger.php`（JSON 行日志，不记录请求体） |
| `express.json()` | `app/Http/Request.php::json()` |
| `dotenv` | `app/Support/Env.php` + `config/config.php` |

## 3. 前端 React → Vue 映射

| React 版 | Vue 3 版 |
| --- | --- |
| `public/index.html` + `src/index.js`（CRA 入口） | 根目录 `index.html` + `src/main.js`（Vite 入口） |
| `src/App.js`、`src/components/{Header,Search,Entity,Body,Button,Error}.js` | `src/App.vue` + `src/components/{Header,Search,Result,Button,Error}.vue`（Entity 与 Body 合并进 Result） |
| `src/store.js` + `src/reducers/{entityReducer,errorReducer}.js`（Redux Toolkit） | `src/stores/shortUrl.js`（Pinia） |
| `src/services/entity.js`（`REACT_APP_API_BASE_URL`） | 同名文件，改读 `VITE_API_BASE_URL`，并扩展管理端 API 封装 |
| `react-scripts`（webpack，dev 3000 + proxy） | Vite 6（dev 3000，`/url`、`/api` 代理到 3001） |
| （无对应物，本版新增） | `src/components/ThemeToggle.vue` 亮/暗主题切换 |
| `qrcode` / `copy-to-clipboard` / `file-saver` / `axios` | 原样保留，功能不变 |

二维码仍在浏览器端生成，服务端不参与。视觉在本版升级为设计令牌体系：
`index.css` 以 CSS 变量定义亮/暗两套调色板与玻璃拟态表面（`data-theme` 切换），
`tailwind.config.js` 将令牌映射为 Tailwind 工具类（`text-ink` / `text-accent` / `border-line` 等）；
主题经页头按钮切换、localStorage（`devr-theme`）持久化，未设置时跟随系统
`prefers-color-scheme`，`index.html` 内的首帧脚本保证深色模式无白屏闪烁。

## 4. 行为差异（相对原 Node 版，逐项声明）

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

## 5. 环境变量变更汇总

| 原版（Node + Redis） | 现状 | 说明 |
| --- | --- | --- |
| REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD / REDIS_DATABASE | （删除） | SQLite 无需这些配置 |
| REACT_APP_API_BASE_URL | VITE_API_BASE_URL | 前端 API 地址，构建时读取，留空同源 |
| （无） | APP_ENV / APP_DEBUG / APP_URL / APP_PORT | 应用基础配置 |
| （无） | DATABASE_PATH | SQLite 文件路径，默认 `backend/storage/short-url.sqlite3` |
| （无） | ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_PASSWORD_HASH / ADMIN_TOKEN_TTL_DAYS | 管理后台凭据 |
| （无） | DIST_INDEX | `/admin` 返回的 SPA 入口路径 |

`.env` 加载顺序：`backend/.env` → 项目根 `.env`（先找到的生效）；真实环境变量始终优先于 `.env`。

## 6. 删除的文件汇总

| 文件 | 原因 |
| --- | --- |
| `server.js` / `server.rest` | 已被 `backend/` 完整替代（Git 历史中可随时找回） |
| `Jenkinsfile` | 内容为错误命令（`sh 'node build'`），且未被任何流水线引用 |
| `fly.toml` / `.github/workflows/fly.yml` | fly.io 部署链路，不再使用 |
| `src/**.js`（React 组件、reducer、store、CRA 入口） | 被 Vue 3 版本替代（同名功能见 `src/**.vue` 与 `src/stores/`） |

## 7. 部署拓扑变化

```text
原版： React build ── Express(3001) ── Redis
现版： Nginx ─┬─ 静态：Vue dist/
              └─ FastCGI ── PHP-FPM ── PDO ── SQLite（单文件）
```

- Docker Compose：`web`(nginx) + `app`(php-fpm) 双容器，命名卷 `app-data` 持久化数据库；
- 单容器：nginx + php-fpm 由 supervisord 托管；
- 宝塔：源码部署见 [BAOTA_DEPLOY.md](BAOTA_DEPLOY.md)；开箱即用部署包由
  `php deploy/build-baota-package.php` 生成（标准 PHP 结构，`public/` 为 Web 运行目录）。

## 8. 回滚方案

1. **数据层**：SQLite 与 Redis 为两套独立数据，不互通。从旧版升级产生的短链只存在 SQLite 中；
   回滚到旧版前请先评估数据取舍（或先用脚本导出迁移，见 [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md) §6）。
2. **应用层回滚**：`git checkout <对应提交>` 重新部署即可；建议升级前为当前可用镜像保留 tag。
3. **管理后台回滚不可逆项**：在后台「设置」页修改过的密码（哈希存于 SQLite `settings` 表）
   回滚代码后不生效，需用环境变量凭据登录。

## 9. 迁移后验证清单

```bash
cd backend
composer install && composer test && composer analyse && composer lint
# 真机冒烟
composer serve
curl -X POST localhost:3001/url -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -I localhost:3001/<上一步返回的 code>
# 管理端冒烟
curl -s localhost:3001/api/auth/me
# => {"authenticated":false,"require_login":false}
# 浏览器访问 /admin，用默认账号登录后检查统计、设置与改密
```
