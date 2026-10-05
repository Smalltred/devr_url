# Node.js → PHP 8.2 迁移说明

本文记录 short-url 后端从 Node.js/Express 迁移到 PHP 8.2 的完整变更清单、行为差异与回滚方案。

> **历史文档说明**：本文写作时存储层为 Redis；2026-10 起存储层已从 Redis 迁移到 SQLite，
> 见 [docs/SQLITE_MIGRATION.md](SQLITE_MIGRATION.md)。同期前端已用 Vue 3 + Vite 重写（原 React 代码退役），
> 见 README。文中 Redis/React 相关描述保留作历史记录。

## 1. 迁移总览

| 原始（Node.js） | 现状（PHP 8.2） |
| --- | --- |
| `server.js` 单文件后端 | `backend/` 分层应用（Controller → Service → Repository → Redis） |
| Express + node-redis + dotenv + morgan | 纯 PHP 8.2 + phpredis，**零运行时 Composer 依赖** |
| `npm run server`（端口 3001） | `composer serve` / PHP-FPM + Nginx |
| Express 托管 `build/` 静态资源 | Nginx 托管 `build/`，其余路径转发 PHP |
| Dockerfile：node:16 单容器 | Dockerfile：多阶段（React 构建 → composer → nginx+php-fpm） |

前端 React 代码**未重写**：仅 `src/services/entity.js` 的 API 地址改为可配置
（`REACT_APP_API_BASE_URL`，留空同源），CRA 开发代理仍指向 3001。

## 2. server.js → PHP 模块映射

| server.js 中的代码 | PHP 对应 |
| --- | --- |
| `redis.createClient({...})` 连接/认证/重连 | `app/Services/RedisService.php`（pconnect 复用、异常转译 503） |
| `redisKey = {code, map}` | `config/config.php` → `redis.keys.*`（默认值不变） |
| `_alphabet` + `encode(id)` | `app/Services/ShortCodeService.php::encode()`（逐位一致） |
| `app.get('/:code')` 跳转 | `app/Controllers/UrlController.php::redirect()`（302） |
| `app.post('/url')` 创建 | `app/Controllers/UrlController.php::create()`（200） |
| `encodeURI(url)` + 正则校验 | `app/Validation/UrlValidator.php`（重新设计，见 §4） |
| `morgan` 请求日志 | `app/Support/Logger.php`（JSON 行日志，不记录请求体） |
| `express.json()` | `app/Http/Request.php::json()` |
| `dotenv` | `app/Support/Env.php` + `config/config.php` |

## 3. package.json 变更

**移除的仅服务端依赖**：`express`、`redis`、`dotenv`、`morgan`、`nodemon`（devDep）。
**保留的前端依赖**：`react`、`react-dom`、`axios`、`qrcode`、`copy-to-clipboard`、`file-saver`、
`@reduxjs/toolkit`、`react-redux`、`react-scripts`、`web-vitals`、`tailwindcss`、testing-library 系列。

**移除的脚本**：`server`、`dev`。**新增**：无（前端脚本不变）。

## 4. 行为差异（逐项声明）

| # | 差异 | 原因 | 影响 |
| --- | --- | --- | --- |
| 1 | URL 中含空白字符由"编码后放行"改为"400 拒绝" | 原行为会把脏 URL 存进 Redis（任务书 §11 要求禁止空白） | 仅影响新链接创建 |
| 2 | 已含合法 `%XX` 的 URL 不再二次编码 | 原 `encodeURI` 会把 `%` 编成 `%25`，导致存量常见带参链接跳转错误（任务书 §11"正确处理 URL 编码"） | 仅影响新链接创建，属于缺陷修复 |
| 3 | 首尾空白 trim 后存储 | 原版会把空格一并编码存入 | 仅影响新链接创建 |
| 4 | 方法不允许返回 405（原为 404） | 任务书 §16 状态码规范 | 对旧前端无影响（它只用 200/400/404/302） |
| 5 | Redis 不可用返回 503 JSON | 任务书 §16；原版进程会不断重连重试 | 对旧前端无影响 |
| 6 | 多段路径 404 响应体由 Express HTML 改为 JSON `{"error":"Not Found"}` | 状态码仍 404，语义不变 | 无 |
| 7 | 日志不再输出完整请求体（morgan `:body`） | 任务书 §12 日志安全 | 无 |
| 8 | 新增 `POST /api/url` 规范别名 | 任务书 §20 | 原 `/url` 保留，旧调用不受影响 |

除上表外，API 的请求/响应结构、状态码、短码、Redis 数据均与原版一致。

## 5. 环境变量变更

| 原版 | PHP 版 | 说明 |
| --- | --- | --- |
| REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD | 保持不变 | `.env` 内容可直接沿用 |
| （无） | APP_ENV / APP_DEBUG / APP_URL / APP_PORT / REDIS_DATABASE | 新增，均有安全默认值 |

`.env` 加载顺序：`backend/.env` → 项目根 `.env`（先找到的生效）；真实环境变量始终优先于 `.env`。

## 6. 删除的文件

| 文件 | 原因 |
| --- | --- |
| `server.js` | 已被 `backend/` 完整替代（Git 历史中可随时找回） |
| `server.rest` | 仅用于调试 Express 接口 |
| `Jenkinsfile` | 内容为错误命令（`sh 'node build'`），且未被任何流水线引用 |

移除：`fly.toml` 与 `.github/workflows/fly.yml`（原 fly.io 部署链路，不再使用 fly.io 托管）。

## 7. 部署拓扑变化

```text
原版： React build ── Express(3001) ── Redis
现版： Nginx(80) ─┬─ 静态：React build
                  └─ FastCGI ── PHP-FPM ── phpredis ── Redis
```

- Docker Compose：`web`(nginx) + `app`(php-fpm) + `redis` 三容器；
- 单容器：nginx + php-fpm 由 supervisord 托管；
- 宝塔：站点根指向 `build/`，伪静态转发见 `deploy/nginx/short-url.conf` 与 `docs/BAOTA_DEPLOY.md`。

## 8. 回滚方案

1. **数据层无需回滚**：PHP 与 Node 读写同一套 Redis key，切换期间产生的短链双向可用。
2. **应用层回滚**：`git checkout <原 master 提交>`（或使用旧 Node 镜像）重新部署即可；
   建议切换前为原 Docker 镜像保留 tag（如 `short-url:node-legacy`）。
3. **灰度共存**：可让 Nginx 把 `POST /url`、`/api/url` 转给 PHP，其余短码跳转仍走 Node，
   按路由逐步切换；两边读写的都是 `short-url:code` / `short-url:map`，不存在数据分裂。

## 9. 迁移后验证清单

```bash
cd backend
composer install && composer test && composer analyse && composer lint
# Redis 兼容闭环（真实 Redis）
RUN_REDIS_COMPAT_TESTS=1 REDIS_TEST_DATABASE=15 php vendor/bin/phpunit tests/Compat
# 真机冒烟
composer serve
curl -X POST localhost:3001/url -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -I localhost:3001/<上一步返回的 code>
```
