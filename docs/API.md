# API 文档（devr）

公开接口与原 Node.js 版（server.js）行为保持兼容；管理端接口为本版新增。响应体均为 `application/json; charset=utf-8`。
## 创建短链接

```http
POST /url
Content-Type: application/json

{
    "url": "https://example.com"
}
```

> 若管理后台开启「创建短链需要登录」，本接口未登录时返回 `401 {"error":"Unauthorized"}`。

**成功（200）**

```json
{
    "url": "https://example.com",
    "code": "SB"
}
```

- `code`：短码，完整短链为 `站点域名/{code}`；
- `url`：归一化后的原链接（非 ASCII 字符会被百分号编码）；
- 同一 URL 重复提交会生成多个不同短码（与原版一致，无去重）。

**失败（400）**

```json
{
    "error": "Incorrect URL format"
}
```

校验规则：

- 必须是字符串、非空；
- 必须 `http://` 或 `https://` 开头且存在主机名；
- 不允许包含空白字符；
- 支持 IPv4 / IPv6 / 端口 / 中文路径与查询参数（自动百分号编码）。

## 新版规范别名（可选）

```http
POST /api/url
```

请求与响应与 `POST /url` 完全一致。原 `/url` 接口**永久保留**，供存量前端与调用方使用。

## 短链接跳转

```http
GET /{code}
```

```text
HTTP/1.1 302 Found
Location: https://example.com
```

- 短码不存在：

```json
HTTP/1.1 404 Not Found

{
    "error": "Unknown URL"
}
```

- 静态资源（`/`、`/favicon.ico`、`/assets/*` 等）由 Nginx 直接返回 Vue 页面，不进入 Node 进程。

## 健康检查

```http
GET /healthz
```

```json
{"ok": true, "links": 12}
```

触发一次数据库查询确认存储可用，供容器/负载均衡/宝塔探活使用（无鉴权、不写数据）。

## 状态码约定

| 状态码 | 场景 |
| --- | --- |
| 200 | 创建成功 / 管理接口成功 |
| 302 | 短链跳转 |
| 400 | 请求参数错误（URL 非法 / 缺字段 / 非法 JSON / 短码不合法） |
| 401 | 未登录或登录态失效（管理接口）；用户名或密码错误；API Key 缺失或无效（开放接口） |
| 403 | 跨站来源的写操作被拒（Origin/Referer 校验失败） |
| 404 | 短码不存在；API Key 不存在（重置/删除） |
| 405 | HTTP 方法不允许（带 Allow 头） |
| 409 | 新短码已被占用 |
| 413 | 请求体或目标 URL 超出上限（默认请求体 16384 字节、URL 2048 字节） |
| 429 | 登录失败次数过多被限流（15 分钟窗口内失败 5 次）；创建短链超出频次（默认 60 次/分钟/IP） |
| 500 | 服务器内部错误 |
| 503 | 存储不可用（SQLite 打开/读写失败） |

## 安全相关请求约定

| 项目 | 约定 |
| --- | --- |
| 写操作来源校验 | 非 GET/HEAD 请求必须来自同源：浏览器会自带 `Origin`（或 `Referer`），其主机须与请求 `Host` 一致。跨域部署时把前端源写入 `ALLOWED_ORIGINS`（逗号分隔）。命中 `403`。 |
| 非浏览器客户端 | 用 curl/脚本调用写接口时同样要带 `Origin`（或 `Referer`）头，否则默认返回 `403`。若确有无法补头的集成方，可设 `CSRF_ALLOW_MISSING_ORIGIN=true` 放行，但会降低跨站防护强度。**携带 API Key（`Authorization: Bearer` / `X-API-Key`）的请求豁免来源校验**——显式凭据头不构成 CSRF 场景，开放 API 的脚本客户端因此无需补 Origin。 |
| 请求体上限 | 默认 16384 字节，可用 `MAX_BODY_BYTES` 调整；超出返回 `413`。 |
| 目标 URL 上限 | 2048 字节（归一化后），超出返回 `413`。 |
| 创建频次 | 公开接口与开放 API 共用计数，默认 60 次/分钟/IP，超出 `429`；`CREATE_RATE_LIMIT_MAX=0` 关闭。 |
| 安全响应头 | 所有响应带 CSP、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`；`HSTS_MAX_AGE>0` 且请求为 HTTPS 时追加 HSTS。 |
| 来源统计 | 默认只保存来源域名（`referer_host`），不保存完整 Referer（可能含查询串密钥）；`PRIVACY_STORE_REFERER=true` 可改回完整保存。 |

## curl 示例

```bash
# 创建（写操作需带同源 Origin/Referer，浏览器会自动携带）
curl -s -X POST http://localhost:3001/url \
    -H 'Content-Type: application/json' \
    -H 'Origin: http://localhost:3001' \
    -d '{"url": "https://github.com/onee-io/short-url"}'
# => {"url":"https://github.com/onee-io/short-url","code":"SB"}

# 跳转（GET 无需来源头）
curl -sI http://localhost:3001/SB
# => HTTP/1.1 302 Found
#    Location: https://github.com/onee-io/short-url

# 不存在的短码
curl -s http://localhost:3001/zzzzzz
# => {"error":"Unknown URL"}
```

## 前端对接

Vue 3 前端调用 `POST /url`（见 `src/services/entity.js`），API 地址由构建时环境变量
`VITE_API_BASE_URL` 决定，留空为同源（推荐，配合 Nginx 反代），不会硬编码域名。

## 管理后台

入口：浏览器访问 `/admin`（后端返回同一份前端 SPA，登录后展示管理面板）。以下接口除
`/api/auth/*` 外均要求登录，未登录返回 `401 {"error":"Unauthorized"}`。

登录态说明：

- 登录成功后服务端签发随机 token，库存 sha256 哈希，Cookie（`admin_token`）为
  `HttpOnly; SameSite=Strict; Path=/; Max-Age=7天`（`APP_URL` 为 https 时附带 `Secure`）；
- 浏览器自动携带 Cookie，前端无需保存 token；
- 登录失败按 IP 匿名哈希节流：15 分钟内失败 5 次后返回 429。

### 登录

```http
POST /api/auth/login
Content-Type: application/json

{"username": "admin", "password": "你的密码"}
```

- 成功（200）：`{"ok": true}` + `Set-Cookie: admin_token=...`；
- 密码错误（401）：`{"error": "Unauthorized"}`；
- 被限流（429）：`{"error": "Too Many Attempts"}`。

### 登出

```http
POST /api/auth/logout
```

撤销当前 token 并清除 Cookie，返回 `{"ok": true}`。

### 会话查询

```http
GET /api/auth/me
```

```json
{
    "authenticated": false,
    "require_login": false
}
```

`require_login` 为后台「创建短链需要登录」开关状态，首页据此决定是否跳转登录页。

### 全站概览

```http
GET /api/admin/overview?period=day
```

- `period` 为趋势粒度，可选 `day` / `week` / `month` / `year`（默认 `day`；非法值回落为 `day`）；
  对应桶数约为 14 天 / 12 周 / 12 个月 / 5 年。

```json
{
    "links": 12,
    "total_clicks": 345,
    "clicks_today": 21,
    "period": "day",
    "daily": [{"date": "2026-09-22", "clicks": 0}, {"date": "2026-10-05", "clicks": 18}],
    "top_links": [{"code": "SB", "url": "https://example.com", "clicks": 120}]
}
```

`daily` 为按 `period` 聚合的全站点击数（UTC 口径），缺失桶补零：日粒度近 14 天；
周粒度近 12 周（周一为桶起点）；月粒度近 12 个月；年粒度近 5 年。

### 短链分页列表

```http
GET /api/admin/links?page=1&per_page=20&q=关键词
```

- `q` 对短码与目标链接做模糊匹配；`per_page` 上限 100。

```json
{
    "total": 12,
    "page": 1,
    "per_page": 20,
    "items": [{
        "code": "SB",
        "url": "https://example.com",
        "created_at": "2026-10-05 08:30:00",
        "clicks": 120,
        "clicks_today": 9
    }]
}
```

`created_at` 为 UTC 时间。

列表项还包含外链健康状态：

```json
{
    "health_status": "dead",
    "health_http_code": 404,
    "health_checked_at": "2026-10-23 02:46:00",
    "health_error": "HTTP 404",
    "health_fail_count": 3
}
```

- `health_status`：`ok` 正常 / `broken` 失效（待确认）/ `dead` 失效（已确认）/ `unknown` 未检测或无法判定；
  产品上 `broken` 与 `dead` 统一称「失效」，两个状态只用于内部决定复检节奏；
- `health_fail_count`：连续失败次数，成功一次即清零；
- 响应另含 `health` 汇总：
  `{"ok": 2, "invalid": 4, "broken": 1, "dead": 3, "unknown": 1, "pending": 0, "last_scan_at": "...", "dead_threshold": 3}`，
  其中 `invalid = broken + dead`。

支持按状态过滤：`GET /api/admin/links?health=invalid`（失效，含 `broken` 与 `dead`；
也可传 `ok` / `broken` / `dead` / `unknown`）。

### 扫描外链（分批）

```http
POST /api/admin/links/scan
Content-Type: application/json

{"limit": 20}
```

检测一批待检短链（`limit` 上限 100，默认 20）。返回：

```json
{
    "scanned": 20, "ok": 15, "broken": 3, "dead": 1, "skipped": 1,
    "remaining": 8,
    "summary": {"ok": 120, "broken": 3, "dead": 1, "unknown": 3}
}
```

`skipped` 为无法判定的条目（限流/内网地址/瞬时故障），不覆盖原状态；
`remaining` 为仍在复检间隔外、待下一批检测的数量。

### 一键清理失效链接

```http
POST /api/admin/links/cleanup-invalid
```

删除全部失效短链（`health_status` 为 `broken` 或 `dead`）及其点击记录，成功返回：

```json
{"deleted": 4, "health": {"ok": 120, "invalid": 0, "broken": 0, "dead": 0, "unknown": 3, "pending": 0, "last_scan_at": "...", "dead_threshold": 3}}
```

> 兼容别名：`POST /api/admin/links/cleanup-dead`、`POST /api/admin/links/cleanup-broken`
> 行为相同（均清理全部失效链接）。

### 编辑短链

```http
PUT /api/admin/links/{code}
Content-Type: application/json

{"url": "https://new.example.com", "code": "NEWCODE"}
```

`url` 与 `code` 均可省略（保持原值）。行为：

- 改短码后原短码立即失效，点击统计自动迁移到新短码；
- 新短码已被占用返回 `409`；短码不合法（须 1-32 位字母数字、非保留字）或 URL 非法返回 `400`。

成功（200）：`{"code": "NEWCODE", "url": "https://new.example.com"}`。

### 删除短链

```http
DELETE /api/admin/links/{code}
```

删除短链并级联删除其点击记录。成功（200）：`{"ok": true}`。

### 单链统计

```http
GET /api/admin/links/{code}/stats?period=day
```

- `period` 与全站概览一致（`day` / `week` / `month` / `year`，默认 `day`）。

```json
{
    "code": "SB",
    "url": "https://example.com",
    "total_clicks": 120,
    "clicks_today": 9,
    "visitors": 87,
    "period": "day",
    "daily": [{"date": "2026-09-22", "clicks": 0}],
    "referers": [{"referer_host": "google.com", "clicks": 66}],
    "devices": {"mobile": 52, "desktop": 68}
}
```

### 站点设置

```http
GET /api/admin/settings
```

```json
{
    "code_min_length": 1,
    "code_random": false,
    "require_login": false,
    "password_source": "env",
    "cache_ttl": 300,
    "cache_negative_ttl": 30,
    "cache": {
        "driver": "memcached",
        "available": true,
        "servers": ["127.0.0.1:11211"],
        "stats": {"hits": 128, "misses": 12, "items": 42}
    },
    "health_scan_enabled": true,
    "health_scan_hour": 12,
    "health_scan_minute": 0,
    "health_dead_threshold": 3
}
```

`cache` 为缓存运行时状态：`driver` 为 `memcached` 或 `null`；`available` 表示缓存当前是否可用
（false 时所有请求直连数据库，跳转不受影响）；`stats` 为 memcached 服务端累计命中统计。

`password_source`：`env` = 沿用环境变量配置（含默认密码）；`custom` = 已在后台修改过密码。

```http
PUT /api/admin/settings
Content-Type: application/json

{"code_min_length": 4, "code_random": true, "require_login": false, "cache_ttl": 600, "cache_negative_ttl": 45, "health_scan_hour": 12, "health_scan_minute": 0, "health_dead_threshold": 3}
```

各键均可省略（保持原值）。规则：

- `code_min_length`：1-16 的整数，否则 400；新短码不足该长度时自动补齐；
- `code_random`：布尔。开启后新短码随机生成（要求有效长度 ≥ 3，否则 400，落库前查重）；
- `require_login`：布尔。开启后 `POST /url`、`POST /api/url` 需登录，未登录返回 401；
- `cache_ttl`：0-86400 的整数（秒），短链跳转结果的缓存有效期，0 = 不缓存；
- `cache_negative_ttl`：0-3600 的整数（秒），缓存“短码不存在”的时长（抵御扫描流量），0 = 关闭；
- `health_scan_enabled`：布尔，是否启用每日定时巡检；
- `health_scan_hour`：0-23 的整数，每日巡检小时（服务器本地时间）；
- `health_scan_minute`：0-59 的整数，每日巡检分钟；
- `health_dead_threshold`：1-10 的整数，连续失败多少次判定为失效（默认 3）。

成功（200）返回保存后的设置视图。设置持久化于 SQLite，即时生效，无需重启。
管理后台「设置」页对上述各项采用**改动即自动保存**（防抖合并多次输入，无保存按钮），
本接口语义不变，仍可单独提交任意子集。

### 修改管理员密码

```http
POST /api/admin/settings/password
Content-Type: application/json

{"current_password": "当前密码", "new_password": "新密码"}
```

- 成功（200）：`{"ok": true}`，新密码哈希落库（优先于 `ADMIN_PASSWORD_HASH`/`ADMIN_PASSWORD`），**并撤销全部登录态**（所有端强制重新登录）；
- 当前密码错误（401）：`{"error": "当前密码不正确"}`；
- 新密码少于 8 位（400）。

### 点击采集说明

`GET /{code}` 跳转成功时自动记录一条点击（时间 UTC、来源域名、设备 mobile/desktop、
IP 匿名哈希 sha256(ip+盐) 前 24 位用于独立访客估算）。HEAD 请求不计数；采集失败不影响跳转。
原始 IP 与 User-Agent 不入库。

## 开放 API

供外部程序程序化创建短链。鉴权使用管理后台「设置」页创建的 API Key，
`Authorization: Bearer <key>` 或 `X-API-Key: <key>` 请求头二选一；
缺失或无效返回 `401 {"error":"Invalid API Key"}`。**不受「创建短链需要登录」门控影响**。

Key 安全模型：明文仅在创建/重置响应中出现一次，服务端只存 sha256 哈希；
列表只暴露前缀；重置后旧 Key 立即失效。

### 创建短链

```http
POST /api/open/shorten
Authorization: Bearer devr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{"url": "https://example.com"}
```

- 成功（200）：`{"url": "...", "code": "..."}`，与公开创建接口一致，短码遵循后台长度/随机性设置；
- URL 非法（400）：`{"error": "Incorrect URL format"}`；
- Key 无效（401）：`{"error": "Invalid API Key"}`。

每次成功调用会更新 Key 的最近使用时间（UTC）。

## 管理端：API Key 管理

以下接口需管理员登录。

```http
GET /api/admin/keys
```

```json
{
    "items": [{
        "id": 1,
        "name": "ci",
        "prefix": "devr_ab12cd3",
        "created_at": "2026-10-06 08:00:00",
        "last_used_at": "2026-10-06 09:30:00"
    }]
}
```

```http
POST /api/admin/keys
Content-Type: application/json

{"name": "ci"}
```

成功（200）：`{"id": 1, "name": "ci", "prefix": "devr_ab12cd3", "key": "devr_xxx..."}` —— **`key` 仅此一次返回**。
名称需为 1-64 个字符，否则 400。

```http
POST /api/admin/keys/{id}/reset
```

重置为新的明文 Key（响应结构同创建），旧 Key 立即失效，名称与创建时间不变；Key 不存在返回 404。

```http
DELETE /api/admin/keys/{id}
```

删除 Key，使用该 Key 的调用立即失败。成功（200）：`{"ok": true}`；不存在返回 404。
