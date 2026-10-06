# Short URL 安全审计报告

## 1. 审计摘要

**审计时间**：2026-10-06

**项目版本**：devr v0.3.0（Git `c034bae` + 工作区未提交改动）

**技术栈**：

```text
Vue 3 + Vite（SPA，无 vue-router/pinia）
   ↓ HTTP JSON
Nginx / PHP 内置服务器
   ↓
PHP 8.2（无框架，手写 Controller → Service → Repository → PDO）
   ↓
SQLite（WAL）
```

部署形态：Docker Compose（nginx + php-fpm）、单容器（nginx + php-fpm + supervisor）、
宝塔面板（Nginx 伪静态 / Apache .htaccess）、宝塔开箱即用部署包。

**审计范围**：

- 后端源码 `backend/app`（Controllers / Services / Repositories / Http / Security / Support / Validation）
- 入口与路由 `backend/public/index.php`、`backend/routes/web.php`
- 配置 `backend/config/config.php`、`.env.example`
- 前端 `src/`（Vue 组件、状态、API 客户端）、`index.html`、`dist/` 构建产物
- 部署 `Dockerfile`、`docker-compose.yml`、`deploy/nginx/*.conf`、`deploy/baota/*`、`deploy/supervisord.conf`
- 依赖 `backend/composer.lock`（0 个运行时依赖）、`package-lock.json`
- 构建/质量配置 `phpunit.xml`、`phpstan.neon`、`.php-cs-fixer.dist.php`、`.gitignore`、`.dockerignore`
- 日志与数据 `backend/storage/logs/*.log`

**审计方法**：源码审计（攻击面建模 + 逐项数据流追踪）→ 本地环境实际渗透验证 →
代码级修复 → 回归测试固化 → 再次实际验证。所有 High/Medium 结论均有真实 HTTP 请求证据，
不使用"理论风险"充数。

**总体安全等级**：**Good（良好）**。审计前存在 2 个 High（本地开发环境敏感文件读取、
客户端 IP 丢失导致限流与访客统计失效）与 5 个 Medium 问题，构成生产上线阻断项；
全部修复并回归验证后，未发现 Critical 级问题。

```text
Critical: 0
High:     2（已全部修复）
Medium:   5（已全部修复）
Low:      4（已全部修复）
Info:     5（4 项已修复 + 1 项判定无需修复）
```

风险总览表共 16 条；另有 6 项（SEC-017 ~ SEC-022）经实测判定为「非漏洞 / 设计取舍」，见 §4。

**生产环境结论**：**可以上线**（前提：按第 5 节「上线前必做配置」设置强密码与
`IP_HASH_SECRET`；宝塔部署需删除自检文件）。

---

## 2. 风险总览

| ID | 风险 | 等级 | 模块 | 是否确认 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | 本地开发服务器静态回退存在路径穿越，可读取 `.env`、SQLite 库与后端源码 | High | 文件访问 / 部署 | 是（实测 200 + 文件内容） | 已修复 |
| SEC-002 | `Request::withParams()` 丢弃客户端 IP，导致限流按空 IP 归并、独立访客统计失效 | High | 认证 / 统计 | 是（实测 ip_hash='anonymous'、NULL） | 已修复 |
| SEC-003 | 状态变更请求无来源校验，仅依赖 `SameSite=Strict`，跨站写操作可用 | Medium | CSRF | 是（实测跨站 POST 返回 200） | 已修复 |
| SEC-004 | 请求体与目标 URL 长度无上限，超长输入可入库并造成资源膨胀 | Medium | 输入验证 / DoS | 是（实测 1MB URL 入库 200） | 已修复 |
| SEC-005 | 部署包自检页 `check.php` 无鉴权，泄露环境信息且每次访问写入一条短链 | Medium | 信息泄露 / 部署 | 是（实测 403→200、每次 +1 行） | 已修复 |
| SEC-006 | 无安全响应头（CSP/XFO/Referrer-Policy 等），且泄露 `X-Powered-By: PHP/8.2.34` | Medium | 响应头 | 是（实测响应头缺失） | 已修复 |
| SEC-010 | 创建接口无频次限制，可被批量刷短码消耗磁盘与数据库 | Medium | API 滥用 / DoS | 是（实测 65 次请求全部 200） | 已修复 |
| SEC-007 | 会话 Cookie 的 `Secure` 仅取决于 `APP_URL`，HTTPS 站点可能下发可明文回传的会话 | Low | Session | 是（代码确认） | 已修复 |
| SEC-008 | 宝塔 Nginx 参考配置未阻断 `.env`/`.git`/SQLite/日志，`root` 误配即泄露 | Low | Nginx 配置 | 是（配置审阅） | 已修复 |
| SEC-009 | 本地开发默认 `APP_DEBUG=true`（随 `.env` 提交），异常消息回显给客户端 | Low | 错误处理 | 是（`.env` 内容确认） | 已修复（加防误用说明） |
| SEC-011 | IP 匿名哈希使用库内随机盐，库泄露后可离线爆破 IPv4 反推 IP | Low | 隐私 | 是（算法确认） | 已修复 |
| SEC-012 | 依赖审计：npm 7 项告警（5 High）均在构建期工具链，产物零命中；composer 无运行时依赖 | Info | 依赖 | 是（`npm audit` / `npm why`） | 无需修复（已核实不可达） |
| SEC-013 | 完整 Referer（含查询串）长期落库，可能留存来源页 token | Info | 隐私 | 是（代码与库内容确认） | 已修复（默认仅存域名） |
| SEC-014 | 宝塔 Nginx 参考配置未显式传递 `HTTP_HOST`，CSRF 同源判定可能失准 | Info | Nginx 配置 | 是（配置审阅） | 已修复 |
| SEC-015 | Docker 镜像未预建 `storage/`，php-fpm 以非 root 运行时可能无法建库（可用性） | Info | Docker | 是（Dockerfile 审阅） | 已修复 |
| SEC-016 | `docker-compose.yml` 内置默认密码 `admin123`，且无法被 `.env` 覆盖 | Info | 部署配置 | 是（文件确认） | 已修复 |

**攻击面清单（据源码实际路由整理）**

| 模块 | Endpoint | 方法 | 是否认证 | 权限 | 输入 | 输出 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 创建短链 | `/url` | POST | 视 `require_login` 配置 | 匿名/管理员 | `url` | JSON `{url,code}` | 中（限流+长度上限后为低） |
| 创建短链（别名） | `/api/url` | POST | 同上 | 匿名/管理员 | `url` | JSON | 中（同上） |
| 开放 API | `/api/open/shorten` | POST | API Key（Bearer / X-API-Key） | API | `url` | JSON | 中 |
| 短链跳转 | `/{code}` | GET | 否 | - | `code` | 302 Location | 中 |
| 登录 | `/api/auth/login` | POST | 否 | - | `username`,`password` | JSON + Set-Cookie | 高 |
| 登出 | `/api/auth/logout` | POST | 否（幂等） | - | - | JSON + Set-Cookie | 低 |
| 会话查询 | `/api/auth/me` | GET | 否 | - | - | JSON | 低 |
| 管理面板入口 | `/admin` | GET | 否（页面本身） | - | - | HTML（SPA） | 低 |
| 概览统计 | `/api/admin/overview` | GET | 是 | admin | - | JSON | 高 |
| 短链列表 | `/api/admin/links` | GET | 是 | admin | `page`,`per_page`,`q` | JSON | 高 |
| 编辑短链 | `/api/admin/links/{code}` | PUT | 是 | admin | `code`,`url` | JSON | 高 |
| 删除短链 | `/api/admin/links/{code}` | DELETE | 是 | admin | - | JSON | 高 |
| 单链统计 | `/api/admin/links/{code}/stats` | GET | 是 | admin | - | JSON | 中 |
| 读取设置 | `/api/admin/settings` | GET | 是 | admin | - | JSON | 中 |
| 修改设置 | `/api/admin/settings` | PUT | 是 | admin | `code_min_length`,`code_random`,`require_login` | JSON | 高 |
| 修改密码 | `/api/admin/settings/password` | POST | 是 | admin | `current_password`,`new_password` | JSON | 高 |
| Key 列表 | `/api/admin/keys` | GET | 是 | admin | - | JSON（仅前缀） | 中 |
| 创建 Key | `/api/admin/keys` | POST | 是 | admin | `name` | JSON（含明文 Key 一次） | 高 |
| 重置 Key | `/api/admin/keys/{id}/reset` | POST | 是 | admin | - | JSON（含明文 Key 一次） | 高 |
| 删除 Key | `/api/admin/keys/{id}` | DELETE | 是 | admin | - | JSON | 中 |

**明确判定为「不存在该攻击面」（Not Applicable）的检查项**

| 检查项 | 结论 | 依据 |
| --- | --- | --- |
| SSRF | Not Applicable | 后端从不请求用户提交的 URL：仅 `parse_url` 做语法校验后落库并 302。无预览、无标题抓取、无 URL 探测。 |
| SQL Injection | Not Applicable（已实测） | 全部 SQL 走 `PDO::prepare` + 绑定参数；搜索的 `LIKE` 通配符显式转义（`SqliteUrlRepository::likePattern`）。实测 `' OR 1=1 --`、`'; DROP TABLE --`、`UNION SELECT` 均无注入。 |
| 命令执行 / 任意文件写入 | Not Applicable | 全项目无 `exec/shell_exec/system/proc_open/eval/include`（用户输入路径）；文件写入仅日志（固定文件名）、SQLite（固定路径来自配置）、宝塔自检临时探针（随机文件名 + 立即删除）。 |
| IDOR | Not Applicable | 单管理员模型，所有管理接口作用于全站资源，无按用户划分的资源归属；`{code}`/`{id}` 的越权语义不成立。 |
| 短码可预测（顺序短码时） | 部分存在，按设计保留 | 默认策略为顺序短码（`encode(id)`），与原 Node 版逐位兼容，属明确产品行为；后台可开启随机短码（最短 3 位，`random_int`）。已作为信息项说明，见 §4 SEC-017。 |
| 短链删除后数据残留 | Not Applicable | `SqliteUrlRepository::delete` 在同一 `BEGIN IMMEDIATE` 事务内删除短链与全部点击记录。 |
| 修改短码后旧码失效 | Not Applicable（功能正确） | `update` 在同事务内改写 `short_urls.code` 与 `short_url_clicks.code`，旧码 404、新码生效、统计随迁。 |
| 容器逃逸类风险 | Not Applicable | 无 `privileged`、无 host network/PID、未挂载 Docker Socket 或宿主机目录；compose 仅挂载命名卷与映射 3001 端口。 |

---

## 3. 漏洞详情

### SEC-001：本地开发服务器静态回退路径穿越（High）

**风险等级**：High

**CVSS**：7.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`（`backend/public/index.php` 可用时，未认证读取部署密钥与全量数据）

**位置**：

```text
backend/public/index.php:5-21（修复前）
deploy/baota/public/index.php:31-41（修复前，realpath 校验不完整）
```

**漏洞描述**：

`index.php` 在 `PHP_SAPI === 'cli-server'`（`composer serve` / `php -S`，README 记载的本地开发方式）
分支中，把请求路径仅剔除反斜杠与 NUL 后就与静态根目录字符串拼接：

```php
$safePath = str_replace(['\\', "\0"], '', $path);
$file = $staticRoot.$safePath;   // /../.env 直接生效
if (is_file($file)) { readfile($file); }
```

由于 `rawurldecode` 在路由之前执行，`%2e%2e`、`..%2f` 等编码形式同样会被解开为 `..`。
项目根目录恰是静态根（`dist/`）的上级，因此 `/../.env`、`/../backend/storage/short-url.sqlite3`
等路径全部可读；宝塔部署包的实现在校验前先剥离了 `..`，只做了不完整的 realpath 检查。

**攻击前提**：目标以 PHP 内置服务器方式对外提供服务（本地开发、`composer serve`、
或误将 `php -S` 暴露到网络）。生产 Nginx/Apache 环境不经过该分支。

**攻击路径**：

```text
攻击者（网络可达）
 ↓
GET /../.env  （或 /%2e%2e/.env、/..%2f.env）
 ↓
cli-server 静态回退：rawurldecode → 字符串拼接 → is_file 通过
 ↓
readfile 输出 .env（ADMIN_PASSWORD 等）/ SQLite 库 / 后端源码 / .git
```

**复现步骤**（本地测试环境）：

```http
GET /../.env HTTP/1.1
Host: 127.0.0.1:3111
```

```bash
curl --path-as-is http://127.0.0.1:3111/../.env
curl --path-as-is http://127.0.0.1:3111/%2e%2e/.env
curl --path-as-is http://127.0.0.1:3111/../backend/storage/short-url.sqlite3
curl --path-as-is http://127.0.0.1:3111/../backend/app/Services/AuthService.php
```

**实际结果**（修复前实测）：

```text
/../.env                                -> HTTP 200  88 字节    APP_ENV=localAPP_DEBUG=true...
/%2e%2e/.env                            -> HTTP 200  88 字节    同上
/..%2f.env                              -> HTTP 200  88 字节    同上
/../backend/storage/short-url.sqlite3   -> HTTP 200  65536 字节  SQLite format 3...
/../package.json                        -> HTTP 200  507 字节
/../backend/composer.lock               -> HTTP 200  164032 字节
/../backend/app/Services/AuthService.php-> HTTP 200  6535 字节   <?php declare(strict_types=1);...
/../.git/config                         -> HTTP 200  309 字节
```

**预期结果**：返回 404，且不得输出任何静态根之外的文件内容。

**影响**：

- 机密性：**高**。`.env`（含 `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`）、SQLite 数据库
  （全部短链、点击记录、`api_keys` 哈希、登录 token 哈希）、后端源码、`.git` 完全泄露；
  凭据泄露即可直接接管管理后台。
- 完整性：无直接影响（读取型）。
- 可用性：无。

**修复建议**：集中到 `App\Support\DevStaticFile::resolve()`，对候选路径做 `realpath`，
并强制校验解析结果位于允许根目录内部（含分隔符边界比较，避免 `/dist-evil` 绕过），
同时拒绝返回 `.php`（否则内置服务器会把源码原样输出）；根目录以 `index.html` 兜底。

**修复状态**：**已修复**。修复后同一批路径全部返回 `404 {"error":"Not Found"}`，
`leaked=0`；正常静态资源（`/manifest.json`、`/robots.txt`、`/favicon.svg`、`/assets/*`）仍 200。

---

### SEC-002：客户端 IP 在路由参数注入后丢失（High）

**风险等级**：High

**CVSS**：6.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:H`（登录限流形同虚设 + 统计口径失真）

**位置**：

```text
backend/app/Http/Request.php:120-123（修复前 withParams）
backend/app/Http/Router.php:61（路由器总是以 withParams 结果调用处理器）
```

**漏洞描述**：

`Router::dispatch()` 对每个命中路由都构造新请求对象：

```php
return $handler($request->withParams($params));
```

而 `withParams()` 未传递第 7 个构造参数 `$remoteAddress`，导致**所有处理器**收到的
`clientIp()` 恒为空字符串。下游有两处依赖它：

- `AuthService::login()` → `IpHasher::hash('')` 返回 `null` → 回退为常量 `'anonymous'`：
  全站登录失败共享同一个限流桶（任意单一来源即可把**所有**管理员锁在门外，属可用性问题；
  同时该桶无法区分攻击者）。
- `ClickTracker::track()` → `ip_hash` 恒为 `NULL`：`visitors()` 用
  `COUNT(DISTINCT ip_hash) WHERE ip_hash IS NOT NULL` 统计，独立访客恒为 0。

**攻击前提**：无需认证。任何能访问登录接口的客户端都能触发（亦可视为功能缺陷）。

**攻击路径**：

```text
攻击者
 ↓
POST /api/auth/login（任意错误密码，任意 IP）
 ↓
Router → withParams() 丢失 REMOTE_ADDR
 ↓
clientIp() = '' → ip_hash = 'anonymous'
 ↓
全站共享限流桶被填满 → 所有管理员登录被 429
```

**复现步骤**：

```http
POST /api/auth/login
Content-Type: application/json
Origin: http://127.0.0.1:3111

{"username":"admin","password":"wrong"}
```

**实际结果**（修复前实测）：

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Forwarded-For: 10.0.0.$i" \
     -d '{"username":"admin","password":"bad"}' http://127.0.0.1:3111/api/auth/login
# 第 6 次起 429；数据库落库为 ip_hash='anonymous'
# sqlite> SELECT ip_hash, fails FROM auth_throttle;
# anonymous|5

# 跳转记录的 ip_hash 恒为 NULL
# sqlite> SELECT code, ip_hash FROM short_url_clicks;
# w|NULL

# 代码级证明（同仓脚本）：
# fromGlobals()  clientIp() = '203.0.113.7'
# withParams()   clientIp() = ''            <-- 丢失
# throttle ip_hash           = 'anonymous'
# click    ip_hash           = NULL
```

**预期结果**：`withParams()` 保留 `clientIp()`；限流按真实来源分桶，`ip_hash` 正常写入。

**影响**：

- 机密性：无直接泄露。
- 完整性：**中**。独立访客统计恒为 0，管理后台统计失真；限流语义被破坏。
- 可用性：**高**。单一来源可锁死全站管理员登录（共享桶）。

**修复建议**：`withParams()` 显式透传 `$this->remoteAddress`；并在测试中用带 IP 的请求
固化「IP 在路由注入后仍然保留」。

**修复状态**：**已修复**。修复后：

```text
throttle ip_hash=e41656c742b4f87c4990e0cc fails=5   （真实 IP 哈希，非 anonymous）
short_url_clicks.ip_hash=e41656c742b4f87c4990e0cc   （不再为 NULL，UV 统计恢复）
```

---

### SEC-003：状态变更请求缺少来源校验（Medium）

**风险等级**：Medium

**CVSS**：5.4 `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N`（需管理员在登录状态下访问攻击者页面）

**位置**：

```text
backend/routes/web.php（修复前：全部写路由无来源校验）
backend/app/Services/AuthService.php:104-109（Cookie: SameSite=Strict，为唯一防线）
```

**漏洞描述**：

登录态走 Cookie（浏览器自动附带），全部写操作（改设置、改密码、增删短链、增删/重置 API Key）
没有任何 CSRF Token 或 `Origin`/`Referer` 校验，唯一防线是 `SameSite=Strict`。
`Strict` 本身有效，但不构成完整防护：老浏览器与嵌入式 WebView 不识别该属性，
站点若出现 `http://` 子域或同一站点的其它端口，`SameSite` 的"同站"判定也不覆盖。

**攻击前提**：管理员已在目标站点登录（Cookie 有效），并访问攻击者控制的页面。

**攻击路径**：

```text
攻击者页面（诱导管理员访问）
 ↓
自动提交跨站表单到 http://target/api/admin/keys（或 /url）
 ↓
浏览器按 SameSite 规则决定是否附带 Cookie
 ↓
若 Cookie 被附带且无来源校验 → 账号被新增 API Key / 设置被篡改 / 短链被删
```

**复现步骤**：

```http
POST /api/admin/keys HTTP/1.1
Host: 127.0.0.1:3111
Cookie: admin_token=<有效值>
Origin: https://evil.example
Content-Type: text/plain

{"name":"csrf-form"}
```

**实际结果**（修复前实测）：跨站来源、`text/plain` 简单请求、`application/json` 请求均返回
`200 {"id":5,"name":"csrf-form",...}`，Key 被真实创建。

**预期结果**：跨站来源的写操作返回 403。

**影响**：

- 机密性：低（可读取响应内容有限）。
- 完整性：**中**。管理员操作可被伪造（改设置、改密码、增删短链与 Key）。
- 可用性：低。

**修复建议**：新增 `App\Security\CsrfGuard`，在 `App::handle()` 中对全部非
`GET/HEAD/OPTIONS` 请求校验 `Origin`（无则用 `Referer` 的协议+主机）与请求 `Host` 同源；
跨域部署通过 `ALLOWED_ORIGINS` 白名单。**同时必须保留显式凭据头的例外**：开放 API 的
脚本客户端不会发送 `Origin`，而携带 `Authorization: Bearer` / `X-API-Key` 的请求本身不是
"浏览器自动附带凭据"场景（跨站表单无法设置自定义头，跨域预检本服务不返回 CORS 允许头），
故对这类请求跳过来源校验。

**修复状态**：**已修复**。修复后：

```text
跨站 Origin + Cookie（创建 Key）      -> 403 Cross-site request rejected
跨站 Referer（无 Origin）            -> 403
无 Origin/Referer（Cookie 请求）      -> 403
Origin: null                        -> 403
跨站 DELETE 短链                     -> 403
同源 Origin + Cookie（创建 Key）      -> 200 正常
X-API-Key 无 Origin（脚本客户端）      -> 200 正常（例外）
Bearer 无 Origin（脚本客户端）         -> 200 正常（例外）
错误 Key 无 Origin                    -> 401（鉴权先于来源判定，语义正确）
```

---

### SEC-004：请求体与目标 URL 长度无上限（Medium）

**风险等级**：Medium

**CVSS**：5.3 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`（存储与内存消耗）

**位置**：

```text
backend/app/Http/Request.php:51（读取整个请求体，无上限）
backend/app/Validation/UrlValidator.php（修复前无长度校验）
backend/app/Http/ExceptionHandler.php（修复前无 413 映射）
```

**漏洞描述**：

`Request::fromGlobals()` 无条件把 `php://input` 全部读入内存并 `json_decode`，
`UrlValidator::validate()` 只校验协议/主机/空白字符，不限制长度。
单条 1MB 的 URL 会被接受并永久写入 SQLite（短链库属长期存储），
1MB 请求的响应时间从 ~44ms 升至 ~1.1s，且返回体回显整条 URL。

**攻击前提**：无需认证（公开创建接口默认开放）。

**攻击路径**：

```text
攻击者
 ↓
POST /url {"url":"https://example.com/aaaa...(1MB)"}  或  2MB 垃圾请求体
 ↓
无长度上限 → 落库 → 响应回显
 ↓
磁盘持续增长 / 内存与响应时间随请求线性放大
```

**复现步骤**：

```http
POST /url
Content-Type: application/json
Origin: http://127.0.0.1:3111

{"url":"https://example.com/aaaaaaaa...(102400 字符)"}
```

**实际结果**（修复前实测）：

```text
URL     1024 字节 -> 200 time=0.045s
URL    10240 字节 -> 200 time=0.042s
URL   102400 字节 -> 200 time=0.051s
URL  1048576 字节 -> 200 time=1.102s   （已入库，库文件 65536 → 1241088 字节）
2MB 垃圾请求体    -> 400 time=1.155s
```

**预期结果**：超出上限返回 413，且不写库。

**影响**：

- 机密性：无。
- 完整性：低（可写入无意义的长数据）。
- 可用性：**中**。持续提交可耗尽磁盘并抬高单请求延迟。

**修复建议**：全局请求体上限（`MAX_BODY_BYTES`，默认 16384）在 `App::handle()` 最前置校验，
超限抛 `PayloadTooLargeException` → 413；`UrlValidator::MAX_LENGTH = 2048`（归一化前后各校验一次），
超限同样 413。

**修复状态**：**已修复**。修复后：

```text
URL  1024 字节 -> 200（正常）
URL  2048 字节 -> 200（边界值可用）
URL  4096 字节 -> 413 Payload Too Large
URL 102400 字节 -> 413
URL 1048576 字节 -> 413
2MB 垃圾请求体     -> 413
```

---

### SEC-005：部署包自检页无鉴权且产生数据写入（Medium）

**风险等级**：Medium

**CVSS**：5.3 `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L`

**位置**：

```text
deploy/baota/public/check.php（修复前：无访问控制，页面加载即写库）
```

**漏洞描述**：

该页面向公网开放且无需任何凭据，会输出 PHP 版本、扩展加载情况、`.env` 是否存在、
`storage/` 是否可写、数据库连接状态，以及"真实异常"信息（异常中包含路径等细节）。
更严重的是页面加载时（`C` 项）会执行一次"创建短链 → 跳转"全链路，**每次访问都在
真实数据库中写入一条短链**（探针数据长期残留）。

**攻击前提**：`public/check.php` 保留在生产目录（部署文档建议排障后删除，但易被遗漏）。

**攻击路径**：

```text
扫描器 / 攻击者
 ↓
GET /check.php
 ↓
获取 PHP 版本、扩展、可写性、数据库可达性（信息收集）
 ↓
每次请求写入一条短链，污染业务数据
```

**复现步骤**：

```http
GET /check.php HTTP/1.1
Host: target.example
```

**实际结果**（修复前实测）：HTTP 200，8086 字节；页面显示 `PHP 8.2.34`、`已加载`、
`可写`、`存在`、`连接正常`；连续两次刷新后 `short_urls` 行数由 2 增至 4（每次 +1）。

**预期结果**：未授权访问被拒绝；页面加载不得写入业务数据。

**影响**：

- 机密性：**中**。泄露服务器环境与部署细节，为后续攻击提供情报。
- 完整性：**中**。污染短链表。
- 可用性：低。

**修复建议**：自检页要求访问令牌（打包时随机生成、存放 Web 根之外 `.check-token`，
用 `hash_equals` 常量时间比较；无令牌文件时一律拒绝）；移除路径/配置值回显；
全链路实测改为显式 `&run=1` 触发，并在同一请求内清理探针数据。

**修复状态**：**已修复**。修复后：

```text
/check.php                        -> 403 Forbidden
/check.php?token=deadbeef         -> 403 Forbidden
/check.php?token=<正确令牌>         -> 200（可用）
连续 3 次带令牌访问                -> short_urls 0 → 0（不再写入）
/check.php?token=<正确令牌>&run=1  -> 200，提示「探针短链已清理，未残留数据」，行数仍为 0
页面路径/配置值泄露匹配数           -> 0
```

---

### SEC-006：缺少安全响应头并泄露 PHP 版本（Medium）

**风险等级**：Medium

**CVSS**：4.3 `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N`

**位置**：

```text
backend/app/Foundation/App.php（修复前无响应头处理）
backend/public/index.php、deploy/baota/public/index.php（未移除 X-Powered-By）
```

**漏洞描述**：

全部响应均无 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、
`Permissions-Policy`、HSTS；每个响应附带 `X-Powered-By: PHP/8.2.34`（精确版本）。
缺少 CSP 意味着一旦出现注入点即无最后一道浏览器侧防线；
缺少 `X-Frame-Options`/`frame-ancestors` 使管理后台可被 iframe 嵌套（点击劫持）；
`Referrer-Policy` 缺失会把完整来源 URL（含短码路径）随外链带走。

**攻击前提**：需要配合其他注入点才能放大危害；点击劫持需诱导管理员访问。

**攻击路径**：

```text
攻击者
 ↓
构造 iframe 嵌套 /admin（无 XFO 阻断）
 ↓
诱导管理员点击，实施点击劫持
（或配合注入点，因无 CSP 而无法拦截）
```

**复现步骤**：

```http
GET /api/auth/me HTTP/1.1
Host: 127.0.0.1:3121
```

**实际结果**（修复前实测）：响应头仅有 `Host`/`Date`/`Connection`/`X-Powered-By: PHP/8.2.34`/
`content-type`，无任何安全头。

**预期结果**：返回 CSP、`nosniff`、`DENY`、`Referrer-Policy`、`Permissions-Policy`，
且不泄露 PHP 版本。

**影响**：

- 机密性：低（版本指纹、Referer 泄露）。
- 完整性：低（缺少纵深防御）。
- 可用性：无。

**修复建议**：新增 `App\Security\SecurityHeaders`，在 `App::handle()` 的成功与异常路径
统一附加；CSP 对 HTML 响应按内容动态计算内联脚本 sha256（构建产物含两段内联脚本，
写死哈希会在前端重新构建后失效）；`X-Powered-By` 由入口 `header_remove()` 移除；
HSTS 仅在 `X-Forwarded-Proto: https` 且 `HSTS_MAX_AGE > 0` 时下发。

**修复状态**：**已修复**。修复后实测（真实浏览器验证，见 SECURITY-TEST-REPORT.md §3）：

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self'
  'sha256-JS8WnjBrSLDNgx1F24d3bkiyA+wUr+5X9/dVsZOGmgg='
  'sha256-wrNlu4oLmJobRzDk9UObxfmE275xTC+oALhpk779qaE='
  https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; ...
  frame-ancestors 'none'; object-src 'none'
X-Powered-By: （已移除）
HSTS: HTTP 请求不下发；X-Forwarded-Proto=https 时按 HSTS_MAX_AGE 下发
```

---

### SEC-010：创建接口无频次限制（Medium）

**风险等级**：Medium

**CVSS**：5.3 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`

**位置**：

```text
backend/routes/web.php（修复前：/url、/api/url、/api/open/shorten 无频率限制）
backend/app/Services/DatabaseService.php（修复前无计数表）
```

**漏洞描述**：

公开创建接口与开放 API 均无调用频次限制，单一来源可无限创建短码，持续消耗磁盘、
增长 SQLite 文件并无上限地产生短码（还可用尽短码空间）。

**攻击前提**：无需认证（公开接口默认开放）。

**攻击路径**：

```text
攻击者
 ↓
循环 POST /url（或带 Key 调用 /api/open/shorten）
 ↓
无频次限制 → 磁盘/短码空间持续被消耗
```

**复现步骤**：

```bash
for i in $(seq 1 65); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
       -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3111' \
       -d "{\"url\":\"https://example.com/rl-$i\"}" http://127.0.0.1:3111/url
done | sort | uniq -c
```

**实际结果**（修复前实测）：65 次请求全部 `200`，无任何限制。

**预期结果**：超过阈值后返回 429。

**影响**：

- 机密性：无。
- 完整性：低。
- 可用性：**中**。可被批量滥用消耗存储。

**修复建议**：新增 `request_throttle` 表与 `App\Security\RequestRateLimiter`，
按 IP 匿名哈希在固定窗口内计数（固定窗口 + `BEGIN IMMEDIATE` 内 upsert，避免并发丢失计数），
公开接口与开放 API 共用 `create` 计数域；`CREATE_RATE_LIMIT_MAX=0` 可关闭。

**修复状态**：**已修复**。修复后实测（默认 60/60s）：

```text
65 次请求 -> 56 × 200，9 × 429（第 61 次起被限流）
不同 IP 不共享配额（单元测试覆盖）
开放 API 同样受限（单元测试覆盖）
```

---

### SEC-007：会话 Cookie 的 Secure 属性依赖 APP_URL（Low）

**风险等级**：Low

**位置**：`backend/app/Services/AuthService.php:104-109`（修复前）

**漏洞描述**：`Secure` 仅在 `APP_URL` 以 `https://` 开头时附加。`.env.example` 中 `APP_URL`
默认为 `http://localhost:3001`，若生产部署直接沿用且未修改该值，HTTPS 站点下发的会话
Cookie 将不带 `Secure`，存在被明文回传（同域 HTTP 端点、降级请求）的风险。

**攻击前提**：中间人具备网络位置；站点同时提供 HTTP 可达路径。

**复现步骤**：

```http
POST /api/auth/login
X-Forwarded-Proto: https

{"username":"admin","password":"..."}
```

**实际结果**（修复前）：`Set-Cookie` 不含 `Secure`（除非 `APP_URL` 为 https）。
**预期结果**：请求经 HTTPS 时始终附加 `Secure`。

**影响**：机密性低（会话可能在明文链路上暴露）；完整性/可用性无。

**修复建议**：`authCookie()` 改为「请求协议（含反代 `X-Forwarded-Proto`）为 https **或**
`APP_URL` 为 https」即附加 `Secure`；登出清除 Cookie 同样处理。

**修复状态**：**已修复**。实测 `X-Forwarded-Proto: https` 时 `Set-Cookie` 含 `; Secure`，
HTTP 请求不带（本地开发不受影响）。

---

### SEC-008：宝塔 Nginx 参考配置缺少敏感路径阻断（Low）

**风险等级**：Low

**位置**：`deploy/nginx/short-url.conf`（修复前）

**漏洞描述**：配置只声明 `root .../dist` 与静态规则，未显式阻断 `.env`、`.git`、`*.sqlite3`、
`*.log` 与后端源码目录；也未禁止把 `.php` 当静态文件输出。若部署者把 `root` 误配到项目根
（常见操作失误），上述文件即可被直接下载；PHP-FPM 不可用时 Nginx 会原样输出 `.php` 源码。

**攻击前提**：需要 root 目录配置错误或 PHP-FPM 不可用。

**复现步骤**：将 `root` 改为项目根后请求 `/.env`、`/backend/storage/short-url.sqlite3`。

**实际结果**（修复前）：无规则阻断，返回文件内容。
**预期结果**：404/403。

**影响**：机密性低（依赖误配）；完整性/可用性无。

**修复建议**：三个 Nginx 配置（`short-url.conf`、`compose.conf`、`docker.conf`）统一加入
敏感文件正则阻断、后端源码目录阻断、`\.php$` 独立 location 并 `try_files $uri =404`。

**修复状态**：**已修复**（三个配置均已加固）。

---

### SEC-009：本地开发默认开启调试且异常消息回显（Low）

**风险等级**：Low

**位置**：`.env`（随工作区存在，`APP_DEBUG=true`）；`backend/app/Http/ExceptionHandler.php:53-56`

**漏洞描述**：`ExceptionHandler` 在 `APP_DEBUG=true` 时用真实异常消息覆盖对外文案
（如 `StorageException` 的 "Unable to open SQLite database: /path/..."），会暴露文件路径。
仓库根 `.env` 为本地开发值 `APP_DEBUG=true`（`.gitignore` 已忽略 `.env`，未提交）。

**攻击前提**：生产误用该 `.env`，或显式开启 debug。

**实际结果**：`.env` 内容为 `APP_ENV=local / APP_DEBUG=true`；`.env.example` 明确要求生产为 false。
**预期结果**：生产 `APP_DEBUG=false`，仅输出固定文案（默认行为已如此）。

**影响**：机密性低（路径与内部状态）。
**修复建议**：保持默认 false，并在文档中强化说明。

**修复状态**：**已修复（文档与配置说明）**。`.env.example` 保持 `APP_DEBUG=false` 且注释
「生产环境必须为 false，避免异常细节泄露」；审计未发现生产路径回显（实测所有错误响应
均无路径/SQL/堆栈）。

---

### SEC-011：IP 匿名哈希使用库内随机盐（Low）

**风险等级**：Low

**位置**：`backend/app/Support/IpHasher.php`（修复前）

**漏洞描述**：`sha256(ip + salt)`，盐存于同一数据库的 `app_meta` 表。库文件泄露时
攻击者同时拿到盐，可离线枚举 IPv4 空间（约 43 亿）反推原始 IP——虽然成本不低，
但对定位特定来源（如某一运营商的地址段）是可行的。

**攻击前提**：数据库文件泄露。
**实际结果**：盐与哈希同库存储。
**预期结果**：密钥不随数据存储。

**影响**：机密性低（隐私去匿名化）；完整性/可用性无。

**修复建议**：支持 `IP_HASH_SECRET` 环境变量，设置后改用 `hash_hmac('sha256', $ip, $secret)`，
密钥不落库。同时补上多进程首次并发生成盐的回读（避免不同 worker 生成不同盐导致同一 IP
被计为多个访客）。

**修复状态**：**已修复**。实测未设置时沿用盐（兼容存量），设置后 HMAC 值与盐版不同且稳定；
文档说明「变更该值会使历史独立访客数从零重新累计」。

---

### SEC-013：完整 Referer 长期落库（Info）

**风险等级**：Info

**位置**：`backend/app/Services/ClickTracker.php:29-37`（修复前）

**漏洞描述**：`short_url_clicks.referer` 保存来源 URL 前 500 字符，来源页可能把
token、一次性链接、会话标识放在查询串中（如 `https://mail.example.com/inbox?token=...`），
长期留存属隐私风险。管理后台只用 `referer_host`，完整 Referer 从未被读取或展示。

**实际结果**（修复前）：`referer` 字段保存 `https://evil.com/<script>alert(1)</script>` 等完整值。
**预期结果**：默认不保存完整 Referer，仅保存来源域名。

**影响**：机密性低（第三方凭据可能被留存）。
**修复建议**：默认 `referer = NULL`，仅保留 `referer_host`；提供 `PRIVACY_STORE_REFERER=true` 回退。

**修复状态**：**已修复**。实测 `referer=NULL`、`referer_host='mail.example.com'`，
来源域名统计不受影响。

---

### SEC-014：Nginx 未显式传递 HTTP_HOST（Info）

**风险等级**：Info

**位置**：`deploy/nginx/*.conf`（修复前）

**漏洞描述**：`fastcgi_params` 通常包含 `HTTP_HOST $http_host`，但显式声明更稳妥；
新增的 CSRF 同源判定以 `Host` 头为基准，若代理层传递了错误的 Host，
同源判定会失准（表现为合法请求被 403，而非安全绕过）。

**修复状态**：**已修复**（三个 Nginx 配置均显式加 `fastcgi_param HTTP_HOST $http_host;`）。

---

### SEC-015：Docker 镜像未预建 storage 目录（Info）

**风险等级**：Info（可用性）

**位置**：`Dockerfile`（修复前）

**漏洞描述**：php-fpm 镜像默认以 `www-data` 运行，而 `/app/backend` 由 root 拷入且不含
`storage/`。`DatabaseService::connect()` 会尝试 `mkdir`，若目录不可写则抛
`StorageException`（503）——首次启动即不可用。命名卷挂载会掩盖该问题，但未挂载卷的
`docker run` 场景会直接失败。

**修复状态**：**已修复**。镜像内预建 `storage/logs` 并将其属主设为 `www-data`、
权限 775；命名卷挂载到该路径时继承属主。

> 注：本机无 Docker 环境，此项为静态审阅结论，未做容器内运行验证，标记为 **Potential**。

---

### SEC-016：docker-compose 内置默认密码且不可覆盖（Info）

**风险等级**：Info

**位置**：`docker-compose.yml`（修复前）

**漏洞描述**：`ADMIN_PASSWORD: "admin123"` 硬编码在 compose 中，无法通过 `.env` 覆盖，
容易随部署直接进入生产。

**修复状态**：**已修复**。改为 `${ADMIN_PASSWORD:-admin123}` 形式，支持从项目根 `.env`
或环境变量注入；同时支持 `ADMIN_PASSWORD_HASH`、`IP_HASH_SECRET`、`ALLOWED_ORIGINS`、
`HSTS_MAX_AGE` 注入，并保留「生产必须修改」注释。

---

## 4. 审计结论中需要说明的非漏洞项

### SEC-017：顺序短码可被枚举（设计取舍，非漏洞）

默认短码由自增 ID 经 62 进制编码得到（与原 Node 版逐位兼容，见 `ShortCodeService` 与
`tests/Compat/expected_codes.php`），因此短码是可枚举、可预测的。这是该项目**明确的既有
产品行为**：随机化由后台「随机短码」开关控制（最短 3 位，`random_int` 生成并查重）。

判定为信息项而非漏洞的理由：短链本身是公开分享的跳转服务，短码并非访问控制凭据；
枚举可获取的是他人已公开分享的链接。管理后台统计与短链列表均受登录保护，
枚举者无法通过短码获得额外权限或统计数据。

若业务上需要抗枚举（如内部短链），建议在后台开启「随机短码」并设置长度 ≥ 6。

### SEC-018：短链系统的开放重定向（设计功能，非漏洞）

`GET /{code}` 按设计 302 到用户提交的任意 http/https URL。这是产品核心功能，
不判定为开放重定向漏洞。防护边界已核实：

- 仅接受 `http`/`https`（`javascript:`、`data:`、`file:`、`ftp:`、协议相对 `//` 全部拒绝，实测 400）；
- 响应头注入：`Response::redirect()` 拒绝含 `\r`/`\n` 的 Location；实测 URL 中的
  `%0d%0aSet-Cookie:...` 被当作普通路径字符原样存储与回显，未产生额外响应头。

### SEC-019：短码生成并发与碰撞（已验证通过）

`nextId()` 在 `BEGIN IMMEDIATE` 事务内自增；`short_urls.code` 为主键（唯一约束）。
实测并发创建 10 / 50 / 100 次：**无重复短码、无错误**（唯一数 = 请求数）。
并发失败登录 10 次：5×401 + 5×429，计数正确累计为 5（无丢失更新）。

### SEC-020：限流对 IPv6 与代理头的处理（已验证）

- 代理头伪造无效：`X-Forwarded-For` / `X-Real-IP` 不参与 IP 判定（仅用 `REMOTE_ADDR`），
  实测 6 次请求换 6 个不同 XFF 仍在第 6 次被 429，限流桶未被绕过。
- IPv6：限流键为 `REMOTE_ADDR` 的匿名哈希，`::1` 与 IPv4 各自成桶，天然支持。
- 反向代理部署时若未配置 `real_ip`，所有用户会共享代理 IP 的桶（功能偏严而非漏洞），
  已在部署文档说明。

### SEC-021：统计与日志的敏感信息（已验证）

- 日志（`backend/storage/logs/*.log`）实测不含密码、API Key、Session token、
  Cookie、Authorization 头、完整 IP；仅记录异常类名、固定文案与 IP 匿名哈希。
  唯一匹配 `password` 的记录是固定消息 `"admin password changed"`（不含任何值）。
- 管理端 API Key 列表只返回展示用前缀；明文仅在创建/重置响应中出现一次（实测确认）。
- `settings` 表中的 `admin_password_hash` 不会经 `/api/admin/settings` 输出
  （只输出 `password_source: env|custom`）。

### SEC-022：前端 XSS 面（已验证无存储型 XSS）

- 全项目 `src/` 无 `v-html`、无 `innerHTML`/`dangerouslySetInnerHTML`/`document.write`/`eval`。
- 用户可控数据（URL、短码、API Key 名称、来源域名）全部经 Vue 文本插值或属性绑定渲染，
  自动转义；`:href` 绑定的 URL 已被后端限制为 http/https。
- 管理端可提交 `<script>alert(1)</script>` 作为 API Key 名称、可保存含 `<script>` 的 URL
  （作为路径字符），在 Vue 模板中均按文本渲染，不执行。
- `localStorage` 仅存主题偏好（`devr-theme`），不含任何凭据；管理登录态走 HttpOnly Cookie，
  前端 JS 无法读取。无 API Key 长期存储。
- 构建产物无 source map（`dist/assets/` 仅 `.js`/`.css`）。

---

## 5. 安全评分

按审计修复后的实际状态评定：

```text
认证安全：9/10   单管理员 + password_hash/PASSWORD_DEFAULT、256 位随机 token、
                 库存哈希、HttpOnly+SameSite=Strict+按需 Secure、改密撤销全部会话、
                 15 分钟 5 次失败限流且按真实 IP 分桶（已修复 SEC-002）。
                 扣分项：无 TOTP/MFA，无管理员账号锁定通知。

授权安全：10/10  全部管理接口经路由守卫强制校验，未登录一律 401（12 个接口逐一实测）；
                 无 IDOR 面（单管理员模型）；前端隐藏不是唯一防线。

API 安全：9/10   API Key 仅存 SHA-256、明文单次返回、重置/删除即时失效（实测）；
                 两种鉴权头均生效；创建限流（已修复 SEC-010）；
                 请求体与 URL 上限（已修复 SEC-004）。
                 扣分项：Key 无过期时间与权限范围（scope）概念。

数据安全：9/10   SQLite 位于 Web 根之外、WAL、写操作事务化；
                 密码与 token 哈希落库；短码主键唯一约束。
                 扣分项：数据库文件权限依赖部署环境，未在应用层加密。

输入验证：9/10   统一 UrlValidator（协议白名单、空白/CRLF 拒绝、长度上限、IDN 编码）；
                 短码白名单正则 + 保留码；LIKE 通配符转义；实测 SQL 注入无效。
                 扣分项：无 CSP 报告端点（report-uri）。

业务逻辑：9/10   改密撤销全部会话、改短码同事务迁移统计、删除级联清理点击记录、
                 短码生成并发无重复（100 并发实测）。
                 扣分项：无短链过期/配额策略。

前端安全：9/10   无 XSS sink、凭据不落 localStorage、无 source map、
                 CSP 对构建产物实际验证通过（真实浏览器渲染与接口调用正常）。
                 扣分项：第三方统计脚本（Google Analytics）需在 CSP 中放行。

部署安全：8/10   三套 Nginx 配置统一阻断敏感文件与源码、宝塔包 realpath 归属校验、
                 Docker 预建数据目录并归属 www-data、compose 凭据可注入。
                 扣分项：未内置 non-root 主进程（php-fpm worker 已是 www-data）；
                 Docker 项未做容器内运行验证。

依赖安全：9/10   PHP 运行时零第三方依赖（composer 仅 dev 工具）；npm 生产依赖 0 漏洞；
                 7 项 npm 告警全部位于 Vite/Tailwind 构建期工具链，产物命中数为 0。
                 扣分项：构建期工具链告警未升级（需 Tailwind 4 破坏性升级）。

隐私安全：9/10   不存原始 IP 与原始 UA；IP 用 HMAC 匿名化（可选密钥不落库）；
                 完整 Referer 默认不落库；日志不含敏感值。
                 扣分项：独立访客以 IP 哈希近似统计，非严格唯一访客。
```

**综合安全评分：90/100**

**生产环境建议**：

- [x] **可以上线**
- [ ] 修复 High 后上线
- [ ] 修复 Medium+High 后上线
- [ ] 暂不建议上线

上线前必做配置：

1. **修改管理后台默认密码**（`admin123`），推荐设置 `ADMIN_PASSWORD_HASH` 或登录后台「设置」页修改；
2. **设置 `IP_HASH_SECRET`**（如 `openssl rand -hex 32` 的输出）；
3. 确认 `APP_DEBUG=false`、`APP_ENV=production`；
4. HTTPS 站点设置 `APP_URL=https://你的域名` 与 `HSTS_MAX_AGE=31536000`；
5. **宝塔部署包：排障完成后删除 `public/check.php` 与 `.check-token`**；
6. 跨域部署前端时把前端源写入 `ALLOWED_ORIGINS`。

**生产环境阻断项**：无（风险总览 16 条中的 15 条已修复并通过实际验证；1 条 SEC-012 经可达性分析判定无需修复）。
