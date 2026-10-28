# Short URL 安全测试报告（第二轮 · Node.js 后端）

对应审计：[SECURITY-AUDIT.md](SECURITY-AUDIT.md)　修复：[SECURITY-FIXES.md](SECURITY-FIXES.md)

---

## 1. 测试环境与版本

| 项 | 值 |
| --- | --- |
| 操作系统 | Windows 10 (10.0.26300) x64，Git Bash |
| Node | v24.18.0（npm 11.16.0） |
| 被测服务 | `backend/src/server.js`（与生产同一条入口链路） |
| 端口 | 修复前 3021 / 修复后 3022（独立端口，**未占用开发用 3001**） |
| 测试数据库 | `artifacts/security-audit-2026-10-24/{test,fixtest/test}.sqlite3`（**独立临时库，未触碰 `backend/storage/short-url.sqlite3`**；审计结束后已删除，脚本与日志保留在同一 `artifacts/` 目录） |
| 缓存 | 项目自带 `backend/tools/mock-memcached.js`（11221 / 11222，实现 memcached 文本协议） |
| 服务环境变量 | `APP_ENV=production`、`APP_DEBUG=false`、`ADMIN_PASSWORD=secret123`、`CACHE_DRIVER=memcached`、`IP_HASH_SECRET=audit-secret` |
| 攻击工具 | 自写 Node 脚本（`node:http` / 原始 socket，完全控制请求行编码，`--path-as-is` 语义） |
| 测试框架 | `node --test`（backend 既有套件） |

**边界遵守**：全部测试针对本机隔离实例；未对第三方发起攻击；未执行压力测试；真实数据库与生产配置未被修改（全程 `git status` 复核，仅新增/修改审计相关源码与文档）。

---

## 2. 测试命令

```bash
cd backend
npm test                              # 既有 + 新增回归套件
node --test tests/cache-security.test.js   # 仅本轮新增
npm audit                              # 依赖审计
cd .. && npm audit --omit=dev          # 前端生产依赖审计
```

攻击与验证脚本（过程产物，未入仓库）：`attack-cache.mjs`、`verify-core.mjs`、`replay-attacks.mjs`。

---

## 3. 测试用例与结果

### 3.1 SEC-N01 缓存投毒（修复前确认 / 修复后失效）

| 编号 | 用例 | 输入 | 实际结果（修复前） | 预期 | 复现 |
| --- | --- | --- | --- | --- | --- |
| T-01 | 原语 A：劫持既有短码 | `GET /%0d%0Aset%20devr%3Aurl%3AS%200%20300%2019%0d%0Ahttps%3A%5C%5Cevil.example`（注入+31s 后访问 `/S`） | **302 `Location: https:\\evil.example`**（原为 `https://example.com/legit-target`） | 始终 302 原地址 | **是** |
| T-02 | 原语 B：404 DoS | 同上，值换 `\0__devr_miss__`（14 字节）、TTL 86400 | **404 `{"error":"Unknown URL"}`**（数据库中该码真实存在） | 302 原地址 | **是** |
| T-03 | 原语 C：凭空造码 | 注入 `devr:url:T`，访问 `/T` | **302 `Location: https:\\attacker.test`**（数据库中不存在 T） | 404 | **是** |
| T-04 | 协议级确认 | 直连 memcached 发送注入命令 | `devr:url:S` 值被改写（`VALUE devr:url:S 0 21 ... https://evil.example/`） | — | **是** |
| T-14 | **修复后重放 T-01~T-03 全部三类载荷**（端口 3022） | 同上三载荷 + 31s 冷却 + 3 次访问 | `/S` 三次均 **302 原地址**；`/Z` 持续 **404** | 同左 | **否（已失效）** |

> 攻击细节：注入值用 `\` 代替 `/` 规避路由的单段约束——浏览器按 WHATWG 规范将 `\` 归一化为 `/`，跳转效果等同。注入后客户端因多命令响应无完成标记进入 30s 降级冷却，**投毒在冷却期内已写入**，冷却结束后对全部访客生效——这正是 T-01~T-03 需等待 31s 再断言的原因。

### 3.2 SEC-N02 / SEC-N03 修复验证（新增回归套件 `tests/cache-security.test.js`，12/12 通过）

| 编号 | 用例 | 断言 | 结果 |
| --- | --- | --- | --- |
| T-05 | XFF 取最右侧 | `"1.2.3.4, 5.6.7.8"` → `5.6.7.8` | PASS |
| T-06 | 客户端伪造首项不再被采纳 | `"9.9.9.9, 203.0.113.10"` → `203.0.113.10` | PASS |
| T-07 | X-Real-IP 优先于 XFF | 优先返回 X-Real-IP | PASS |
| T-08 | 非受信来源用 socket 地址 | 公网对端的伪造头被忽略 | PASS |
| T-09 | XFF 全非法时回落 socket 地址 | `garbage, , !!!` → socket 地址 | PASS |
| T-10 | `trustProxy=false` 不读代理头 | 返回 socket 地址 | PASS |
| T-11 | IPv6 应拒前缀（13 个） | `2002:7f00:1::`、`2001:0:…`、`64:ff9b::7f00:1`、`::127.0.0.1`、`::10.0.0.1`、`::a00:1`、`::ffff:127.0.0.1` 等 | PASS |
| T-12 | 公网 IPv6 不误伤（4 个） | `2606:4700:4700::1111`、`2001:4860:4860::8888`、`::ffff:8.8.8.8` 等 | PASS |

### 3.3 SEC-N01 回归套件（同文件，4/4 通过）

| 编号 | 用例 | 断言 | 结果 |
| --- | --- | --- | --- |
| T-15 | `isSafeKey` 边界 | 合法键放行；空格/CR/LF/NUL/TAB/超长/非字符串拒绝 | PASS |
| T-16 | 不安全键不发网络命令 | `get` 判 miss、`set` 拒绝，且不触发降级冷却（证明连 socket 都未建立） | PASS |
| T-17 | 恶意短码不读不写缓存 | 5 类恶意码全部直查数据库；正常码仍走缓存；**缓存层收到的每个键都匹配 `^url:[0-9A-Za-z]{1,64}$`** | PASS |
| T-18 | 端到端注入失效 | 真实 HTTP 服务 + 记录型缓存：注入三类载荷后既有短链 302 原地址、缓存键零污染 | PASS |

### 3.4 常规安全验证（`verify-core.mjs`，53/55 通过，2 项为测试脚本自身预期错误，复核后确认行为正确）

| 编号 | 类别 | 结果 |
| --- | --- | --- |
| V-01~V-14 | 14 个管理接口未登录（含 scan / cleanup×3） | **全部 401** |
| V-15 | 伪造 Cookie（64 位随机串） | 401 |
| V-16~V-19 | CSRF：跨站 Origin / 无来源 / 跨站 Referer / text/plain 简单表单 | **全部 403** |
| V-20 | CSRF：同源创建 | 200 |
| V-21 | CSRF：API Key 头豁免（跨站 Origin + 有效 Bearer） | 200（设计行为） |
| V-22 | 4096 字节 URL | 413 |
| V-23 | 20KB 请求体 | 413 |
| V-24~V-28 | `javascript:` / `data:` / `file:` / 协议相对 / 含空白 URL | **全部 400** |
| V-29 | URL 含编码 `%0d%0a` | 200 存为字面字符；跳转响应**无注入头**（无 set-cookie）※1 |
| V-30 | URL 含原始 CR/LF | 400（既有套件另覆盖「库内脏数据时 500 而非注入头」） |
| V-31~V-35 | 静态穿越 `../.env`、`%2e%2e`、源码、SQLite、二次编码 | 全部不泄露 |
| V-36 | `/healthz` | 200 `{"ok":true,"links":N}`（Info，文档化契约） |
| V-37~V-46 | 登录/会话：错误密码 401；Cookie HttpOnly+SameSite=Strict；token 64 位十六进制；**改密后两设备会话均失效**；新密码可登录 | 全部通过 |
| V-47~V-54 | API Key：明文单次返回；列表无明文；无 Key 401※2；错 Key 401；**重置/删除后旧 Key 立即 401** | 全部通过 |
| V-55~V-57 | 代理头：X-Real-IP 采纳、XFF 首项采纳（修复前行为，即 SEC-N02 证据） | 记录为发现 |
| V-58 | 创建限流 | 阈值后 429 |

※1 初次判 FAIL 系脚本预期写严（要求 400）；复核确认编码 CRLF 按字面存储、无头部注入，行为安全。
※2 初次判 FAIL 系脚本未带 Origin 被 CSRF 403 先挡；带同源 Origin 复测为 401，行为正确。

### 3.5 自动化套件

| 命令 | 结果 |
| --- | --- |
| `npm test`（backend，修复后） | **tests 109 / suites 23 / pass 109 / fail 0**（第一轮基线 97 + 本轮新增 12） |
| `npm audit`（backend） | 0 vulnerabilities |
| `npm audit --omit=dev`（根） | 0 vulnerabilities |

---

## 4. 回归测试清单（本轮新增固化）

`backend/tests/cache-security.test.js`：

| 覆盖点 | 用例 |
| --- | --- |
| `MemcachedStore.isSafeKey` 边界（空格/CR/LF/NUL/TAB/超长/非字符串/合法键） | T-15 |
| 不安全键不发起网络命令（get 判 miss / set 拒绝 / 不触发降级） | T-16 |
| 恶意短码绕过缓存直查库；缓存键形态全量断言 | T-17 |
| 端到端：三类注入载荷 + 既有短链不受影响 + 缓存零污染 | T-18 |
| XFF 解析方向 ×6（右起取值 / 伪造免疫 / X-Real-IP 优先 / 公网直连 / 全非法 / trustProxy=false） | T-05~T-10 |
| IPv6 应拒前缀 ×13 / 公网不误伤 ×4 | T-11~T-12 |

---

## 5. 未执行项（如实标注，不得视为通过）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实 memcached 注入复现 | 未执行 | 本机无 memcached 服务；以同协议 mock 等价验证，防护点在客户端拼接层与服务端实现无关 |
| Docker 镜像构建 / 容器内运行 | 未执行 | 本机无 Docker |
| Nginx 实际生效验证 | 未执行 | 本机无 Nginx；三份配置静态审阅（均含敏感路径拒绝与 X-Real-IP 覆盖） |
| IPv6 真实链路 / NAT64 路由探测 | 未执行 | 本机无对应路由环境 |
| 浏览器实测 `\` 归一化跳转 | 未执行 | 依据 WHATWG URL 规范（浏览器统一把特殊 scheme 中的 `\` 当 `/`）；服务端已以 Location 头取证 |
| 压力测试 | 有意未做 | 审计规则禁止不可控压测 |

---

## 6. 结论

```text
==============================
Short URL Security Audit Summary（第二轮 · Node.js）
==============================

Confirmed Critical: 0
Confirmed High:     1   （SEC-N01 memcached 注入 → 缓存投毒）
Confirmed Medium:   0
Confirmed Low:      2   （SEC-N02 XFF 首项；SEC-N03 IPv6 前缀）
Informational:      4   （healthz 总数 / creator 隐私 / 默认口令 / 198.18.0.0/15）

Fixed:             3   （1 High + 2 Low，全部含回归测试）
Partially Fixed:   0
Unfixed:           0
Not Reproducible:  0
Not Tested:        真实 memcached / Docker / Nginx / IPv6 链路（见 §5）

Critical/High Blocking Issues:
  （无）

Security Regression Tests:
Passed:  backend 109/109（含新增 12）+ 攻击重放失效确认 + 常规验证 55 项复核
Failed:  0
Not Run: 见 §5 未执行项

Production Recommendation:
- Ready

Remaining Risks:
1. SEC-N08：私网/回环受信位置可伪造代理头（部署边界；保证 3001 不对公网开放即不受影响）
2. SEC-N05：创建者原始 IP/UA 长期留存（功能设计；建议运营方评估留存期限）
3. Docker / Nginx / 真实 memcached 环境未实测（静态审阅无发现，建议部署时按文档冒烟）
==============================
```

**上线检查单**：① 修改默认密码（或设 `ADMIN_PASSWORD_HASH`）；② 设置 `IP_HASH_SECRET`；③ 确认 `APP_DEBUG=false`、`APP_ENV=production`；④ 使用 memcached 的部署包含本轮修复（SEC-N01）；⑤ HTTPS 站点设 `APP_URL` 与 `HSTS_MAX_AGE`；⑥ Node 端口仅监听内网/由 Nginx 独占代理。
