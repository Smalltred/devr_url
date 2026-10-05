# Phase 1：原项目分析（Node.js → PHP 8.2 重构前）

> 分析对象：github.com/onee-io/short-url @ master（commit 7a1352f）
> 结论先行：原后端只有 `server.js` 一个文件（67 行），功能为「POST /url 创建短链」+「GET /:code 跳转」，
> 存储仅用 Redis 的两个 key。PHP 8.2 重构可以做到 **数据 100% 兼容、API 行为 100% 兼容、短码算法逐位一致**。

---

## 1. 当前项目架构分析

```text
React 18 (CRA5, 端口3000)          Node.js Express (server.js, 端口3001)        Redis 5+
┌──────────────────────┐   POST /url   ┌──────────────────────────┐   INCR      ┌──────────┐
│ Search.js 输入/校验    │ ────────────▶ │ 校验 → 自增ID → 编码 → 存Hash │ ──────────▶ │ code计数器│
│ entityReducer 调API   │ ◀──────────── │ {url, code}              │             │ map哈希   │
│ Entity.js 二维码/复制  │   GET /:code  │ 查Hash → 302 redirect     │ ◀────────── │          │
└──────────────────────┘ ────────────▶ └──────────────────────────┘   HGET      └──────────┘
```

- **前端**：`src/` 共 9 个组件/模块。二维码在浏览器端用 `qrcode` 生成（`src/reducers/entityReducer.js`），
  服务端不参与二维码生成。短链域名取 `window.location.origin`。
- **后端**：单文件 `server.js`，同时用 `express.static('build')` 托管前端构建产物（方式二/三部署）。
- **依赖分工**：`express / redis / dotenv / morgan` 仅服务端；`axios / qrcode / copy-to-clipboard / file-saver /
  @reduxjs/toolkit / react / react-dom` 仅前端；`tailwindcss`（devDep）前端样式。
- **部署**：fly.io + Docker（node:16-alpine 内 `npm run build` 后 `npm run server`）；GitHub Actions push master 自动部署。
  `Jenkinsfile` 仅有一个错误阶段（`sh 'node build'`），属于废弃残留。

## 2. 当前 API 分析

### POST /url（创建短链）

```text
请求:  Content-Type: application/json   body: {"url": "https://example.com"}
成功:  200  {"url": "<encodeURI 后的 url>", "code": "<短码>"}
失败:  400  {"error": "Incorrect URL format"}
```

处理链（server.js:51-60）：

1. `encodeURI(request.body.url)` —— **先编码再校验**。encodeURI 不转义 ASCII 字母数字及
   `;/?:@&=+$-_.!~*'()#`，空格转 `%20`，非 ASCII（中文）按 UTF-8 逐字节转 `%XX`，已有的 `%` 会被二次编码（%25）。
2. 正则 `/^((https|http)?:\/\/)[^\s]+/` 校验（编码后无空白即通过）。
3. `redis.incrBy('short-url:code', 1)` 取自增 ID。
4. `encode(id)` 生成短码；`redis.hSet('short-url:map', code, encodedUrl)` 存储。
5. 返回 `{url, code}`，HTTP 200。

细节：无鉴权、无限流、无 URL 去重（同一 URL 多次提交产生多个短码）、无黑名单。

### GET /:code（跳转）

```text
存在:  302  Location: <原链接>          （response.redirect 默认 302）
不存在: 404  {"error": "Unknown URL"}
```

- Express 静态中间件先接管 `/`、`/favicon.ico`、`/static/*` 等资源；其余单段路径进入 `/:code`。
- `/:code` 只匹配**单段路径**；多段路径（如 `/a/b`）不匹配任何路由，返回 Express 默认 404（HTML "Cannot GET"）。
- 任何非注册方法的请求同样落入 404（Express 无 405 处理）。

## 3. Redis 数据结构分析

| Key | 类型 | 用途 | 兼容要求 |
|---|---|---|---|
| `short-url:code` | STRING（计数器） | 自增 ID 源，`INCRBY 1` | 必须原样沿用 |
| `short-url:map` | HASH | field=短码 → value=原链接（encodeURI 后），无 TTL | 必须原样沿用 |

- 短码由 ID 经 62 进制编码得出，因此 `map` 的 field 与 `code` 计数器存在推导关系，**计数器不可重置/回拨**。
- 连接配置来自 `.env`：`REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD`（node-redis v4，socket 方式连接）。

## 4. 短码生成算法分析

```javascript
const _alphabet = 'GS2w4R6789IbcdHEXhijWZAzopTrxPNq3sLMJalBVyQeDmY0nugtF5Uv1fkOCK'; // 62 字符乱序
const encode = (id) => {
    let code = '';
    while (id > 0) {
        code = _alphabet.charAt(id % _base) + code;
        id = Math.floor(id / _base);
    }
    return code;
};
```

- 字母表 = 0-9 + A-Z + a-z 全集乱序（已核对无重复、无遗漏，长度 62）。
- `encode(0)` 返回空串；实际 INCR 从 1 开始，不会出现空码。
- **PHP 等价实现要点**：正整数下 `%` 与 `intdiv()` 与 JS `%` / `Math.floor()` 完全一致；
  字符串下标取字符 `ALPHABET[$i]` 等价 `charAt`。JS 安全整数上限 2^53-1，PHP int 为 64 位，
  在 ≤ 2^53-1 范围内逐位一致（Redis 计数器超出该范围属于原项目自身的 JS 精度问题，PHP 反而更正确）。
- 兼容验证方式：用原 JS 实现生成测试向量（ID=1,2,10,63,64,100,1000,999999…及大数），硬编码进 PHPUnit 断言。

## 5. PHP 重构方案

```text
Controller(UrlController)          只做 HTTP 进出与状态码
    ↓
Service(ShortUrlService)           业务编排：验证 → 取ID → 编码 → 落库
    ↓
Repository(UrlRepository 接口)      nextId / save / findByCode / exists
    ↓
RedisService(连接/认证/重连/异常)    phpredis 封装
    ↓
Redis（short-url:code / short-url:map，原样沿用）
```

- **框架**：纯 PHP 8.2 + Composer，零运行时第三方包（仅 `ext-redis / ext-json / ext-mbstring`），
  自实现轻量 Router / Request / Response / ExceptionHandler（满足"轻量、可维护"，避免 Laravel/Symfony 全家桶）。
- **异常体系**：`InvalidUrlException(400) / ShortCodeNotFoundException(404) / RedisConnectionException(503) /
  ConfigurationException(500)`，统一 ExceptionHandler 输出，生产环境隐藏细节。
- **HTTP 状态码**：200 / 302 / 400 / 404 / 405（新增）/ 500 / 503（新增）。
- **并发安全**：继续用 Redis `INCR` 作唯一 ID 源（原子操作），短码由 ID 推导 → 天然无重复、无覆盖。
- **验证层**：`UrlValidator` 重新设计（不机械复制正则）：类型检查、http/https、无空白字符、
  parse_url 主机/端口校验、非 ASCII 归一化（中文路径）、已编码 `%XX` 不二次编码（修复原 encodeURI 的 %25 缺陷）。
- **安全**：配置全部走环境变量（`.env` 不进 Git）；日志不含请求体/URL；生产环境 display_errors=0；
  异常不暴露路径；Redis 操作集中一处。
- **测试**：PHPUnit 单元（短码向量/校验器/仓库契约）+ Feature（Router→Controller 全链路，内存仓库替身）
  + Legacy 兼容测试（真实 Redis，`RUN_REDIS_COMPAT_TESTS=1` 时运行，隔离到独立 DB）。
- **静态检查**：PHPStan（level 8）+ PHP-CS-Fixer（PSR-12 + strict_types）。
- **前端**：保留全部 React 代码，仅 `src/services/entity.js` 改用 `REACT_APP_API_BASE_URL`（默认同源，
  不硬编码 3001）；`package.json` 移除仅服务端依赖（express/redis/dotenv/morgan）与 server/dev 脚本。

## 6. 目录结构方案

原任务书建议的根目录 `public/` 与 React CRA 的 `public/` 冲突，按任务书"实际代码结构有更合理的方案可调整"条款，
PHP 应用整体收进 `backend/` 子目录，职责划分不变：

```text
short-url/
├── backend/                       # PHP 8.2 应用（本次重构新增）
│   ├── app/
│   │   ├── Controllers/UrlController.php
│   │   ├── Services/{ShortUrlService, ShortCodeService, RedisService}.php
│   │   ├── Repositories/{UrlRepository(接口), RedisUrlRepository}.php
│   │   ├── Http/{Router, Request, Response, ExceptionHandler}.php
│   │   ├── Exceptions/{InvalidUrlException, ShortCodeNotFoundException,
│   │   │              RedisConnectionException, ConfigurationException}.php
│   │   ├── Foundation/App.php            # 组合根 + 全局异常出口
│   │   ├── Validation/UrlValidator.php
│   │   └── Support/{Config, Env, Logger, helpers}.php
│   ├── config/config.php          # 唯一读取环境变量的地方
│   ├── public/index.php           # 前端控制器（含 php -S 静态回退）
│   ├── routes/web.php             # POST /url、POST /api/url、GET /{code}
│   ├── storage/logs/              # app.log / error.log
│   ├── tests/{Unit, Feature, Compat, Doubles}
│   ├── tools/gen-code-vectors.js  # 用原 Node 代码生成短码兼容向量
│   ├── composer.json / phpunit.xml / phpstan.neon / .php-cs-fixer.dist.php
│   └── Dockerfile                 # php-fpm 镜像（compose 用）
├── src/ public/ tailwind.config.js # React 前端（原样保留）
├── Dockerfile                     # 多阶段：node 构建 React + nginx+php-fpm 单容器（fly.io）
├── docker-compose.yml             # nginx + php-fpm + redis 三容器
├── deploy/nginx/*.conf            # 通用(宝塔) / docker 单容器 / compose 三种配置
├── .env.example                   # PHP 后端 + React 前端变量
└── docs/{API, MIGRATION, REDIS_COMPATIBILITY, BAOTA_DEPLOY, PHASE1_ANALYSIS}.md
```

## 7. 兼容性方案

| 维度 | 策略 |
|---|---|
| Redis Key | `short-url:code` / `short-url:map` 名称、类型、语义原样沿用（经 `config('redis.keys.*')` 注入，默认即原值） |
| 短码算法 | 同一乱序字母表 + 同一进制编码；Node 生成向量 → PHPUnit 断言逐位一致 |
| POST /url | 请求/响应 JSON 结构不变（`{url, code}` / `{error}`），200/400 不变；新增 `POST /api/url` 为规范别名，**保留 `/url`** |
| GET /:code | 302 Location 跳转不变；不存在仍返回 404 `{"error":"Unknown URL"}`；400 文案保持 `Incorrect URL format` |
| 前端 | React 代码不动逻辑，仅 API base 改为可配置且默认同源；开发模式 CRA proxy 仍指向 3001（PHP `composer serve`） |
| 运行时共存 | PHP 与 Node 读写完全相同的 Redis 数据结构，可灰度切换（Nginx 按路由分流），随时可回滚到 Node 版本 |

## 8. 迁移风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | 短码不一致导致新短链错乱 | 向量表覆盖 1 → 2^53-1 关键值；Legacy 兼容测试用真实 Redis 跑「旧数据读 + 新数据写 + 回读」闭环 |
| 2 | 计数器回拨/重复 INCR 语义 | 仅使用 `INCR`，不引入随机码、不用 count 替代；禁止对 `short-url:code` 做写操作 |
| 3 | URL 校验差异拒绝原可用的 URL | 校验器放宽到与原等价（http/https + 非空 + 有 host），仅修复空白/二次编码两类缺陷并在 MIGRATION.md 声明 |
| 4 | 响应头注入（Location） | 校验阶段拒绝一切空白字符；PHP header() 对 CRLF 抛异常，ExceptionHandler 兜底 500 |
| 5 | PHP-FPM 下 Redis 每请求建连的性能损耗 | pconnect 长连接复用 + 2.5s 超时；GET 跳转路径不落日志、不加载无关类 |
| 6 | 环境差异（宝塔/Windows 开发机） | .env 双路径加载（backend/.env 与项目根 .env）；文档给出宝塔逐项配置 |
| 7 | 误删前端依赖 | 仅移除四个纯服务端依赖，React 构建通过 `npm run build` 实测验证 |
| 8 | 405/503 为新增行为 | 属任务书要求的规范化增强，不影响旧客户端（旧前端只遇 200/400/404/302） |

**结论**：迁移可行性确认，无阻断性风险。进入 Phase 2（搭建 PHP 8.2 基础结构）。
