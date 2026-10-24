# Short URL 安全修复记录（第二轮 · Node.js 后端）

对应审计：[SECURITY-AUDIT.md](SECURITY-AUDIT.md)　验证：[SECURITY-TEST-REPORT.md](SECURITY-TEST-REPORT.md)

本轮确认并修复 **1 High + 2 Low** 共 3 项；另 4 项 Info 与 1 项 Potential 按文档化取舍接受（见审计报告 §5）。
所有修复遵循：后端强制校验、不关闭功能、不弱化策略、保持 API 与存量数据兼容。

## 修复清单

| ID | 等级 | 修复文件 | 数据库变化 | 配置变化 | API 兼容性 |
| --- | --- | --- | --- | --- | --- |
| SEC-N01 | High | `backend/src/cache/cachedUrlRepository.js`、`backend/src/cache/memcachedStore.js` | 无 | 无 | 无（非法形态短码本就 404，行为不变） |
| SEC-N02 | Low | `backend/src/support/clientIp.js` | 无 | 无 | 无 |
| SEC-N03 | Low | `backend/src/services/httpLinkProbe.js` | 无 | 无 | 无（公网 IPv6 探测不受影响） |

---

## SEC-N01：Memcached 文本协议注入 → 任意短码缓存投毒（High）

**修复前的问题**

`GET /{code}` 的路径段经 `decodeURIComponent` 后可含任意字节（CRLF / 空格 / NUL 均可经百分号编码传入），被原样拼进缓存键：

```js
// memcachedStore.js（修复前）
async get(key) {
    const response = await this.#send(Buffer.from(`get ${this.#key(key)}\r\n`, 'utf8'))
    ...
}
#key(key) { return KEY_PREFIX + key }   // 无任何校验
```

一次未认证 GET 即可注入完整 `set` 命令，实现：劫持任意既有短码（302 到攻击者站点）、把任意短码打成 404（最长 30 天）、在受害者域名凭空铸造钓鱼短码。实测三个原语全部得手（证据见测试报告 T-01~T-04）。

**关键代码变化**

第一层（入口门禁）——`cachedUrlRepository.js`：

```js
// 允许进入缓存键的短码形态（与管理端短码规则一致，留少量余量）
const CACHEABLE_CODE = /^[0-9A-Za-z]{1,64}$/

async findByCode(code) {
    if (!code) return null
    if (!CACHEABLE_CODE.test(code)) {
        // 非法形态的“短码”只可能是扫描/攻击流量：直查数据库，不读也不写缓存
        return this.inner.findByCode(code)
    }
    ...
}
```

第二层（存储层自免疫）——`memcachedStore.js`：

```js
// 可见 ASCII 且不含空格/控制字符，长度 ≤ 250（memcached 键上限）。
// 空格会把 get 变多键命令、CRLF 会注入新命令——含这些字节的键一律拒绝。
const SAFE_KEY = /^[\x21-\x7e]{1,250}$/

static isSafeKey(key) {
    return typeof key === 'string' && SAFE_KEY.test(key)
}

async get(key) {
    if (!this.#usable()) return null
    if (!MemcachedStore.isSafeKey(this.#key(key))) {
        this.logger.error('memcached rejected unsafe key', { operation: 'get', key: ... })
        return null            // 判 miss，不发起任何网络命令
    }
    ...
}
// set 同样拒绝（返回 false）；delete 同样拒绝（返回 true = 幂等成功）
```

**修复原理**：两层独立成立——第一层保证用户可控的路径字节从业务入口就进不了缓存键；第二层保证即便未来出现新的调用方把脏数据传给存储层，命令行也绝不可能被注入。任一层被绕过时另一层仍然阻断。

**回归验证**：修复后重放三类攻击载荷全部失效（T-14）；`tests/cache-security.test.js` 4 个用例，其中端到端用例直接断言「缓存层从未收到任何含空白/控制字符的键」。

**数据库迁移**：无（不涉及表结构）。

**配置变化**：无。`CACHE_DRIVER=none` / NullStore 部署行为不变。

**可能的副作用与回滚**：非法形态短码此前也查不到（404），现在只是不再往返缓存——对正常流量零影响。回滚即还原两个文件的这两处校验。

---

## SEC-N02：X-Forwarded-For 取首项（Low）

**修复前的问题**

```js
// clientIp.js（修复前）：取 XFF 第一个有效条目
for (const part of forwarded.split(',')) {
    const candidate = normalizeIp(part)
    if (candidate !== '') return candidate
}
```

XFF 是追加语义：最左可被客户端伪造、最右由最近受信代理追加。取首项 = 信任可伪造部分。受信位置（私网/回环，例如同宿主其它容器）上的攻击者轮换伪造 IP 即可绕过登录节流与创建限流。随附三份 Nginx 配置强制覆盖 `X-Real-IP`（后端优先读它），默认部署不可利用——仍按纵深防御修复。

**关键代码变化**

```js
// X-Forwarded-For 从右往左取：最右侧由最近的受信代理追加，最可信；
// 左侧条目可被客户端伪造（nginx 的 $proxy_add_x_forwarded_for 是“追加”语义），
// 若取首项，攻击者在代理之后即可轮换伪造 IP 绕过登录节流与创建限流。
const parts = forwarded.split(',')
for (let i = parts.length - 1; i >= 0; i -= 1) {
    const candidate = normalizeIp(parts[i])
    if (candidate !== '') return candidate
}
```

**修复原理**：只采信由最近受信代理写入的条目；伪造前缀即使存在也被忽略。`"9.9.9.9, 203.0.113.10"` 修复前取 `9.9.9.9`，修复后取 `203.0.113.10`。

**API 兼容性**：无影响（仅内部 IP 解析；`X-Real-IP` 优先级与 `trustProxy` 语义均不变）。

**回归验证**：`tests/cache-security.test.js` 6 个解析方向用例（T-05~T-10）。

---

## SEC-N03：外链探测 IPv6 转换前缀（Low）

**修复前的问题**：`#isPrivateV6` 未拦截 6to4（`2002::/16`）/ Teredo（`2001:0::/32`）/ NAT64（`64:ff9b::/96`、`64:ff9b:1::/48`）/ IPv4 兼容地址（非 ffff 的 `::` 前缀）——这些前缀可编码任意 IPv4（含环回/内网），具备相应路由的主机上会被转发到内网。外链巡检由服务端主动请求用户提交的 URL，SSRF 面真实存在。

**关键代码变化**

```js
static #isPrivateV6(address) {
    const normalized = address.toLowerCase()

    if (normalized === '::' || normalized === '::1') return true
    // IPv4 映射地址 ::ffff:a.b.c.d —— 按 IPv4 规则判定（公网映射地址放行）
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
    if (mapped) return HttpLinkProbe.#isPrivateV4(mapped[1])
    // 其余 :: 开头的均为未指定/环回/IPv4 兼容地址（::a.b.c.d 可直达内网），一律拒绝
    if (normalized.startsWith('::')) return true

    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // fc00::/7
    if (/^fe[89ab]/.test(normalized)) return true // fe80::/10
    if (normalized.startsWith('ff')) return true // 组播 ff00::/8
    if (normalized.startsWith('2001:db8')) return true // 文档网段
    // Teredo（2001:0::/32）与 6to4（2002::/16）：前缀中可编码任意 IPv4 地址，
    // 包括环回/内网——具备对应路由（NAT64/6to4 网关）的主机上会被转发到内网
    if (/^2001:0($|:)/.test(normalized)) return true
    if (normalized.startsWith('2002:')) return true
    // NAT64 众所周知前缀 64:ff9b::/96 与本地用 64:ff9b:1::/48：同样可编码 IPv4 目标
    if (normalized.startsWith('64:ff9b:')) return true

    return false
}
```

**修复原理**：把「IPv4 地址可经转换前缀嵌入 IPv6」的全部通道纳入既有私网判定，与 IPv4 侧 `FILTER_FLAG_NO_PRIV_RANGE|NO_RES_RANGE` 口径对齐。探测的其余防护（DNS 解析后逐 IP 校验、自定义 lookup 固定连接 IP 防 DNS 重绑定、重定向手工逐跳重校验、只读响应头）复核有效、未改动。

**API 兼容性**：无。公网 IPv6（如 `2606:4700::`）与公网映射形式（`::ffff:8.8.8.8`）继续可探测。

**回归验证**：13 个应拒地址（含 `2002:7f00:1::`、`64:ff9b::7f00:1`、`::10.0.0.1`）+ 4 个应放行公网地址的单元断言（T-11~T-12）。

---

## 本轮未修复项（原因与缓解）

| ID | 未修复原因 | 现有缓解 |
| --- | --- | --- |
| SEC-N04 `/healthz` 泄露链接总数 | 是 MIGRATION/BAOTA 文档写明的探活契约，删除破坏已文档化 API | 总数非敏感；robots.txt 已对其 noindex |
| SEC-N05 创建者原始 IP/UA 落库 | 功能设计，文档已披露 | 仅管理端 API 可见；不进跳转缓存 |
| SEC-N06 默认口令 admin123 | 既定默认，保持与存量部署兼容 | compose 可注入哈希；README/文档/后台三处提示修改 |
| SEC-N07 `198.18.0.0/15` 不拦 | 源码注释明确的设计取舍（fake-IP 网段真实站点常见） | 属公网段，无内网直达能力 |
| SEC-N08 受信位置可伪造代理头 | 「私网即可信」的明示边界，属部署模型 | 公网直连不受影响；nginx 强制 X-Real-IP；本轮 SEC-N02 修复进一步收窄为仅 XFF 回退路径 |

## 全量验证结果

```bash
cd backend && npm test
#   tests 109 / pass 109 / fail 0（含新增 cache-security 12 项）
#   suites 23

npm audit          # backend：0 漏洞
npm audit --omit=dev   # 根：0 漏洞
```

修复后攻击重放（独立环境 3022）：三类注入原语全部失效，既有短链持续 302 原地址、缓存正常命中。
