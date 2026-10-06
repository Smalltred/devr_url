<?php

declare(strict_types=1);

use function App\Support\env;
use function App\Support\env_bool;
use function App\Support\env_int;
use function App\Support\env_list;

/**
 * 全项目唯一的配置定义：所有环境变量在此统一读取，业务代码通过注入的 Config 使用。
 * 短链数据经 SQLite（DATABASE_PATH）永久化；短码生成规则与原 Node 项目一致。
 */

$backendPath = dirname(__DIR__);

return [
    'app' => [
        'env' => env('APP_ENV', 'production'),
        'debug' => env_bool('APP_DEBUG', false),
        'url' => env('APP_URL', ''),
        'port' => env_int('APP_PORT', 3001),
        // 前端构建产物入口;/admin 管理面板由此返回 SPA（本地开发也可用 DIST_INDEX 覆盖）。
        // 自动适配两种布局：仓库（dist/ 在项目根）与部署包（前端平铺在 public/）
        'dist_index' => env('DIST_INDEX', is_file($backendPath.'/../dist/index.html')
            ? $backendPath.'/../dist/index.html'
            : $backendPath.'/public/index.html'),
        // HTTP 响应体上限（字节）：超出直接 413，避免超大请求占用内存
        'max_body_bytes' => env_int('MAX_BODY_BYTES', 16384),
    ],
    'security' => [
        // 允许的跨站写操作来源（逗号分隔，如 https://u.example.com,https://www.example.com）
        // 留空 = 仅接受同源请求；同源判定依据 Host 头，反向代理场景无需额外配置
        'allowed_origins' => env_list('ALLOWED_ORIGINS'),
        // 写操作缺少 Origin/Referer 时是否放行。默认 false（拒绝）：浏览器发起的跨站写操作
        // 必然带 Origin/Referer，缺失通常意味着非浏览器客户端。
        // 确有仅用 curl 的集成方且无法补头发送时，才设为 true。
        'csrf_allow_missing_origin' => env_bool('CSRF_ALLOW_MISSING_ORIGIN', false),
        // IP 匿名哈希密钥（推荐设置）：设置后改用 HMAC，密钥不随数据库存储，
        // 库泄露也无法离线爆破反推 IP。留空则沿用库内随机盐（兼容存量部署）。
        'ip_hash_secret' => env('IP_HASH_SECRET', ''),
        // 统计脚本域名（CSP script-src 放行；index.html 内置 Google Analytics）
        'csp_script_extra' => env_list('CSP_SCRIPT_EXTRA') ?: ['https://www.googletagmanager.com'],
        // 跨域部署时把后端源加入 CSP connect-src（如 https://api.example.com）
        'csp_connect_extra' => env_list('CSP_CONNECT_EXTRA'),
        // HSTS 有效期（秒）；0 = 不下发。确认全站 HTTPS 后再设为 31536000
        'hsts_max_age' => env_int('HSTS_MAX_AGE', 0),
    ],
    'ratelimit' => [
        // 创建短链限流：单 IP 在窗口内允许的请求数；0 = 关闭
        'create_max' => env_int('CREATE_RATE_LIMIT_MAX', 60),
        'create_window_seconds' => env_int('CREATE_RATE_LIMIT_WINDOW', 60),
    ],
    'privacy' => [
        // 是否保存完整 Referer（含路径与查询串）。默认关闭：
        // 来源页可能把 token/一次性链接带进查询串，长期留存属隐私风险。
        // 关闭时仅保存来源域名（referer_host），后台统计不受影响。
        'store_full_referer' => env_bool('PRIVACY_STORE_REFERER', false),
    ],
    'database' => [
        // SQLite 数据库文件；目录不存在时自动创建，文件随请求惰性打开
        'path' => env('DATABASE_PATH', $backendPath.'/storage/short-url.sqlite3'),
    ],
    'cache' => [
        // 短链跳转缓存：Memcached。扩展未装或服务不可用时自动降级为直连数据库（跳转不受影响）；
        // 设为 none 可显式关闭。
        'driver' => env('CACHE_DRIVER', 'memcached'),
        // 服务地址（逗号分隔 host:port），默认本机 memcached
        'servers' => env_list('MEMCACHED_SERVERS') ?: ['127.0.0.1:11211'],
        // 命中缓存有效期（秒），后台「设置」页可覆盖；0 = 不缓存
        'ttl' => env_int('CACHE_TTL', 300),
        // 负缓存：缓存“短码不存在”的时长（秒），抵御公网扫描流量；0 = 关闭
        'negative_ttl' => env_int('CACHE_NEGATIVE_TTL', 30),
        // 连接/读写超时（毫秒）：宁可穿透数据库，也不让缓存拖慢跳转
        'timeout_ms' => env_int('MEMCACHED_TIMEOUT_MS', 200),
    ],
    'auth' => [
        // 单管理员账号；生产务必修改默认密码或改用密码哈希
        // 哈希生成：php -r "echo password_hash('你的密码', PASSWORD_DEFAULT);"
        // 设置 ADMIN_PASSWORD_HASH 后 ADMIN_PASSWORD 失效
        'username' => env('ADMIN_USERNAME', 'admin'),
        'password' => env('ADMIN_PASSWORD', 'admin123'),
        'password_hash' => env('ADMIN_PASSWORD_HASH', ''),
        // 登录态有效期（天）
        'token_ttl_days' => env_int('ADMIN_TOKEN_TTL_DAYS', 7),
    ],
    'logging' => [
        'path' => $backendPath.'/storage/logs',
    ],
];
