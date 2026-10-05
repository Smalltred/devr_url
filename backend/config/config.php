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
    ],
    'database' => [
        // SQLite 数据库文件；目录不存在时自动创建，文件随请求惰性打开
        'path' => env('DATABASE_PATH', $backendPath.'/storage/short-url.sqlite3'),
    ],
    'logging' => [
        'path' => $backendPath.'/storage/logs',
    ],
];
