<?php

declare(strict_types=1);

// PHP 内置服务器（仅本地开发）：优先返回 React 构建产物与静态资源。
if (PHP_SAPI === 'cli-server') {
    $path = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));
    if ($path === '/') {
        $path = '/index.html';
    }

    $safePath = str_replace(['\\', "\0"], '', $path);
    foreach ([dirname(__DIR__, 2).'/build', dirname(__DIR__, 2).'/public'] as $staticRoot) {
        $file = $staticRoot.$safePath;
        if (is_file($file)) {
            header('Content-Type: '.static_mime($file));
            readfile($file);
            exit;
        }
    }
}

/**
 * 本地开发静态回退的 MIME 映射（生产环境由 Nginx 负责）。
 */
function static_mime(string $file): string
{
    $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));

    return match ($extension) {
        'html', 'htm' => 'text/html; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'json', 'map' => 'application/json',
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf' => 'font/ttf',
        'txt' => 'text/plain; charset=utf-8',
        'webmanifest' => 'application/manifest+json',
        default => 'application/octet-stream',
    };
}

require dirname(__DIR__).'/vendor/autoload.php';

use App\Foundation\App;
use App\Http\Request;
use App\Support\Config;
use App\Support\Env;

Env::load(dirname(__DIR__).'/.env', dirname(__DIR__, 2).'/.env');

$config = new Config(require dirname(__DIR__).'/config/config.php');

ini_set('display_errors', $config->get('app.debug') === true ? '1' : '0');
error_reporting(E_ALL);

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
