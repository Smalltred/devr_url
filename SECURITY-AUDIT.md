# Short URL 安全审计报告（第二轮 · Node.js 后端）

## 1. 审计摘要

**审计时间**：2026-10-24

**项目版本**：devr v0.3.0（Git `3eb6e7e`，工作区含本次修复未提交）

**技术栈（据源码核实）**：

```text
前端  Vue 3 + Vite（apple-frontend/，构建产物 dist/）
后端  Node.js 24（backend/src，ESM，零框架手写 HTTP 层）
      唯一生产依赖：bcryptjs（密码哈希）
数据库  SQLite（Node 24 内置 node:sqlite / DatabaseSync，WAL）
缓存  Memcached 文本协议（零依赖自研客户端，可降级 NullStore）
部署  docker-compose（nginx + node + memcached）/ 单容器（nginx+node+memcached+supervisor）
      / 宝塔（Nginx 反代 127.0.0.1:3001）
定时  进程内每日外链巡检 cron（无需外部定时器）
```

> 本轮审计对象是**已迁移到 Node.js 的当前代码库**。2026-10-06 的第一轮审计针对 PHP 版后端，其修复成果（CSRF 守卫、限流、体积上限、安全响应头、静态服务防穿越等）已随迁移保留，本轮逐项复核通过（见 §5）。第一轮报告已整体归档，被本文替换。

**审计范围**：

- 后端全部源码 `backend/src/`（http / services / db / cache / support / cron / server / config）
- 前端 `apple-frontend/src/`（组件、API 客户端、入口判定）与构建配置
- 部署：`Dockerfile`、`docker-compose.yml`、`deploy/nginx/*.conf`、`deploy/baota/*`、`supervisord.conf`、`baota-package.zip` 交付物
- 配置与依赖：`.env.example`、根与 backend 的 `package.json`、两份 lock 文件
- 数据与日志：SQLite 结构与增量迁移、`storage/logs`
- 既有测试套件（97 项）与新增回归测试（12 项）

**审计方法**：通读源码建立攻击面 → 代码级可疑点定位 → 本地隔离环境（独立端口 3021/3022 + 独立测试库 + 项目自带 mock-memcached）实际渗透验证 → 修复 → 回归测试固化 → 修复后重放攻击确认失效。所有 High / Low 结论均有真实 HTTP 请求证据。

**总体结论**：

```text
Critical: 0
High:     1（SEC-N01，已修复并复测失效）
Low:      2（SEC-N02 / SEC-N03，已修复）
Info:     4（按文档化取舍接受，见 §4）
Potential:1（SEC-N08，部署边界，文档化）
```

**生产环境建议**：**可以上线（Ready）**。上线必做三件事：改默认密码、设置 `IP_HASH_SECRET`、确认 `APP_DEBUG=false`；使用 memcached 的部署务必包含本轮修复。

---

## 2. 风险总览

| ID | 漏洞名称 | 严重程度 | 位置 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| SEC-N01 | Memcached 文本协议注入 → 任意短码缓存投毒（劫持 / 404 DoS / 凭空造码） | High | `cache/memcachedStore.js` + `cache/cachedUrlRepository.js` + `GET /{code}` | Fixed | T-01~T-04 |
| SEC-N02 | X-Forwarded-For 取首项，受信位置可伪造限流键 | Low | `support/clientIp.js` | Fixed | T-05~T-10 |
| SEC-N03 | 外链探测 IPv6 转换前缀（6to4/Teredo/NAT64/IPv4 兼容）可编码内网目标 | Low | `services/httpLinkProbe.js` | Fixed | T-11~T-12 |
| SEC-N04 | `/healthz` 无鉴权返回短链总数 | Info | `http/app.js` | Accepted | T-13 |
| SEC-N05 | `creator_ip` 存原始 IP、`creator_ua` 存 500 字符 UA | Info | `db/urlRepository.js` | Accepted | 代码复核 |
| SEC-N06 | 默认口令 `admin/admin123` | Info | `config.js` | Accepted（有缓解） | 代码复核 |
| SEC-N07 | 巡检不拦 `198.18.0.0/15` | Info | `services/httpLinkProbe.js` | Accepted（设计取舍） | 代码注释 |
| SEC-N08 | 受信位置（私网/回环）可完全伪造代理头 | Potential | `support/clientIp.js` | 文档化 | T-09 |

## 3. 攻击面清单（据源码实际路由整理）

| 模块 | Endpoint | 方法 | 认证 | 输入来源 | 主要风险 | 实测 |
| --- | --- | --- | --- | --- | --- | --- |
| 创建短链 | `/url`（旧接口，永久保留） | POST | 视 `guest_access_enabled` | JSON body | 输入验证、限流 | 同源 200 / 跨站 403 |
| 创建别名 | `/api/url` | POST | 同上 | JSON body | 同上 | 同上 |
| 开放 API | `/api/open/shorten` | POST | API Key（Bearer / X-API-Key） | 头 + JSON | 鉴权、滥用 | 无 Key 401 |
| 登录 | `/api/auth/login` | POST | 否 | JSON | 暴力破解、节流 | 错误 401，5 次后 429 |
| 登出 | `/api/auth/logout` | POST | 否（幂等） | Cookie | — | 200 |
| 会话查询 | `/api/auth/me` | GET | 否 | — | 入口信息泄露 | 仅暴露「是否自定义入口」 |
| 概览 | `/api/admin/overview` | GET | 管理员 | query `period` | 越权 | 未登录 401 |
| 短链列表 | `/api/admin/links` | GET | 管理员 | `page/per_page/q/health` | SQL 注入、越权 | 未登录 401 |
| 触发巡检 | `/api/admin/links/scan` | POST | 管理员 | JSON `limit` | SSRF（经短链目标） | 未登录 401 |
| 失效清理 ×3 | `/api/admin/links/cleanup-{invalid,broken,dead}` | POST | 管理员 | — | 破坏性操作越权 | 未登录 401 |
| 编辑短链 | `/api/admin/links/{code}` | PUT | 管理员 | 路径 + JSON | 越权、短码注入 | 未登录 401 |
| 删除短链 | `/api/admin/links/{code}` | DELETE | 管理员 | 路径 | 越权 | 未登录 401 |
| 单链统计 | `/api/admin/links/{code}/stats` | GET | 管理员 | 路径 + `period` | 越权、隐私 | 未登录 401 |
| 读设置 | `/api/admin/settings` | GET | 管理员 | — | 哈希泄露 | 未登录 401 |
| 改设置 | `/api/admin/settings` | PUT | 管理员 | JSON 白名单键 | 越权改配置 | 未登录 401 |
| 改密码 | `/api/admin/settings/password` | POST | 管理员 | JSON | 会话撤销 | 未登录 401 |
| Key 列表 | `/api/admin/keys` | GET | 管理员 | — | 明文泄露 | 未登录 401 |
| 建/重置/删 Key | `/api/admin/keys[/{id}[/reset]]` | POST/DELETE | 管理员 | 路径 + JSON | 越权 | 未登录 401 |
| 健康检查 | `/healthz` | GET | 否 | — | 信息泄露（总数） | 200 `{"ok":true,"links":N}` |
| 短码跳转 | `/{code}` | GET | 否 | 路径（任意字节） | 开放重定向、**缓存注入** | 302 / 404 |
| 后台入口 | `settings.admin_path()`（默认 /admin） | GET/HEAD | 页面公开，数据靠 API | 设置 | 入口枚举 | 自定义后 /admin 404 |
| 静态资源 | `/*.{js,css,…}` | GET | 否 | 路径 | 路径穿越 | 穿越 404 |

**中间件顺序**（`http/app.js`）：请求体上限 413 → CSRF 403 → 静态 → 后台入口判定 → 路由（含鉴权守卫）→ 安全响应头。异常统一 `renderError`（4xx 记 info / 5xx 记 error，仅 `APP_DEBUG=true` 回显真实消息）。

---

## 4. 漏洞详情

### SEC-N01：Memcached 文本协议注入 → 任意短码缓存投毒（High）

**风险等级**：High

**CVSS**：3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H` = **8.1**（短链服务的核心价值就是跳转完整性，被劫持即域名信誉被用于钓鱼；向量说明：网络可达 / 低复杂度 / 无需权限 / 无交互，完整性高影响 + 可用性高影响）

**受影响文件**：

```text
backend/src/cache/memcachedStore.js:49,68,88   （命令拼接，修复前 #key() 无任何校验）
backend/src/cache/cachedUrlRepository.js:38    （缓存键 = "url:" + 短码）
backend/src/http/server.js:53                  （decodeURIComponent 后的完整路径进入路由）
backend/src/http/app.js:276-297                （GET /{code} 用未校验的路径段直接查缓存）
```

**漏洞成因**：`GET /{code}` 把 `decodeURIComponent` 之后的路径段原样作为短码，`CachedUrlRepository.findByCode` 直接拼接进缓存键，`MemcachedStore` 再把键拼进文本协议命令行。请求路径中经百分号编码的 CRLF / 空格 / NUL 解码后成为协议控制字符——**未认证攻击者可在一次 GET 请求中向 memcached 注入完整的 `set` 命令**。

**攻击前提**：`CACHE_DRIVER=memcached`（**默认值**）且 memcached 可达——docker-compose 与单容器 runtime 默认内置 memcached；`CACHE_DRIVER=none` 或无 memcached 的裸机部署（自动降级 NullStore）不受影响。

**攻击路径**：

```text
攻击者（任意网络位置，无需认证）
 ↓ GET /%0d%0Aset%20devr%3Aurl%3A<S>%200%20300%2019%0d%0A<evil>%0d%0A
 ↓ server.js decodeURIComponent → 路径含 CRLF
 ↓ 路由 {code}（[^/]+ 匹配任意非斜杠字节）
 ↓ CachedUrlRepository.findByCode("…")
 ↓ MemcachedStore 发送 "get devr:url:" + 注入串
 ↓ memcached 顺序执行：get（END）+ set（STORED，投毒完成）
 ↓ 客户端因多命令响应无完成标记而超时降级（30s 冷却）
 ↓ 冷却结束后：所有访客的 GET /<S> 命中投毒值
```

**实际验证步骤**（隔离环境 127.0.0.1:3021 + 项目自带 mock-memcached；注入值用 `\\` 代替 `/` 规避路由的单段约束——浏览器按 WHATWG 规范把 `\` 归一化为 `/`，效果等同）：

```http
GET /%0d%0Aset%20devr%3Aurl%3AS%200%20300%2019%0d%0Ahttps%3A%5C%5Cevil.example HTTP/1.1
Host: target
```

**实际结果（修复前，三个原语全部得手）**：

```text
原语 A 劫持既有短码：
  基线      GET /S -> 302 Location: https://example.com/legit-target
  注入+31s  GET /S -> 302 Location: https:\\evil.example    ← 已劫持

原语 B 任意短码 404 拒绝服务（写入负缓存标记 \0__devr_miss__，TTL 上限 30 天）：
  注入+31s  GET /S（数据库中真实存在）-> 404 {"error":"Unknown URL"}

原语 C 凭空制造短码（在受害者域名上铸造任意钓鱼链接）：
  注入+31s  GET /T（数据库中不存在）-> 302 Location: https:\\attacker.test
```

**预期结果**：注入请求 404；既有短码跳转不受影响；不存在的码持续 404。

**影响范围**：

- 完整性：**高**。任意既有短码可被改指向攻击者站点（域内钓鱼）；可凭空铸造任意路径的跳转链接。
- 可用性：**高**。任意短码可被打成 404（负缓存标记 TTL 上限 30 天）。
- 机密性：低。注入第二条 `get` 可读取其它缓存条目并经 302 Location 回显（本应用缓存值仅为公开 URL；若 memcached 与其它应用共享实例，存在跨应用读取面）。

**修复建议**（已实施，双层防护）：

1. `CachedUrlRepository.findByCode`：短码不匹配 `^[0-9A-Za-z]{1,64}$` 时完全跳过缓存（不读不写，直查数据库）——用户路径的任意字节从入口就进不了缓存键；
2. `MemcachedStore`：新增 `isSafeKey()`（可见 ASCII、无空白与控制字符、≤250 字节），`get/set/delete` 入口强制校验，不安全键直接判 miss / 拒绝写入且**不发起任何网络命令**——即便未来出现新的调用方，存储层自身也注入免疫。

**修复状态**：**Fixed**。修复后重放三类攻击全部失效（既有短码始终 302 原地址、/Z 持续 404，见 SECURITY-TEST-REPORT.md T-14）。回归测试 `backend/tests/cache-security.test.js` 固化 4 个用例，其中端到端用例注入三类载荷后断言「缓存层从未收到任何含空白/控制字符的键」。

---

### SEC-N02：X-Forwarded-For 取首项导致限流键可伪造（Low）

**风险等级**：Low（利用前提是攻击者处于受信代理位置，或部署链未按随附配置；随附三份 Nginx 配置均强制 `proxy_set_header X-Real-IP $remote_addr`，而后端优先取 X-Real-IP——**默认部署实际不可利用**，故定 Low 而非 Medium）

**受影响文件**：`backend/src/support/clientIp.js:62-70`（修复前）

**成因**：`resolveClientIp` 在 X-Real-IP 缺失时回退解析 XFF 并取**第一个**有效条目。XFF 的追加语义（nginx `$proxy_add_x_forwarded_for`）决定最左条目由客户端控制、最右条目由最近受信代理追加——取首项即信任了可伪造部分。

**实际验证**（修复前，直连 loopback = 受信位置）：

```text
X-Real-IP: 203.0.113.7                 → 被采纳（creator_ip 记为伪造值）
X-Forwarded-For: 203.0.113.77, 10.0.0.1 → 取首项 203.0.113.77（客户端可伪造部分）
```

受信位置上轮换伪造 IP 即可绕过登录节流（15 分钟 5 次）与创建限流（60 次/分钟）。

**影响**：位于私网/容器网/代理后的攻击者可绕过两项限流；公网直连不受影响（socket 地址非私网 → 不信任任何代理头）。限流键同时影响「创建者真实 IP」记录的准确性。

**修复**：XFF 改为**从右往左**取第一个有效条目（最近受信代理追加的最可信）；X-Real-IP 优先级不变。修复后 `"9.9.9.9, 203.0.113.10"` → `203.0.113.10`。

**修复状态**：**Fixed**（回归测试 6 个解析方向用例，T-05~T-10）。

---

### SEC-N03：外链探测的 IPv6 内网绕过前缀（Low）

**风险等级**：Low（需服务器具备 6to4/Teredo/NAT64 路由才可达内网，现代默认内核多不启用；探测结果仅管理员可见，属盲打）

**受影响文件**：`backend/src/services/httpLinkProbe.js` `#isPrivateV6`（修复前）

**成因**：外链巡检是**服务端主动请求用户提交 URL** 的功能（SSRF 面真实存在）：游客可创建指向恶意目标的短链，每日 cron 会代替服务器发起请求。既有 IPv6 私有判定未覆盖可编码 IPv4 目标的转换前缀：

| 前缀 | 用途 | 可编码的内网目标示例 |
| --- | --- | --- |
| `2002::/16` | 6to4 | `2002:7f00:1::` ≡ 127.0.0.1 |
| `2001:0::/32` | Teredo | 隧道封装任意地址 |
| `64:ff9b::/96` | NAT64 众所周知前缀 | `64:ff9b::7f00:1` ≡ 127.0.0.1 |
| `64:ff9b:1::/48` | NAT64 本地用 | 同上 |
| `::/96`（非 ffff 映射） | IPv4 兼容地址 | `::10.0.0.1`、`::a00:1`（≡10.0.0.1） |

**影响**：在具备对应路由的主机上，可借巡检对内网做盲探测。

**修复**：`#isPrivateV6` 补充上述前缀一律拒绝；`::ffff:8.8.8.8` 这类公网映射形式与公网原生 IPv6 不受影响。既有防护复核有效：http/https 白名单、DNS 解析后逐 IP 校验、自定义 lookup 固定 IP（防 DNS 重绑定 TOCTOU）、重定向手工逐跳重校验、只读响应头（HEAD / GET+Range）不下载正文、连接与总超时。

**修复状态**：**Fixed**（单元测试覆盖 13 个应拒 + 4 个应放行地址，T-11~T-12）。

---

## 5. 信息项与接受的风险（非漏洞，如实记录）

| ID | 事项 | 判定 | 依据 |
| --- | --- | --- | --- |
| SEC-N04 | `/healthz` 无鉴权返回短链总数 | Accepted（Info） | `{"ok":true,"links":N}` 是 MIGRATION.md / BAOTA_DEPLOY.md 写明的探活契约；总数不构成敏感信息，删除会破坏已文档化 API |
| SEC-N05 | `short_urls.creator_ip` 存原始 IP、`creator_ua` 存 500 字符 UA | Accepted（Info） | 功能设计（后台展示创建者信息），commit 60b69d6 已文档化；仅管理端 API 可见，不进跳转缓存、不随公开接口暴露。建议运营方自行评估留存期限 |
| SEC-N06 | 默认口令 `admin/admin123` | Accepted（有缓解） | 与第一轮一致的既定默认；docker-compose 支持 `.env` 注入 `ADMIN_PASSWORD[_HASH]`，README/部署文档均标注「生产必须修改」，后台设置页有 `password_source` 提示 |
| SEC-N07 | 巡检不拦 `198.18.0.0/15` | Accepted（设计取舍） | 源码注释明确说明：该段是常见代理/VPN fake-IP 网段，大量真实站点被解析到这里，拦截会造成误判 |
| SEC-N08 | 受信位置（私网/回环）可完全伪造代理头 | Potential（部署边界） | `trustProxy` 只在直接对端为私网/回环时读取代理头——「私网即可信」的明示边界。公网直连不受影响；随附 nginx 强制覆盖 X-Real-IP。部署方应保证 3001 端口不对公网开放（compose 未发布该端口；SEC-N02 修复后即使伪造也只能影响 XFF 回退路径） |

---

## 6. 复核通过的安全控制（第一轮修复随迁移保留）

以下各项本轮经代码复核 + 实测（`verify-core.mjs`，53 项断言全过）确认有效：

| 控制项 | 实测结果 |
| --- | --- |
| 14 个管理接口未登录访问 | 全部 401（含 scan / cleanup×3） |
| 伪造 Cookie（64 位随机串） | 401 |
| CSRF：跨站 Origin / 无来源 / 跨站 Referer / text/plain 简单表单 | 全部 403 |
| CSRF：同源请求 | 200 |
| CSRF：API Key 头豁免（跨站 Origin + 有效 Bearer） | 200（设计行为：跨站表单无法设置自定义头，跨域自定义头必触发未获准的预检） |
| 请求体上限 16KB（传输层即丢弃超限字节） | 413 |
| URL 上限 2048 字节（归一化前后双检） | 413 |
| `javascript:` / `data:` / `file:` / 协议相对 / 含空白 URL | 全部 400 |
| URL 含原始 CR/LF | 拒绝；编码 `%0d%0a` 按字面存储，Location 无注入 |
| 静态服务路径穿越（`/../.env`、`/%2e%2e/...`、源码、SQLite） | 全部不泄露（realpath 归属校验） |
| 登录失败节流 | 5 次 → 429 |
| 改密后全部会话失效（两设备实测） | 均转未认证 |
| Cookie `HttpOnly` + `SameSite=Strict`（HTTPS 时附 `Secure`） | 通过 |
| API Key：明文仅创建/重置返回一次；列表只含前缀；重置/删除后旧 Key 立即 401 | 通过 |
| 安全响应头（CSP/XFO/nosniff/Referrer-Policy/Permissions-Policy；HSTS 仅 HTTPS） | 通过 |
| SSRF：IPv4 私网/环回/链路本地/保留段拒绝 + DNS pinning + 重定向逐跳校验 | 通过（IPv6 补齐见 SEC-N03） |
| 创建限流 60 次/分钟 | 实测到阈值 429 |
| SQL 全参数化（含搜索 LIKE 转义、健康状态白名单过滤） | 代码复核无拼接 |
| 前端无 `v-html`/`innerHTML`；localStorage 仅存主题 | 复核通过 |
| `npm audit`（根 + backend，含 dev） | 0 漏洞 |
| `baota-package.zip` 交付物 | 不含真实 `.env`、数据库、`.git`、node_modules |

**Not Applicable（不存在该攻击面）**：

| 检查项 | 依据 |
| --- | --- |
| 命令注入 / 原型污染 | 全库无 `eval` / `new Function` / `child_process` / 动态 `require`；用户输入不参与 `Object.assign`/深合并（`updateSettings` 仅白名单键逐项读取） |
| 不安全反序列化 | 仅 `JSON.parse`，失败返回 null |
| 生产 Source Map | 构建未开启，dist 无 `.map` 文件 |
| IDOR | 单管理员模型，管理接口作用于全站资源，无按用户划分的归属 |
| `check.php` 自检页（第一轮 Medium） | 已随 Node 迁移移除，改为 `/healthz` |
| JWT 算法/过期问题 | 项目不使用 JWT（随机 token + 库存 sha256），不适用 |

---

## 7. 依赖与供应链

| 检查 | 结果 |
| --- | --- |
| 后端运行时依赖 | **仅 `bcryptjs@2.4.3`**（纯 JS，无原生编译、无安装脚本） |
| `npm audit`（backend，含 dev） | 0 漏洞 |
| `npm audit`（根，`--omit=dev`） | 0 漏洞 |
| 根 devDependencies | tailwind 构建链（第一轮已判定其告警产物零命中、不修复） |
| Node 运行时 | 24（`engines: >=24.0.0`，当前 LTS 线） |
| 供应链 | 两份 lock 文件齐全；Dockerfile 用 `npm ci --omit=dev`；镜像无密钥硬编码；storage 目录预建并归属 `node` 用户 |

---

## 8. 未覆盖的测试范围（如实标注）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实 memcached（非 mock）注入复现 | 未执行（mock 等价验证） | 本机无 memcached 服务；mock 实现同一文本协议，注入语义一致；且防护在客户端拼接层，与服务端实现无关 |
| Docker 镜像构建与容器内运行 | 未执行 | 本机无 Docker；compose / Dockerfile 为静态审阅 |
| Nginx 实际生效验证 | 未执行 | 本机无 Nginx；三份配置为静态审阅（均含敏感路径拒绝与 X-Real-IP 覆盖） |
| IPv6 真实链路 / NAT64 路由 | 未执行 | 本机无对应路由环境；以前缀判定单元测试覆盖 |
| 大规模压力测试 | 有意未做 | 审计规则禁止不可控压测；并发正确性以既有套件（109 项）+ 限流实测为准 |

## 9. 历史轮次说明

- **第一轮（2026-10-06，PHP 8.2 后端）**：确认 2 High / 5 Medium / 4 Low（本地开发服务器路径穿越、客户端 IP 丢失等），全部修复。其报告原名与本文件相同，已被本轮内容整体替换；PHP 版结论不适用于当前 Node 代码库。
- **本轮（2026-10-24，Node.js 后端）**：第一轮修复随迁移保留并复核通过；新确认 1 High（memcached 注入，随缓存层引入）/ 2 Low，全部修复。
