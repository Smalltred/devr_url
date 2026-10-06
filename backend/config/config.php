<?php

declare(strict_types=1);

use function App\Support\env;
use function App\Support\env_bool;
use function App\Support\env_int;

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
    ],
    'database' => [
        // SQLite 数据库文件；目录不存在时自动创建，文件随请求惰性打开
        'path' => env('DATABASE_PATH', $backendPath.'/storage/short-url.sqlite3'),
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
