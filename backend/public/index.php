<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use App\Foundation\App;
use App\Http\Request;
use App\Support\Config;
use App\Support\DevStaticFile;
use App\Support\Env;

// PHP 内置服务器（仅本地开发）：优先返回前端构建产物与静态资源。
// 路径必须在允许目录内（DevStaticFile 做 realpath 归属校验），否则 /../.env 之类的
// 穿越路径会读到 .env、SQLite 库与后端源码。
if (PHP_SAPI === 'cli-server') {
    $path = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));
    if ($path === '/' || $path === '') {
        $path = '/index.html';
    }

    $file = DevStaticFile::resolve($path, [dirname(__DIR__, 2).'/dist', dirname(__DIR__, 2).'/public']);
    if ($file !== null) {
        header('Content-Type: '.DevStaticFile::mimeFor($file));
        header('X-Content-Type-Options: nosniff');
        readfile($file);
        exit;
    }
}

Env::load(dirname(__DIR__).'/.env', dirname(__DIR__, 2).'/.env');

$config = new Config(require dirname(__DIR__).'/config/config.php');

ini_set('display_errors', $config->get('app.debug') === true ? '1' : '0');
error_reporting(E_ALL);

// 不暴露 PHP 版本（X-Powered-By 由 PHP 自动附加，须显式移除）
header_remove('X-Powered-By');

try {
    App::create($config)->handle(Request::fromGlobals())->send();
} catch (\Throwable $exception) {
    // 装配/启动阶段兜底：不向客户端泄露任何内部信息
    error_log('short-url bootstrap failure: '.$exception::class.' '.$exception->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }

    echo '{"error":"Internal Server Error"}';
}
