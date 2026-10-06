<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Foundation\App;
use App\Http\Request;
use App\Repositories\AuthRepository;
use App\Repositories\ClickRepository;
use App\Repositories\SettingsRepository;
use App\Repositories\UrlRepository;
use App\Support\Config;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemorySettingsRepository;
use Tests\Doubles\InMemoryUrlRepository;

/**
 * 测试装配器：与生产同一条 App::create 组装链，仅替换仓库实现与日志目录。
 */
final class TestApp
{
    public static function create(
        ?InMemoryUrlRepository $repository = null,
        ?ClickRepository $clicks = null,
        ?AuthRepository $authRepository = null,
        ?SettingsRepository $settings = null,
    ): App {
        return App::create(
            self::defaultConfig(),
            $repository ?? new InMemoryUrlRepository(),
            null,
            $clicks ?? new InMemoryClickRepository(),
            $authRepository ?? new InMemoryAuthRepository(),
            $settings ?? new InMemorySettingsRepository(),
        );
    }

    /**
     * 与生产 fromGlobals 同语义：从 URI 拆出 path 与 query。
     *
     * @param array<string, string> $headers
     */
    public static function request(string $method, string $path, ?string $body = null, array $headers = []): Request
    {
        $parts = parse_url($path);
        $pathOnly = rawurldecode(is_array($parts) && isset($parts['path']) ? (string) $parts['path'] : $path);
        if ($pathOnly === '') {
            $pathOnly = '/';
        }

        $query = [];
        if (is_array($parts) && isset($parts['query'])) {
            $parsed = [];
            parse_str((string) $parts['query'], $parsed);
            foreach ($parsed as $key => $value) {
                if (is_string($value)) {
                    $query[(string) $key] = $value;
                }
            }
        }

        return new Request($method, $pathOnly, $body ?? '', $query, $headers);
    }

    /**
     * 登录态 Cookie 请求头。
     *
     * @return array<string, string>
     */
    public static function cookieHeader(string $token): array
    {
        return ['cookie' => 'admin_token='.$token];
    }

    /**
     * 测试用 /admin 面板入口文件路径（dist_index 配置项）。
     */
    public static function distIndexPath(): string
    {
        return sys_get_temp_dir().'/short-url-test-dist-index.html';
    }

    private static function defaultConfig(): Config
    {
        return new Config([
            'app' => [
                'env' => 'testing',
                'debug' => false,
                'url' => '',
                'port' => 3001,
                'dist_index' => self::distIndexPath(),
            ],
            'database' => [
                'path' => sys_get_temp_dir().'/short-url-test.sqlite3',
            ],
            'auth' => [
                'username' => 'admin',
                'password' => 'secret123',
                'password_hash' => '',
                'token_ttl_days' => 7,
            ],
            'logging' => [
                'path' => sys_get_temp_dir().'/short-url-test-logs',
            ],
        ]);
    }
}
