<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Foundation\App;
use App\Http\Request;
use App\Support\Config;
use Tests\Doubles\InMemoryUrlRepository;

/**
 * 测试装配器：与生产同一条 App::create 组装链，仅替换仓库实现与日志目录。
 */
final class TestApp
{
    public static function create(?InMemoryUrlRepository $repository = null): App
    {
        return App::create(self::defaultConfig(), $repository ?? new InMemoryUrlRepository());
    }

    /**
     * @param array<string, string> $headers
     */
    public static function request(string $method, string $path, ?string $body = null, array $headers = []): Request
    {
        return new Request($method, $path, $body ?? '', [], $headers);
    }

    private static function defaultConfig(): Config
    {
        return new Config([
            'app' => [
                'env' => 'testing',
                'debug' => false,
                'url' => '',
                'port' => 3001,
            ],
            'database' => [
                'path' => sys_get_temp_dir().'/short-url-test.sqlite3',
            ],
            'logging' => [
                'path' => sys_get_temp_dir().'/short-url-test-logs',
            ],
        ]);
    }
}
