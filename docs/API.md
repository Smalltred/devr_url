# API 文档

所有接口与原 Node.js 版（server.js）行为保持兼容。响应体均为 `application/json; charset=utf-8`。

## 创建短链接

```http
POST /url
Content-Type: application/json

{
    "url": "https://example.com"
}
```

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

- 静态资源（`/`、`/favicon.ico`、`/static/*` 等）由 Nginx 直接返回 React 页面，不进入 PHP。

## 状态码约定

| 状态码 | 场景 |
| --- | --- |
| 200 | 创建成功 |
| 302 | 短链跳转 |
| 400 | 请求参数错误（URL 非法 / 缺字段 / 非法 JSON） |
| 404 | 短码不存在 |
| 405 | HTTP 方法不允许（带 Allow 头） |
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

React 前端调用 `POST /url`（见 `src/services/entity.js`），API 地址由构建时环境变量
`REACT_APP_API_BASE_URL` 决定，留空为同源（推荐，配合 Nginx 反代），不会硬编码域名。
