<?php

declare(strict_types=1);

namespace App\Support;

/**
 * PHP 内置服务器（php -S，仅本地开发）的静态文件回退。
 *
 * 之所以集中在此并强制 realpath 归属校验：请求路径完全由客户端控制，
 * 直接拼接根目录会让 `/../.env`、`/../backend/storage/*.sqlite3` 这类路径
 * 读到 Web 根之外的文件（.env 与 SQLite 库泄露）。生产环境静态文件由
 * Nginx/Apache 直出，不经过本类。
 */
final class DevStaticFile
{
    /**
     * 解析请求路径对应的可服务文件；不在允许目录内、或不可服务时返回 null。
     *
     * @param list<string> $roots 允许服务的根目录（按顺序优先）
     */
    public static function resolve(string $path, array $roots): ?string
    {
        if ($path === '' || str_contains($path, "\0")) {
            return null;
        }

        // 目录请求统一走 index.html；其余原样交给 realpath 归一化（含 .. 与 %2e 解码后的形式）
        $candidate = str_ends_with($path, '/') ? $path.'index.html' : $path;

        foreach ($roots as $root) {
            $rootReal = realpath($root);
            if ($rootReal === false) {
                continue;
            }

            $fileReal = realpath($rootReal.DIRECTORY_SEPARATOR.ltrim($candidate, '/\\'));
            if ($fileReal === false || !is_file($fileReal)) {
                continue;
            }

            // 归属校验：必须位于允许目录内部（分隔符边界比较，避免 /dist-evil 绕过）
            if (!str_starts_with($fileReal, $rootReal.DIRECTORY_SEPARATOR)) {
                continue;
            }

            // 脚本一律不按静态文件返回：否则内置服务器会把 PHP 源码原样输出
            if (strtolower(pathinfo($fileReal, PATHINFO_EXTENSION)) === 'php') {
                continue;
            }

            return $fileReal;
        }

        return null;
    }

    /**
     * 静态资源 MIME 映射（生产环境由 Nginx/Apache 负责）。
     */
    public static function mimeFor(string $file): string
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
}
