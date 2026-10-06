# Short URL 安全修复记录

本次审计共确认并修复 **11 项风险条目**（2 High / 5 Medium / 4 Low），
另修复 4 项配置与文档改进（Info），1 项 Info（SEC-012）经可达性分析判定无需修复。
6 项经实测判定为「非漏洞 / 设计取舍」（SEC-017 ~ SEC-022）不计入修复数。
所有修复均遵循「后端强制校验、不关闭功能、不弱化策略、保持既有行为兼容」的原则。

对应漏洞详情见 [SECURITY-AUDIT.md](SECURITY-AUDIT.md)，验证证据见 [SECURITY-TEST-REPORT.md](SECURITY-TEST-REPORT.md)。

## 修复清单

| ID | 等级 | 修复文件 | 数据库变化 | 配置变化 | 兼容性影响 |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | High | `backend/app/Support/DevStaticFile.php`（新增）、`backend/public/index.php`、`deploy/baota/public/index.php` | 无 | 无 | 无（仅收紧合法路径） |
| SEC-002 | High | `backend/app/Http/Request.php` | 无 | 无 | 无（修复丢参 bug） |
| SEC-003 | Medium | `backend/app/Security/CsrfGuard.php`（新增）、`App.php`、`routes/web.php` | 无 | 新增 `ALLOWED_ORIGINS`、`CSRF_ALLOW_MISSING_ORIGIN` | **有**：非浏览器客户端写请求需带 `Origin`/`Referer`（开放 API 带 Key 时豁免） |
| SEC-004 | Medium | `App.php`、`Request.php`、`Validation/UrlValidator.php`、`Exceptions/PayloadTooLargeException.php`（新增）、`Http/ExceptionHandler.php` | 无 | 新增 `MAX_BODY_BYTES` | **有**：URL > 2048 字节或请求体 > 16KB 返回 413 |
| SEC-005 | Medium | `deploy/baota/public/check.php`、`deploy/build-baota-package.php`、`deploy/baota/部署说明.md` | 无 | 新增 `.check-token` | **有**：自检页需令牌访问 |
| SEC-006 | Medium | `backend/app/Security/SecurityHeaders.php`（新增）、`App.php`、两个 `index.php` | 无 | 新增 `HSTS_MAX_AGE`、`CSP_SCRIPT_EXTRA`、`CSP_CONNECT_EXTRA` | **有**：响应头新增；跨域前后端分离需配 `CSP_CONNECT_EXTRA` |
| SEC-007 | Low | `Services/AuthService.php`、`Controllers/AuthController.php` | 无 | 无（沿用 `APP_URL`） | 无 |
| SEC-008 | Low | `deploy/nginx/short-url.conf`、`compose.conf`、`docker.conf` | 无 | 无 | 无（追加拒绝规则） |
| SEC-009 | Low | `.env.example`、`README.md` | 无 | 无 | 无 |
| SEC-010 | Medium | `Security/RequestRateLimiter.php`（新增）、`Repositories/RequestThrottleRepository.php` + `SqliteRequestThrottleRepository.php`（新增）、`DatabaseService.php`、`App.php`、`routes/web.php` | **新增表 `request_throttle`** | 新增 `CREATE_RATE_LIMIT_MAX`、`CREATE_RATE_LIMIT_WINDOW` | **有**：默认 60 次/分钟/IP 限流 |
| SEC-011 | Low | `app/Support/IpHasher.php`、`Foundation/App.php`、`config/config.php` | 无 | 新增 `IP_HASH_SECRET` | 无（留空时行为不变） |
| SEC-013 | Info | `Services/ClickTracker.php`、`App.php`、`config/config.php` | 无（字段保留） | 新增 `PRIVACY_STORE_REFERER` | **有**：默认不再保存完整 Referer |
| SEC-014 | Info | `deploy/nginx/*.conf` | 无 | 无 | 无 |
| SEC-015 | Info | `Dockerfile` | 无 | 无 | 无 |
| SEC-016 | Info | `docker-compose.yml` | 无 | 变量可注入 | 无（默认值保留） |

---

## SEC-001：本地开发静态回退路径穿越

**原因**：`index.php` 用字符串拼接构造静态文件路径，仅在拼接前删除 `\` 与 NUL，
未做路径归属校验；`rawurldecode` 在路由之前执行，`%2e%2e` 等编码形式同样可用。

**修复方案**：新增 `App\Support\DevStaticFile`，把「路径 → 可服务文件」的判定集中一处：

1. 目录请求补 `index.html`；
2. 用 `realpath()` 归一化（`..`、`.%2e`、符号链接一并解开）；
3. 强制 `str_starts_with($fileReal, $rootReal.DIRECTORY_SEPARATOR)`——比较含分隔符，
   避免 `/dist-evil` 这类同前缀目录绕过；
4. **拒绝返回 `.php`**：内置服务器对真实 `.php` 文件会执行，但若通过静态分支 `readfile`
   则输出源码；
5. 命中后补 `X-Content-Type-Options: nosniff`。

宝塔包 `index.php` 的 `cli-server` 分支同步改为等价实现（原实现先剥离 `..` 再 realpath，
判定不完整）。

**代码变化**（`backend/public/index.php`）：

```php
// 修复前
$safePath = str_replace(['\\', "\0"], '', $path);
foreach ([...] as $staticRoot) {
    $file = $staticRoot.$safePath;
    if (is_file($file)) { header('Content-Type: '.static_mime($file)); readfile($file); exit; }
}

// 修复后
$file = DevStaticFile::resolve($path, [dirname(__DIR__, 2).'/dist', dirname(__DIR__, 2).'/public']);
if ($file !== null) {
    header('Content-Type: '.DevStaticFile::mimeFor($file));
    header('X-Content-Type-Options: nosniff');
    readfile($file);
    exit;
}
```

**为什么能解决漏洞**：无论请求路径如何编码，最终都要通过 `realpath` 解析并与允许根目录的
绝对路径做前缀比较；解析结果落在根目录之外时返回 `null`，请求落入路由并被当作短码处理
（返回 404 JSON），因此不再存在「拼接后恰好指向根外文件」的路径。同时 `.php` 被显式排除，
杜绝源码输出。

**兼容性影响**：无。正常静态资源（`/`、`/index.html`、`/assets/*`、`/favicon.svg`、
`/manifest.json`、`/robots.txt`）实测仍正常返回。

---

## SEC-002：客户端 IP 在路由参数注入后丢失

**原因**：`Router::dispatch()` 总是用 `$request->withParams($params)` 的结果调用处理器，
而 `withParams()` 只传递前 6 个构造参数，漏掉 `$remoteAddress`，导致所有业务代码
拿到的 `clientIp()` 恒为空串。下游 `IpHasher::hash('')` 返回 `null`：
登录限流回退为常量 `'anonymous'`（全站共享一个桶），点击统计的 `ip_hash` 恒为 `NULL`
（独立访客用 `COUNT(DISTINCT ip_hash) WHERE ip_hash IS NOT NULL`，结果恒为 0）。

**修复方案**：`withParams()` 显式透传 `$this->remoteAddress`。

**代码变化**（`backend/app/Http/Request.php`）：

```php
// 修复前
return new self($this->method, $this->path, $this->rawBody, $this->query, $this->headers, $params);

// 修复后
return new self(
    $this->method, $this->path, $this->rawBody, $this->query, $this->headers, $params,
    $this->remoteAddress,   // 丢失它会让登录限流按空 IP 归并、点击统计丢失独立访客
);
```

**为什么能解决漏洞**：路由注入后处理器收到的请求对象完整保留 `REMOTE_ADDR`，
限流按真实来源分桶（不再互相影响），`ip_hash` 正常写入，独立访客统计恢复。

**兼容性影响**：无。测试助手 `TestApp::request()` 同步补充了默认 `Host`/`Origin` 头
（真实浏览器写请求必然携带），已有 112 个测试全部保持通过。

---

## SEC-003：状态变更请求缺少来源校验（CSRF）

**原因**：登录态存于 Cookie（浏览器自动附带），全部写操作仅依赖 `SameSite=Strict`。
该属性对不识别它的旧浏览器/WebView 无效，且「同站」判定在站点存在 `http://` 子域或
其它端口时不覆盖。

**修复方案**：新增 `App\Security\CsrfGuard`，在 `App::handle()` 中早于任何处理器执行：

- 只校验非 `GET/HEAD/OPTIONS`；
- 来源取 `Origin`（`null` 视为无效），缺失时取 `Referer` 的「协议 + 主机 + 端口」；
- 与请求 `Host` 头比较判定同源（协议不参与比较：内网 TLS 卸载场景下 Origin 为 https、
  回源为 http，属同站请求，不应误杀）；
- 额外允许 `ALLOWED_ORIGINS` 白名单；
- 来源完全缺失时默认拒绝（`CSRF_ALLOW_MISSING_ORIGIN=true` 可放行）。

**关键设计：显式凭据头例外。** 携带 `X-API-Key` 或 `Authorization: Bearer` 的请求跳过来源校验。
理由：CSRF 成立的前提是「浏览器自动附带凭据」；自定义请求头只能由脚本显式设置，
跨站表单无法添加，浏览器跨域设置自定义头会先触发预检（本服务不返回 CORS 允许头）。
开放 API 的脚本客户端（curl/SDK）不会发送 `Origin`，若无此例外将被误杀——实测确实出现了
`403` 回归，随后加入例外并补回归测试。例外范围严格限定于「带 Key 头」，
仅凭 Cookie 的管理端写操作仍必须同源。

**代码变化**（`backend/app/Foundation/App.php`）：

```php
public function handle(Request $request): Response
{
    try {
        if ($this->maxBodyBytes > 0 && strlen($request->rawBody()) > $this->maxBodyBytes) {
            throw new PayloadTooLargeException(...);   // SEC-004
        }

        $this->csrfGuard?->assertSafe($request);       // SEC-003：早于任何处理器

        return SecurityHeaders::apply($this->router->dispatch($request), ...);  // SEC-006
    } catch (\Throwable $exception) {
        return SecurityHeaders::apply($this->exceptionHandler->render($exception), ...);
    }
}
```

**为什么能解决漏洞**：跨站页面发起的写请求必然携带与目标站点不同源的 `Origin`
（或 `Referer`），被 403 拒绝；同源前端与带 Key 的脚本客户端不受影响。
`SameSite=Strict` 作为第二层防线保留，形成双重防护。

**兼容性影响（重要）**：
- 用 curl / 脚本调用**公开创建接口**（`/url`、`/api/url`）时需添加 `Origin` 头；
  若确有无法补头的集成方，可设 `CSRF_ALLOW_MISSING_ORIGIN=true`（会降低防护强度，默认不建议）。
- **开放 API（`/api/open/shorten`）带 Key 调用不受影响。**
- 跨域部署（前后端不同域）需把前端源写入 `ALLOWED_ORIGINS`。
- 已同步更新 `docs/API.md` 的 curl 示例与状态码表。

---

## SEC-004：请求体与目标 URL 长度无上限

**原因**：`Request::fromGlobals()` 无上限读取 `php://input`；
`UrlValidator` 不限制长度，1MB URL 可永久入库。

**修复方案**：

1. 新增 `App\Exceptions\PayloadTooLargeException` → `ExceptionHandler` 映射为 **413**；
2. `App::handle()` 最前置校验原始请求体长度（`MAX_BODY_BYTES`，默认 16384）；
3. `UrlValidator::MAX_LENGTH = 2048`，在归一化**前后各校验一次**
   （先按输入长度快速拒绝，避免对超大字符串跑正则；归一化后长度可能因百分号编码变长）。

**代码变化**（`backend/app/Validation/UrlValidator.php`）：

```php
public const MAX_LENGTH = 2048;

// ...
if (strlen($url) > self::MAX_LENGTH) {
    throw new PayloadTooLargeException('URL exceeds '.self::MAX_LENGTH.' bytes');
}
// ... 归一化后再校验实际入库长度
$normalized = $this->normalize($url);
if (strlen($normalized) > self::MAX_LENGTH) {
    throw new PayloadTooLargeException(...);
}
```

**为什么能解决漏洞**：单请求的内存与存储占用被硬性限定；超限在落库之前被拒绝
（请求体校验在路由之前，URL 校验在 `ShortUrlService::create()` 写入之前）。

**兼容性影响**：2048 字节覆盖主流浏览器实际可用范围（约 2000+），实测 2048 字节 URL 仍返回 200；
更长的 URL 返回 413。`MAX_BODY_BYTES` 可调高以适配特殊场景。

---

## SEC-005：部署包自检页无鉴权且产生数据写入

**原因**：`check.php` 面向公网开放，输出 PHP 版本/扩展/可写性/数据库状态与真实异常信息；
页面加载即执行一次「创建短链 → 跳转」，每次访问写入一条短链。

**修复方案**（`deploy/baota/public/check.php` 重写）：

1. **访问令牌**：打包脚本 `deploy/build-baota-package.php` 用 `random_bytes(16)` 生成令牌，
   写入包根 `.check-token`（Web 根之外），并打印到构建输出；页面用 `hash_equals()` 做
   常量时间比较，未带/错误令牌返回 403；令牌文件缺失时一律拒绝运行；
2. **去除信息回显**：不再显示文件路径、数据库路径与配置值，异常只回显类名；
3. **写入改为显式触发**：全链路实测需 `&run=1`，且探针短链（含点击记录）在**同一请求内删除**；
4. 路由探测改为纯读（非法参数 400 + 随机路径 404），不再创建真实短链。

**代码变化**（令牌校验）：

```php
$expected = is_file($tokenFile) ? trim((string) file_get_contents($tokenFile)) : '';
$provided = isset($_GET['token']) && is_string($_GET['token']) ? trim($_GET['token']) : '';

if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
    http_response_code(403);
    // ...
    exit;
}
```

**为什么能解决漏洞**：无令牌者无法读取部署信息，也无法触发写操作；即使持有令牌，
普通访问也不再修改业务数据。令牌存于 Web 根之外，不会被静态请求获取。

**兼容性影响**：自检页访问方式变为 `/check.php?token=<令牌>`；
`deploy/baota/部署说明.md`、`README.md` 已同步更新，并在打包输出中直接打印令牌。

---

## SEC-006：缺少安全响应头并泄露 PHP 版本

**原因**：无任何安全响应头；`X-Powered-By` 由 PHP 自动附加，精确暴露补丁版本。

**修复方案**：新增 `App\Security\SecurityHeaders`，在 `App::handle()` 的成功与异常
两条路径统一附加，避免错误响应漏掉安全头。

**CSP 与构建产物的匹配（关键）**：项目 `index.html` 内联了两段脚本
（首帧主题、Google Analytics 引导），直接上 `script-src 'self'` 会在浏览器中打断 SPA。
因此对 `text/html` 响应**按内容动态计算内联脚本 sha256** 并放入 `script-src`；
`style-src` 保留 `'unsafe-inline'`（Vue 的 `:style` 绑定写 style 属性）；
`img-src` 允许 `data:`（二维码为 data URL）；`frame-ancestors 'none'` 与
`X-Frame-Options: DENY` 双写以覆盖新旧浏览器。

```php
'content-security-policy' => implode('; ', [
    "default-src 'self'",
    'script-src '.implode(' ', array_unique(array_merge(["'self'"], $scriptHashes, $scriptExtra))),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    'connect-src '.implode(' ', array_unique(array_merge(["'self'"], $connectExtra))),
    "form-action 'self'", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
]),
```

HSTS 仅在请求 `X-Forwarded-Proto: https` 且 `HSTS_MAX_AGE > 0` 时下发，
避免纯 HTTP 部署被浏览器锁死。`X-Powered-By` 由两个入口的 `header_remove()` 移除。

**为什么能解决漏洞**：注入点即使存在，浏览器侧也会被 CSP 拦截（内联脚本哈希失配即为拦截信号）；
点击劫持被 `frame-ancestors`/`XFO` 阻断；Referer 按 `strict-origin-when-cross-origin`
收敛；版本指纹消失。

**兼容性影响**：
- 已用真实浏览器验证首页与管理后台在 CSP 下功能完整（渲染、样式、接口调用、结果展示均正常）；
- **跨域部署**（`VITE_API_BASE_URL` 指向独立域）需把后端源写入 `CSP_CONNECT_EXTRA`，
  否则 `connect-src 'self'` 会拦截 API 请求；
- 更换统计脚本需相应设置 `CSP_SCRIPT_EXTRA`（留空时默认放行 Google Analytics）。

---

## SEC-007：会话 Cookie 的 Secure 属性依赖 APP_URL

**原因**：`Secure` 只看 `APP_URL` 前缀。生产若沿用 `.env.example` 的 `http://` 默认值，
HTTPS 站点会下发不带 `Secure` 的会话 Cookie。

**修复方案**：`AuthService::authCookie()` / `logout()` 增加 `bool $secure` 参数；
`AuthController` 传入 `SecurityHeaders::isSecureRequest($request)`（识别反代
`X-Forwarded-Proto`）。最终判定为「请求经 HTTPS **或** `APP_URL` 为 https」。

**代码变化**（`backend/app/Services/AuthService.php`）：

```php
$https = $secure || str_starts_with(strtolower((string) $this->config->get('app.url', '')), 'https://');
return sprintf('%s=%s; Path=/; HttpOnly; SameSite=Strict%s; Max-Age=%d',
    self::COOKIE_NAME, $token, $https ? '; Secure' : '', $ttl);
```

**为什么能解决漏洞**：HTTPS 请求（含 TLS 卸载到反代的部署）一律附加 `Secure`，
会话 Cookie 不会被浏览器在明文链路上发送；本地 HTTP 开发不受影响。

**兼容性影响**：无。本地开发（http）行为不变。

---

## SEC-008 / SEC-014：Nginx 配置加固

**原因**：参考配置未阻断 `.env`/`.git`/SQLite/日志，也未禁止 `.php` 被当静态文件输出；
未显式传递 `HTTP_HOST`（新的 CSRF 同源判定依赖它）。

**修复方案**：三个配置（`short-url.conf`、`compose.conf`、`docker.conf`）统一加入：

```nginx
# 敏感文件后缀
location ~ (^|/)\.(env|git|svn|hg)|\.(sqlite3?|db|log|bak|swp|old|ini|sh)$ { deny all; return 404; }
# 后端源码目录
location ~ ^/(backend|app|config|routes|vendor|storage|tests|deploy|docs)/ { deny all; return 404; }
# .php 不当静态文件输出，且必须存在
location ~ \.php$ {
    try_files $uri =404;
    fastcgi_pass ...;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME .../public/index.php;
    fastcgi_param HTTPS $https if_not_empty;
    fastcgi_param HTTP_HOST $http_host;   # CSRF 同源判定依赖
}
```

**为什么能解决漏洞**：即使 `root` 被误配到项目根、或 PHP-FPM 不可用，敏感文件与源码
都不会被 Nginx 直接输出（纵深防御）。

**兼容性影响**：无（仅对敏感路径追加拒绝）。注意：`deploy/nginx/` 仅为参考模板，
实际宝塔站点配置需部署者粘贴生效。

---

## SEC-009：调试模式默认值文档化

**原因**：仓库根 `.env` 为本地开发值 `APP_DEBUG=true`；`ExceptionHandler` 在 debug 下
回显真实异常消息（含路径）。该文件已被 `.gitignore` 忽略，未提交。

**修复方案**：不改变默认逻辑（生产默认 false），在 `.env.example` 与 README 中强化说明，
并在审计中实测确认生产配置下所有错误响应均不含路径/SQL/堆栈。

**兼容性影响**：无。

---

## SEC-010：创建接口频次限制

**原因**：`/url`、`/api/url`、`/api/open/shorten` 无任何频率限制。

**修复方案**：

1. 新增表 `request_throttle(scope, subject, window_start, hits)`，主键 `(scope, subject)`；
2. 新增 `RequestThrottleRepository` 契约与 SQLite 实现，
   在 `BEGIN IMMEDIATE` 事务内 upsert 后回读计数——保证并发请求下计数不丢失；
3. 新增 `App\Security\RequestRateLimiter`，按 IP 匿名哈希在固定窗口计数，超限抛
   `ThrottleException`（HTTP 429，复用既有异常）；
4. 在 `routes/web.php` 的 `$publicGuard` 与 `$openGuard` 中调用
   （公开接口与开放 API 共用 `create` 计数域）。

**代码变化**（`SqliteRequestThrottleRepository::hit()` 的窗口语义）：

```sql
INSERT INTO request_throttle (scope, subject, window_start, hits)
VALUES (:scope, :subject, :window_start, 1)
ON CONFLICT(scope, subject) DO UPDATE SET
   hits = CASE WHEN request_throttle.window_start = excluded.window_start
               THEN request_throttle.hits + 1 ELSE 1 END,
   window_start = excluded.window_start
```

**为什么能解决漏洞**：同一 IP 在窗口内的创建次数被硬性限定，批量刷短码在阈值处被 429 阻断；
`BEGIN IMMEDIATE` 保证并发下计数正确（不会因读改写竞争而丢计数）。

**数据库变化**：新增 `request_throttle` 表，由 `DatabaseService::SCHEMA` 的
`CREATE TABLE IF NOT EXISTS` 在连接时自动创建，**对存量数据库为零侵入迁移**
（不修改任何既有表结构与数据）。

**兼容性影响**：默认 60 次/分钟/IP。正常人工使用远低于该阈值；
如需关闭（内网部署）设 `CREATE_RATE_LIMIT_MAX=0`。

---

## SEC-011：IP 匿名哈希密钥可选化

**原因**：`sha256(ip + salt)` 的盐与被哈希数据同库存储，库泄露后可离线枚举 IPv4 反推 IP。

**修复方案**：

1. `IpHasher` 支持 `IP_HASH_SECRET`：设置后改用 `hash_hmac('sha256', $ip, $secret)`，
   密钥不落库；
2. 顺带修复并发隐患：首次生成盐后**回读一次**，避免多进程（FPM）并发首请求各自生成
   不同盐，导致同一 IP 被计为多个访客。

**代码变化**（`backend/app/Support/IpHasher.php`）：

```php
public function hash(string $ip): ?string
{
    if ($ip === '') { return null; }
    if ($this->secret !== '') {
        return substr(hash_hmac('sha256', $ip, $this->secret), 0, 24);
    }
    return substr(hash('sha256', $ip.$this->salt()), 0, 24);
}

// salt(): 多进程首次并发生成时回读，保证同一安装共用同一个盐
$persisted = $this->meta->get(self::SALT_KEY);
return $this->salt = is_string($persisted) && $persisted !== '' ? $persisted : $generated;
```

**为什么能解决漏洞**：密钥不随数据库存储，单靠库泄露无法离线爆破反推 IP。

**兼容性影响**：留空时行为与旧版一致（沿用库内盐），存量部署无感升级；
**注意**：变更 `IP_HASH_SECRET` 会使历史 `ip_hash` 失配，独立访客数从零重新累计。

---

## SEC-013：完整 Referer 默认不落库

**原因**：`short_url_clicks.referer` 保存来源 URL 前 500 字符，来源页查询串可能含
token / 一次性链接；而管理后台只使用 `referer_host`，完整 Referer 从未被读取或展示。

**修复方案**：`ClickTracker` 增加 `$storeFullReferer`（来自 `PRIVACY_STORE_REFERER`），
默认 `referer = NULL`，`referer_host` 照常保存。

**代码变化**（`backend/app/Services/ClickTracker.php`）：

```php
'referer' => $this->storeFullReferer ? self::truncate($referer, self::MAX_REFERER_LENGTH) : null,
'referer_host' => self::truncate(self::hostOf($referer), self::MAX_REFERER_HOST_LENGTH),
```

**为什么能解决漏洞**：第三方凭据不再被长期留存；「来源域名 Top 10」统计口径不变
（只读 `referer_host`）。

**兼容性影响**：`referer` 列保留（不删列，避免存量库结构变更），仅默认写入 `NULL`；
需要原始 Referer 的部署设 `PRIVACY_STORE_REFERER=true` 即可恢复旧行为。

---

## SEC-015 / SEC-016：Docker 部署加固

**修复方案**：

- `Dockerfile`：镜像内预建 `/app/backend/storage/logs` 并把 `storage` 属主设为 `www-data`、
  权限 775——php-fpm worker 以 `www-data` 运行，否则未挂载命名卷时无法建库（503）；
- `docker-compose.yml`：`ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`/
  `IP_HASH_SECRET`/`ALLOWED_ORIGINS`/`HSTS_MAX_AGE` 改为 `${VAR:-默认值}` 形式，
  可从项目根 `.env` 注入；保留「生产必须修改」注释。

**为什么能解决漏洞**：凭据不再只能硬编码在 compose 中；数据目录属主正确，
非挂载卷场景首次启动即可用。

**兼容性影响**：默认值仍为 `admin123`（便于本地试用），生产需显式注入。

---

## 修复后的整体验证

```bash
# PHP
composer test        # 172 tests, 479 assertions  —— OK
composer analyse     # PHPStan level 8             —— No errors
composer lint        # php-cs-fixer dry-run        —— 0 files to fix
composer audit       # 运行时依赖 0 个              —— 无适用漏洞

# 前端
npm audit            # 7 项告警（5 High）全在构建期工具链，产物命中 0
npm audit --omit=dev # found 0 vulnerabilities
npm run build        # 构建成功，产物无 source map
```

实际渗透复测全部通过（见 SECURITY-TEST-REPORT.md）：

```text
路径穿越     -> 全部 404，泄露 0
客户端 IP     -> 真实 IP 哈希（非 anonymous），UV 统计恢复
CSRF        -> 跨站 403 / 同源 200 / 带 Key 脚本 200
体积上限     -> 2048 可用，4096+ 与 2MB 均 413
安全响应头    -> CSP 等全部下发，X-Powered-By 移除
限流        -> 第 61 次起 429
Cookie      -> HttpOnly + SameSite=Strict + 按请求协议附加 Secure
自检页      -> 无令牌 403，访问不写库
```

## 新增/修改文件一览

**新增（后端）**

```text
backend/app/Security/CsrfGuard.php                        来源校验（含 API Key 例外）
backend/app/Security/SecurityHeaders.php                  安全响应头 + CSP 哈希计算
backend/app/Security/RequestRateLimiter.php               创建限流
backend/app/Repositories/RequestThrottleRepository.php    限流计数契约
backend/app/Repositories/SqliteRequestThrottleRepository.php
backend/app/Exceptions/CsrfException.php                  403
backend/app/Exceptions/PayloadTooLargeException.php       413
backend/app/Support/DevStaticFile.php                     开发静态回退（realpath 归属校验）
backend/tests/Security/SecurityTest.php                   56 个安全回归测试
backend/tests/Doubles/InMemoryRequestThrottleRepository.php
```

**修改（后端）**：`Foundation/App.php`、`Http/Request.php`、`Http/ExceptionHandler.php`、
`Services/AuthService.php`、`Services/ClickTracker.php`、`Services/DatabaseService.php`、
`Support/IpHasher.php`、`Support/helpers.php`、`Validation/UrlValidator.php`、
`Controllers/AuthController.php`、`config/config.php`、`routes/web.php`、
`public/index.php`、`phpunit.xml`、`tests/Support/TestApp.php`、
`tests/Doubles/InMemoryApiKeyRepository.php`

**修改（部署/文档）**：`Dockerfile`、`docker-compose.yml`、`deploy/nginx/{short-url,compose,docker}.conf`、
`deploy/baota/public/{index,check}.php`、`deploy/baota/部署说明.md`、`deploy/build-baota-package.php`、
`.env.example`、`README.md`、`docs/API.md`
