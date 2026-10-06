<?php

declare(strict_types=1);

/**
 * 宝塔部署包 · 前端控制器（public/ 即网站运行目录）
 *
 * 标准结构：public/ 之外的所有内容（app、config、vendor、storage、.env）均不可被 Web 直接访问。
 * 请求分发顺序：
 *   1. `/` 与 `/index.html` → 返回前端首页（Vite 产物已平铺在 public/ 内）；
 *   2. PHP 内置服务器本地试用时，真实静态文件直接返回（生产环境由 Nginx/Apache 直出）；
 *   3. 其余路径（短码跳转 GET /{code}、创建接口 POST /url 与 /api/url）→ 路由分发。
 *
 * 静态兜底做了 realpath 归属校验，且不返回 .php：请求路径完全由客户端控制，
 * 直接拼接根目录会让 `/../.env` 之类的路径读到 Web 根之外的配置与数据。
 */

$requestPath = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));

// ---------- 1. 首页 ----------
if ($requestPath === '/' || $requestPath === '/index.html') {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__.'/index.html');
    exit;
}

// ---------- 2. 静态资源兜底（仅 PHP 内置服务器；生产由 Web 服务器直出） ----------
if (PHP_SAPI === 'cli-server' && $requestPath !== '' && $requestPath !== '/') {
    // 其他 .php 文件（如 check.php）交还给内置服务器执行
    if (str_ends_with($requestPath, '.php') && is_file(__DIR__.$requestPath)) {
        return false;
    }

    $root = (string) realpath(__DIR__);
    $file = $root === '' ? false : realpath($root.DIRECTORY_SEPARATOR.ltrim($requestPath, '/\\'));
    if (
        $root !== '' && is_string($file) && is_file($file)
        && str_starts_with($file, $root.DIRECTORY_SEPARATOR)
        && strtolower(pathinfo($file, PATHINFO_EXTENSION)) !== 'php'
    ) {
        header('Content-Type: '.static_mime($file));
        header('X-Content-Type-Options: nosniff');
        readfile($file);
        exit;
    }
}

// ---------- 3. 路由分发 ----------
require dirname(__DIR__).'/vendor/autoload.php';

use App\Foundation\App;
use App\Http\Request;
use App\Support\Config;
use App\Support\Env;

Env::load(dirname(__DIR__).'/.env', dirname(__DIR__).'/.env.example');

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

/**
 * 静态资源 MIME 映射（仅 PHP 内置服务器兜底路径使用）。
 */
function static_mime(string $file): string
{
    return match (strtolower(pathinfo($file, PATHINFO_EXTENSION))) {
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
