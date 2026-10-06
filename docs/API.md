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

- 静态资源（`/`、`/favicon.ico`、`/assets/*` 等）由 Nginx 直接返回 Vue 页面，不进入 PHP。

## 状态码约定

| 状态码 | 场景 |
| --- | --- |
| 200 | 创建成功 / 管理接口成功 |
| 302 | 短链跳转 |
| 400 | 请求参数错误（URL 非法 / 缺字段 / 非法 JSON / 短码不合法） |
| 401 | 未登录或登录态失效（管理接口）；用户名或密码错误 |
| 404 | 短码不存在 |
| 405 | HTTP 方法不允许（带 Allow 头） |
| 409 | 新短码已被占用 |
| 429 | 登录失败次数过多被限流（15 分钟窗口内失败 5 次） |
| 500 | 服务器内部错误 |
| 503 | 存储不可用（SQLite 打开/读写失败） |

## curl 示例

```bash
# 创建
curl -s -X POST http://localhost:3001/url \
    -H 'Content-Type: application/json' \
    -d '{"url": "https://github.com/onee-io/short-url"}'
# => {"url":"https://github.com/onee-io/short-url","code":"SB"}

# 跳转
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
GET /api/admin/overview
```

```json
{
    "links": 12,
    "total_clicks": 345,
    "clicks_today": 21,
    "daily": [{"date": "2026-09-22", "clicks": 0}, {"date": "2026-10-05", "clicks": 18}],
    "top_links": [{"code": "SB", "url": "https://example.com", "clicks": 120}]
}
```

`daily` 为近 14 天（UTC 日切）全站点击，缺失日期补零。

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
GET /api/admin/links/{code}/stats
```

```json
{
    "code": "SB",
    "url": "https://example.com",
    "total_clicks": 120,
    "clicks_today": 9,
    "visitors": 87,
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
    "password_source": "env"
}
```

`password_source`：`env` = 沿用环境变量配置（含默认密码）；`custom` = 已在后台修改过密码。

```http
PUT /api/admin/settings
Content-Type: application/json

{"code_min_length": 4, "code_random": true, "require_login": false}
```

三个键均可省略（保持原值）。规则：

- `code_min_length`：1-16 的整数，否则 400；新短码不足该长度时自动补齐；
- `code_random`：布尔。开启后新短码随机生成（要求有效长度 ≥ 3，否则 400，落库前查重）；
- `require_login`：布尔。开启后 `POST /url`、`POST /api/url` 需登录，未登录返回 401。

成功（200）返回保存后的设置视图。设置持久化于 SQLite，即时生效，无需重启。

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
