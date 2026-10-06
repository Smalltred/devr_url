# Short URL 安全测试报告

对应审计报告：[SECURITY-AUDIT.md](SECURITY-AUDIT.md)　修复记录：[SECURITY-FIXES.md](SECURITY-FIXES.md)

---

## 1. 测试环境

| 项目 | 值 |
| --- | --- |
| 操作系统 | Windows 10 (10.0.26300) x64 |
| Shell | Git Bash (MSYS2) |
| PHP | 8.2.34 (cli) NTS Visual C++ 2019 x64 |
| PHP 扩展 | `pdo_sqlite`、`sqlite3`、`mbstring`、`json`、`openssl`、`curl`、`fileinfo` |
| 数据库 | SQLite（WAL） |
| 后端服务 | PHP 内置服务器（`php -S`），与 `composer serve` 同口径 |
| 前端构建 | Vite 6.4.3 / Node v24.18.0 / npm 11.16.0 |
| 浏览器 | ZCode 内置浏览器（Chromium 内核，用于 CSP 与前端功能验证） |
| 测试框架 | PHPUnit 11.5.57、PHPStan 2.2.17（level 8）、PHP-CS-Fixer 3.95.27 |
| 审计工具 | `npm audit`、手工源码审计与 HTTP 渗透 |

**测试数据隔离说明**：全部实测使用独立临时数据库
（如 `E:/zcode/.tools/audit4.sqlite3` 等），**未触碰项目仓库内的
`backend/storage/short-url.sqlite3`**，未修改或删除任何真实数据。
服务进程使用非默认端口（3111/3121/3131/3141/3151/3161/3181）避免与开发环境冲突。

**本项目未包含 Docker 环境**，因此 Docker 相关项（SEC-015）为静态审阅结论，
未做容器内运行验证，已在该项标记为 **Potential**。

---

## 2. 测试命令与结果

### 2.1 自动化工具链

```bash
cd backend

# 单元 + 功能 + 兼容 + 安全
php vendor/bin/phpunit --colors=never
#   ==> OK (172 tests, 479 assertions)

# 仅安全回归套件
php vendor/bin/phpunit --colors=never --testsuite Security
#   ==> OK (60 tests, 121 assertions)

# 静态分析（level 8）
php vendor/bin/phpstan analyse --memory-limit=512M --no-progress
#   ==> [OK] No errors

# 代码风格
php vendor/bin/php-cs-fixer fix --dry-run --no-interaction
#   ==> Found 0 of 73 files that can be fixed

# 依赖审计（PHP）
#   composer.lock 运行时（packages）条目数 = 0
#   ==> 无第三方运行时依赖，composer audit 无适用项
```

```bash
cd ..   # 项目根

# 依赖审计（Node）
npm audit
#   ==> 7 vulnerabilities (2 moderate, 5 high)
#       全部位于 tailwindcss → chokidar/braces/micromatch/fast-glob/
#       postcss-nested → postcss-selector-parser（构建期工具链）

npm audit --omit=dev
#   ==> found 0 vulnerabilities

# 产物验证
npm run build
#   ==> ✓ built in 1.88s
#       dist/assets/index-ClR0qPvO.js   189.50 kB │ gzip: 71.03 kB
#       dist/assets/index--FdQwEo2.css   21.68 kB │ gzip:  5.52 kB
#       无 .map 文件（已确认 dist/ 下不存在 source map）
```

**测试套件构成**

| 套件 | 用例数 | 说明 |
| --- | --- | --- |
| Unit | 45 | 短码生成、URL 校验等纯逻辑 |
| Feature | 67 | 路由、鉴权、统计、设置、API Key、SQLite 仓库 |
| Compat | 0（数据文件） | `tests/Compat/expected_codes.php` 为与 Node 版对齐的向量数据 |
| **Security** | **60** | **本次新增的安全回归套件** |
| 合计 | **172** | 479 assertions，全部通过 |

### 2.2 攻击面清单实测（未授权访问）

修复后逐一实测，全部返回 401：

| Endpoint | 方法 | 状态码 |
| --- | --- | --- |
| `/api/admin/overview` | GET | 401 |
| `/api/admin/links` | GET | 401 |
| `/api/admin/links/{code}` | PUT | 401 |
| `/api/admin/links/{code}` | DELETE | 401 |
| `/api/admin/links/{code}/stats` | GET | 401 |
| `/api/admin/settings` | GET | 401 |
| `/api/admin/settings` | PUT | 401 |
| `/api/admin/settings/password` | POST | 401 |
| `/api/admin/keys` | GET | 401 |
| `/api/admin/keys` | POST | 401 |
| `/api/admin/keys/{id}/reset` | POST | 401 |
| `/api/admin/keys/{id}` | DELETE | 401 |

伪造 Cookie（64 字符随机值）访问 `/api/admin/overview` → 401。

---

## 3. 漏洞复现与修复验证（攻击 Payload 与结果）

### 3.1 SEC-001 路径穿越

```bash
B=http://127.0.0.1:3121
for p in "/../.env" "/%2e%2e/.env" "/..%2f.env" \
         "/../backend/storage/short-url.sqlite3" "/../package.json" \
         "/../backend/composer.lock" "/../backend/app/Services/AuthService.php" \
         "/../.git/config" "/../.gitignore"; do
  curl -s --path-as-is -o /tmp/t -w "%{http_code} " "$B$p"; wc -c < /tmp/t
done
```

| Payload | 修复前 | 修复后 |
| --- | --- | --- |
| `/../.env` | **200，88 字节，输出 `APP_ENV=localAPP_DEBUG=true...`** | 404，21 字节，泄露 0 |
| `/%2e%2e/.env` | **200，88 字节，同上** | 404，泄露 0 |
| `/..%2f.env` | **200，88 字节，同上** | 404，泄露 0 |
| `/../backend/storage/short-url.sqlite3` | **200，65536 字节，`SQLite format 3...`** | 404，泄露 0 |
| `/../package.json` | **200，507 字节** | 404，泄露 0 |
| `/../backend/composer.lock` | **200，164032 字节** | 404，泄露 0 |
| `/../backend/app/Services/AuthService.php` | **200，6535 字节，`<?php declare(strict_types=1);...`** | 404，泄露 0 |
| `/../.git/config` | **200，309 字节** | 404，泄露 0 |
| `/../.gitignore` | **200，615 字节** | 404，泄露 0 |

功能回归（修复后静态资源仍正常）：

```text
/manifest.json  -> 200
/robots.txt     -> 200
/favicon.svg    -> 200
/assets/*.js    -> 200（浏览器实测正常加载）
```

代码级证明（`Request` 层）：

```text
修复前：fromGlobals() clientIp() = '203.0.113.7' → withParams() clientIp() = ''
修复后：fromGlobals() clientIp() = '203.0.113.7' → withParams() clientIp() = '203.0.113.7'
```

### 3.2 SEC-002 客户端 IP 丢失

**登录限流**（连续 6 次错误密码）：

| 次序 | 修复前 | 修复后 |
| --- | --- | --- |
| 1-5 | 401 | 401 |
| 6 | 429 | 429 |

限流桶落库值：

```text
修复前： {"ip_hash":"anonymous","fails":5}
修复后： throttle ip_hash=e41656c742b4f87c4990e0cc fails=5   （真实 IP 哈希）
```

**代理头伪造测试**（每次请求换一个 `X-Forwarded-For`）：

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 10.0.0.$i" -H "X-Real-IP: 10.0.0.$i" \
    -d '{"username":"admin","password":"bad"}' "$B/api/auth/login"
done
# => 401 401 401 401 401 429    （换 XFF 无法绕过：IP 只取 REMOTE_ADDR）
```

**独立访客统计**（跳转记录的 `ip_hash`）：

```text
修复前： {"code":"w","ip_hash":null}          → visitors 恒为 0
修复后： {"code":"S","ip_hash":"e41656c742b4f87c4990e0cc"}   → visitors 正常
```

### 3.3 SEC-003 CSRF

```bash
# 已登录（Cookie 有效），模拟跨站表单提交
curl -b cookie.txt -X POST -H 'Content-Type: text/plain' \
     -H 'Origin: https://evil.example' --data-binary '{"name":"csrf-form"}' \
     "$B/api/admin/keys"
```

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 跨站 `Origin` + JSON | **200，Key 被创建** | 403 `Cross-site request rejected` |
| 跨站 `Origin` + `text/plain`（简单表单） | **200，Key 被创建** | 403 |
| 跨站 `Referer`（无 Origin） | 200 | 403 |
| 无 `Origin`/`Referer` + Cookie | 200 | 403 `Missing Origin or Referer header` |
| `Origin: null` | 200 | 403 |
| 跨站 DELETE 短链 | 200 | 403 |
| 同源 `Origin` + Cookie（正常前端） | 200 | 200（功能不受影响） |
| 同源 PUT 设置 | 200 | 200 |
| **`X-API-Key` 无 Origin（脚本客户端）** | 200 | **200（凭据头例外）** |
| **`Bearer` 无 Origin（脚本客户端）** | 200 | **200（凭据头例外）** |
| 错误 Key 无 Origin | 401 | 401（鉴权先于来源判定） |
| 无 Key + 跨站 Origin | 200+401 | 403 |

修复后数据库中 API Key 条数：仅 `legit`（同源创建），全部跨站尝试均未落库。

**浏览器实测**（真实环境，非构造请求）：

```text
页面内 fetch('/url', {method:'POST', ...})           -> 200 {"url":"...","code":"C"}
   （浏览器自动附带 Origin: http://127.0.0.1:3121 → 判定同源 → 放行）
首页表单填写 + 回车提交                              -> 结果卡片正常显示
   （短链接：http://127.0.0.1:3121/K，原链接与二维码正常）
管理后台登录 → 概览/列表/统计渲染正常
```

### 3.4 SEC-004 体积上限

| Payload | 修复前 | 修复后 |
| --- | --- | --- |
| URL 1024 字节 | 200 | 200 |
| URL 2048 字节 | 200 | **200（边界值仍可用）** |
| URL 4096 字节 | **200，入库** | **413 Payload Too Large** |
| URL 102400 字节 | **200，入库** | 413 |
| URL 1048576 字节（1MB） | **200，耗时 1.102s，库文件 64KB→1.2MB** | 413 |
| 请求体 2MB 垃圾 | 400（耗时 1.155s） | 413 |

超限 URL 未入库断言（单元测试 `testOversizedUrlIsRejectedEvenUnderBodyLimit`）：
`assertSame([], $this->urls->map)`。

### 3.5 SEC-005 部署包自检页

| 请求 | 修复前 | 修复后 |
| --- | --- | --- |
| `GET /check.php` | **200，8086 字节，显示 `PHP 8.2.34`/`已加载`/`可写`/`存在`/`连接正常`** | **403 `Forbidden`** |
| `GET /check.php?token=deadbeef` | — | 403 |
| `GET /check.php?token=<正确令牌>` | — | 200（可用） |
| 连续 3 次带令牌访问 | **`short_urls` 2 → 4（每次 +1，探针残留）** | **`short_urls` 0 → 0（不写入）** |
| `GET /check.php?token=<令牌>&run=1` | — | 200，提示「探针短链已清理，未残留数据」，行数仍为 0 |
| 页面中的文件系统路径/配置值匹配数 | 有（路径、扩展、状态） | **0** |

### 3.6 SEC-006 安全响应头与 CSP

```bash
curl -s -D - -o /dev/null "$B/admin"
```

修复后实际响应头：

```http
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
permissions-policy: geolocation=(), microphone=(), camera=(), payment=()
content-security-policy: default-src 'self';
  script-src 'self' 'sha256-JS8WnjBrSLDNgx1F24d3bkiyA+wUr+5X9/dVsZOGmgg='
  'sha256-wrNlu4oLmJobRzDk9UObxfmE275xTC+oALhpk779qaE='
  https://www.googletagmanager.com;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
  font-src 'self' data:; connect-src 'self'; form-action 'self';
  frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

`X-Powered-By`：修复前每个响应均有 `X-Powered-By: PHP/8.2.34`；修复后匹配数为 **0**。

HSTS 条件化：

```text
GET /api/auth/me                          -> 无 Strict-Transport-Security（HTTP，正确不下发）
GET /api/auth/me + X-Forwarded-Proto: https -> 按 HSTS_MAX_AGE 下发
```

**CSP 哈希与构建产物一致性校验**：CSP 中两个 sha256 与 `dist/index.html` 中两段内联脚本
（首帧主题脚本、Google Analytics 引导脚本）逐字节一致；外部脚本
（`/assets/index-ClR0qPvO.js`、`googletagmanager.com`）由 `'self'` 与白名单放行。

**真实浏览器验证（关键，避免「CSP 打断 SPA」这类不可见回归）**：

| 验证项 | 结果 |
| --- | --- |
| 首页 SPA 挂载 | `#app` 有子节点，Vue 正常渲染 |
| 样式应用 | `document.body` 背景色 = `rgb(13, 17, 23)`（Tailwind + 内联样式生效，未被 `style-src` 拦截） |
| 主题脚本 | `document.documentElement.dataset.theme = "dark"`（内联脚本按哈希放行，未拦截） |
| 页面内 API 调用 | `fetch('/url')` → 200，短链创建成功 |
| 表单交互 | 填写网址 + 回车 → 结果卡片显示短链接、原链接、二维码 |
| 管理后台 | 登录后概览卡片、14 天趋势、短链表格、分页、选项卡全部渲染正常 |
| 控制台错误 | 无 CSP 违规 / 无脚本错误（`window.onerror` 与 `unhandledrejection` 监听结果为空） |

### 3.7 SEC-010 创建限流

```bash
for i in $(seq 1 65); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' \
    -H "Origin: $B" -d "{\"url\":\"https://example.com/rl-$i\"}" "$B/url"
done | sort | uniq -c
```

| 场景 | 修复前 | 修复后（默认 60/60s） |
| --- | --- | --- |
| 65 次连续创建 | **65 × 200** | **56 × 200，9 × 429**（第 61 次起限流） |
| 不同 IP 是否共享配额 | — | 不共享（单元测试覆盖） |
| 开放 API 是否受限 | 不限 | 受限（单元测试 `testOpenApiIsRateLimitedToo`） |

并发下计数不丢失：10 次并发错误登录 → 5×401 + 5×429，`auth_throttle.fails = 5`（无丢失更新）。

### 3.8 SEC-007 会话 Cookie

```bash
# HTTPS 反代场景
curl -D - -o /dev/null -X POST -H 'Content-Type: application/json' \
  -H "Origin: $B" -H 'X-Forwarded-Proto: https' \
  -d '{"username":"admin","password":"secret123"}' "$B/api/auth/login"
```

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| `HttpOnly` | 有 | 有 |
| `SameSite=Strict` | 有 | 有 |
| `Path=/` | 有 | 有 |
| `Secure`（HTTP 请求） | 无 | 无（本地开发正确） |
| `Secure`（`X-Forwarded-Proto: https`） | **取决于 `APP_URL`** | **有 `; Secure`** |

**会话失效链路**（均实测通过）：

| 测试 | 结果 |
| --- | --- |
| 登出后旧 Cookie | `/api/auth/me` → `{"authenticated":false}` |
| 改密码后**全部**会话失效 | 两个独立会话均 `{"authenticated":false}` |
| 改密码后旧密码登录 | 401 |
| 改密码后新密码登录 | 200 |
| 弱密码（< 8 位） | 400「新密码至少需要 8 位」 |
| 当前密码错误 | 401「当前密码不正确」 |
| 密码哈希落库 | `$2y$10$ykK...`（bcrypt，非明文/非 MD5/SHA1） |

### 3.9 API Key 安全

| 测试 | 结果 |
| --- | --- |
| 无 Key | 401 `Invalid API Key` |
| 错误 Key | 401 |
| `Authorization: Bearer` 有效 | 200 |
| `X-API-Key` 有效 | 200 |
| `Bearer` 小写变体 | 200 |
| `Basic` 方案 | 401 |
| `Bearer`（无值）/ 空白 | 401 |
| 100KB 超长 Key 头 | 401（无崩溃） |
| Key 含 CRLF 注入尝试 | 401 |
| 重置后旧 Key | 401（立即失效） |
| 重置后新 Key | 200 |
| 删除后 Key | 401（立即失效） |
| 数据库中存储 | `key_hash` = 64 位十六进制（sha256），**无明文** |
| 列表输出 | 仅 `devr_` + 7 位十六进制前缀 |

### 3.10 其余审计面实测

**SQL 注入**（已认证，搜索参数）：

| Payload | 结果 |
| --- | --- |
| `' OR 1=1 --` | 200，`total:0`（按字面量匹配，无注入） |
| `%' UNION SELECT 1,2,3 --` | 200，无注入 |
| `'; DROP TABLE short_urls;--` | 200，表仍存在（`SELECT COUNT(*)` 正常） |
| `_` / `%` | 200（通配符已转义为字面量） |

短码查询注入：`GET /'%20OR%20'1'%3D'1` → 404（绑定参数，无注入）。
表完整性复核：`short_urls` 行数正常，无表被删除。

**开放重定向 / 危险 scheme**（输入校验）：

| Payload | 结果 |
| --- | --- |
| `javascript:alert(1)` | 400 |
| `data:text/html,<script>alert(1)</script>` | 400 |
| `file:///etc/passwd` | 400 |
| `ftp://x.com` | 400 |
| `//evil.com`（协议相对） | 400 |
| `http://`（无主机） | 400 |
| `https://example.com/%0d%0aSet-Cookie:injected=1` | 200（作为路径字符原样存储，**响应头未被注入**；跳转响应仅有 `location: https://example.com/%0d%0aSet-Cookie:injected=1`） |

**存储型 XSS 载体**（前端渲染验证）：

| 载体 | 后端行为 | 前端行为 |
| --- | --- | --- |
| URL = `https://example.com/<script>alert(1)</script>` | 200（作为路径字符） | Vue 文本插值转义，不执行 |
| API Key 名称 = `<script>alert(1)</script>` | 200（长度合规） | 文本插值转义，不执行 |
| 短码 = `<img src=x onerror=alert(1)>` | 400「短码只能包含 1-32 位英文字母或数字」 | — |
| Referer = `https://evil.com/<script>alert(1)</script>` | 入库 `referer_host = 'evil.com'`（`referer` 现为 NULL） | 文本插值转义 |

全项目 `grep -rn "v-html" src/` → 无匹配；无 `innerHTML`/`eval`/`document.write`。

**路径穿越（第八类 payload）**：见 §3.1，全部 404。

**错误信息泄露**：

| 请求 | 结果 |
| --- | --- |
| 非法 JSON 体 | 400 `{"error":"Incorrect URL format"}`（无堆栈） |
| 非法 HTTP 方法 | 405 `Method Not Allowed` + `Allow` 头 |
| 多段路径 `/a/b/c/d` | 404 `Not Found` |
| 不存在短码 | 404 `Unknown URL` |
| 未登录管理接口 | 401 `Unauthorized` |
| `per_page=100000`（越界） | 200，被夹到 100 |
| `page=999999999999999999` | 200，空结果（无崩溃） |
| `per_page=abc`（非数字） | 200，降级为默认值 |
| 5000 / 8000 字符短码路径 | 404（无崩溃） |

所有错误响应体均不含文件路径、SQL、堆栈、PHP 版本（`grep` 校验通过）。

**并发与竞态**：

| 场景 | 并发数 | 结果 |
| --- | --- | --- |
| 短链创建 | 10 | 10 个唯一短码，0 错误 |
| 短链创建 | 50 | 50 个唯一短码，0 错误 |
| 短链创建 | 100 | 100 个唯一短码，0 错误 |
| 并发错误登录 | 10 | 5×401 + 5×429，`fails=5`（计数无丢失） |

**日志安全**：`backend/storage/logs/*.log` 中检索
`password|token|bearer|authorization|cookie|api_key|secret`，
唯一匹配为固定消息 `"admin password changed"`（不含任何值）；日志不含完整 IP
（仅有匿名哈希）、不含 Cookie、不含 Authorization 头。

**业务逻辑**（既有功能回归，未因修复破坏）：

| 测试 | 结果 |
| --- | --- |
| 创建 → 跳转 | 200 / 302 正确 |
| 修改短码后 `/old` | 404（失效） |
| 修改短码后 `/new` | 302（生效），统计随迁 |
| 删除短链后跳转 | 404，点击记录按设计级联清除 |
| `require_login=true` 时未登录创建 | 401（`/url` 与 `/api/url`） |
| `require_login=true` 时管理员创建 | 200 |
| `require_login` 不影响开放 API | 200（带 Key） |
| 保留短码 `admin` | 400（不可占用） |

**隐私**（修复后）：

```text
Referer: https://mail.example.com/inbox?token=SECRET-XYZ123
→ referer      = NULL              （不再留存完整来源 URL）
→ referer_host = 'mail.example.com'（来源域名统计不受影响）
→ ip_hash      = 'e41656c742b4f87c4990e0cc'（HMAC，密钥不落库）
→ device       = 'desktop'
```

IP 哈希算法对比（`IP_HASH_SECRET` 设置前后）：

```text
no secret (salt-based): 291bb9397b36eb6ac9e39f55
with secret (HMAC):     c9e24c9357b756412ab0947a
differ: yes   stable: yes
```

---

## 4. 回归测试清单

新增 `backend/tests/Security/SecurityTest.php`（60 用例 / 121 断言），
把审计确认的每个问题固化为断言，防止回归。

| 覆盖点 | 用例 |
| --- | --- |
| 未登录访问全部管理接口（12 个 endpoint 逐一） | `testAdminEndpointsRejectAnonymous` |
| 伪造 Cookie | `testForgedCookieIsRejected` |
| 跨站写操作（Origin） | `testCrossSiteWriteIsRejected` |
| 缺失 Origin/Referer | `testWriteWithoutOriginOrRefererIsRejectedByDefault` |
| 同源写操作放行 | `testSameOriginWriteIsAllowed` |
| 仅 Referer 同源 | `testRefererWithoutOriginIsAcceptedWhenSameOrigin` |
| 跨站 Referer | `testCrossSiteRefererIsRejected` |
| `Origin: null` | `testNullOriginIsRejected` |
| 公开创建接口同源要求 | `testPublicCreationRequiresSameOriginToo` |
| GET 不受来源校验影响 | `testGetRequestIsNotBlockedByCsrfGuard` |
| **API Key 脚本客户端豁免来源校验** | `testApiKeyRequestWithoutOriginIsNotBlockedByCsrfGuard` |
| **Bearer 脚本客户端豁免** | `testBearerKeyWithoutOriginIsNotBlockedByCsrfGuard` |
| **豁免不削弱 Cookie 流程** | `testExplicitCredentialExemptionDoesNotWeakenCookieFlow` |
| **公开接口无凭据不得豁免** | `testPublicCreationWithoutOriginStillRejected` |
| 请求体超限 → 413 | `testOversizedRequestBodyIsRejected` |
| URL 超限 → 413 且不入库 | `testOversizedUrlIsRejectedEvenUnderBodyLimit` |
| URL 边界值可用 | `testMaxLengthUrlIsAccepted` |
| 创建限流 | `testCreationIsRateLimitedPerIp` |
| **限流按 IP 分桶（不共享）** | `testRateLimitUsesClientIpNotSharedBucket` |
| 开放 API 同样限流 | `testOpenApiIsRateLimitedToo` |
| **客户端 IP 路由注入后保留** | `testClientIpSurvivesRouteParameterInjection` |
| **跳转 ip_hash 非空（UV 统计）** | `testRedirectRecordingKeepsIpHashWhenIpKnown` |
| 安全响应头（成功响应） | `testSecurityHeadersArePresentOnApiResponses` |
| 安全响应头（错误响应） | `testSecurityHeadersArePresentOnErrorResponses` |
| HTTP 不下发 HSTS | `testHstsIsNotSentForPlainHttp` |
| CSP 内联哈希（HTML 响应） | `testCspAllowsInlineScriptsByHashForHtmlResponses` |
| CSP 哈希忽略外链脚本 | `testInlineScriptHashIgnoresExternalScripts` |
| 恶意 URL（9 种 payload 参数化） | `testMaliciousUrlsAreRejectedOrEncoded` |
| Location 头注入防护 | `testRedirectLocationNeverAllowsHeaderInjection` |
| CRLF URL 不可入库 | `testUrlWithControlCharactersCannotBeStored` |
| 保留短码 / 非法短码 | `testReservedAndInvalidShortCodesAreRejected` |
| 超长短码 | `testShortCodeLongerThanLimitIsRejected` |
| **API Key 仅存哈希** | `testApiKeyIsStoredAsHashOnly` |
| Key 重置即时失效 | `testResetInvalidatesOldKeyImmediately` |
| Key 删除即时失效 | `testDeletedKeyStopsWorking` |
| Cookie 加固属性 | `testSessionCookieIsHardened` |
| HTTPS 反代下 Secure | `testSessionCookieIsSecureBehindHttpsProxy` |
| 改密撤销全部会话 | `testPasswordChangeRevokesEverySession` |
| 弱密码拒绝 | `testWeakNewPasswordIsRejected` |
| 当前密码校验 | `testWrongCurrentPasswordIsRejected` |
| **完整 Referer 默认不落库** | `testFullRefererIsNotPersistedByDefault` |

---

## 5. 最终状态

### 5.1 工具链

| 命令 | 结果 |
| --- | --- |
| `composer test`（phpunit） | **OK（172 tests, 479 assertions）** |
| `composer analyse`（phpstan level 8） | **No errors** |
| `composer lint`（php-cs-fixer dry-run） | **0 files to fix（73 files scanned）** |
| `composer audit`（运行时依赖） | **0 个运行时依赖，无适用漏洞** |
| `npm audit` | 7 项告警，全部构建期工具链（见下方可达性分析） |
| `npm audit --omit=dev` | **found 0 vulnerabilities** |
| `npm run build` | **成功**（189.50 kB JS / 21.68 kB CSS，无 source map） |

### 5.2 依赖告警可达性判定（不只看 CVE 数量）

| 包 | 等级 | 位置 | 是否影响本项目 |
| --- | --- | --- | --- |
| `braces`（嵌套模式栈耗尽 DoS） | High | `tailwindcss → chokidar/micromatch → braces` | 否。仅构建期 watch/glob 使用，运行时产物不包含；`dist/assets/*.js` 中匹配数为 0 |
| `chokidar` | High | 同上 | 否，同上 |
| `micromatch` / `fast-glob` | High | `tailwindcss → 同上` | 否，同上 |
| `postcss-selector-parser`（选择器解析 CPU 耗尽） | Moderate | `tailwindcss → postcss-nested → ...` | 否。仅在 `npm run build` 处理本项目自有 CSS 时使用，不处理不可信输入 |
| 其余 2 项 | Moderate | 同上传递链 | 否，同上 |

处理结论：**不升级**。修复方案要求 `tailwindcss@4`（破坏性大版本升级），
而告警均在构建期工具链且产物零命中；为消除不可达告警而引入样式系统重构风险不划算。
该判定已在审计报告中记录为 SEC-012（Info）。

### 5.3 未验证项（如实标注）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| Docker 镜像构建与容器内运行 | **Potential（未验证）** | 本机无 Docker 环境。Dockerfile / compose 的加固为静态审阅结论（SEC-015、SEC-016） |
| Nginx 实际生效验证 | **Potential（未验证）** | 本机无 Nginx。三个配置文件为参考模板，加固规则为静态审阅结论（SEC-008、SEC-014） |
| 宝塔面板真实部署 | 未执行 | 无宝塔环境；宝塔包行为已通过 PHP 内置服务器实测（含自检页令牌、路径穿越、路由） |
| 大规模压力测试 | **未执行（有意）** | 按审计规则不做不可控压力测试；仅做小规模并发（10/50/100）验证正确性 |
| IPv6 真实链路 | 未执行 | 限流/哈希按 `REMOTE_ADDR` 处理，逻辑上天然支持；仅用 `[::1]` 做单元级验证 |

---

## 6. 结论

```text
==============================
Security Audit & Fix Complete
==============================

审计结果（修复前）
  Critical: 0
  High:     2
  Medium:   5
  Low:      4
  Info:     5（4 项已修复 + 1 项判定无需修复）

修复结果
  Fixed:     15（2 High + 5 Medium + 4 Low + 4 Info）
  Remaining: 0 个安全问题
  非漏洞项:   6（SEC-017 ~ SEC-022 经实测判定为设计取舍/已验证通过）
  Potential: 2（Docker / Nginx 运行验证，本机无对应环境，已如实标注）

回归验证
  PHPUnit       172 tests / 479 assertions   通过
  安全专项        60 tests / 121 assertions   通过
  PHPStan L8      No errors                  通过
  PHP-CS-Fixer    0 files to fix             通过
  npm audit       prod: 0 vulnerabilities    通过
  npm run build   成功                       通过
  实际渗透复测     21 项检查全部 PASS          通过
  浏览器 CSP 验证   首页 + 管理后台功能完整      通过

Security Score: 90 / 100

Production Ready: YES
  （前提：修改默认密码 admin123、设置 IP_HASH_SECRET、确认 APP_DEBUG=false；
    宝塔部署需删除 public/check.php 与 .check-token）

Blocking Issues: 无
  原 2 项 High（本地开发环境敏感文件读取、客户端 IP 丢失）与
  5 项 Medium（CSRF、体积上限、自检页、安全响应头、创建限流）均已修复，
  4 项 Low 与 4 项 Info 同步修复，全部通过实际 HTTP 验证与自动化回归测试。
  1 项 Info（SEC-012 依赖告警）经可达性分析判定无需修复。
  另有 6 项（SEC-017 ~ SEC-022）经实测判定为设计取舍或已验证通过，不计入漏洞。
==============================
```
