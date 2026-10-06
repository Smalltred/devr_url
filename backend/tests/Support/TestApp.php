<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Cache\Store;
use App\Foundation\App;
use App\Http\Request;
use App\Repositories\ApiKeyRepository;
use App\Repositories\AuthRepository;
use App\Repositories\ClickRepository;
use App\Repositories\RequestThrottleRepository;
use App\Repositories\SettingsRepository;
use App\Support\Config;
use Tests\Doubles\InMemoryApiKeyRepository;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryCacheStore;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemoryRequestThrottleRepository;
use Tests\Doubles\InMemorySettingsRepository;
use Tests\Doubles\InMemoryUrlRepository;

/**
 * 测试装配器：与生产同一条 App::create 组装链，仅替换仓库实现与日志目录。
 * 默认配置关闭创建限流（create_max=0），需要验证限流的用例自行传入配置。
 */
final class TestApp
{
    public const TEST_HOST = 'localhost:3001';

    public static function create(
        ?InMemoryUrlRepository $repository = null,
        ?ClickRepository $clicks = null,
        ?AuthRepository $authRepository = null,
        ?SettingsRepository $settings = null,
        ?ApiKeyRepository $apiKeys = null,
        ?RequestThrottleRepository $throttles = null,
        ?Config $config = null,
        ?Store $cache = null,
    ): App {
        return App::create(
            $config ?? self::defaultConfig(),
            $repository ?? new InMemoryUrlRepository(),
            null,
            $clicks ?? new InMemoryClickRepository(),
            $authRepository ?? new InMemoryAuthRepository(),
            $settings ?? new InMemorySettingsRepository(),
            $apiKeys ?? new InMemoryApiKeyRepository(),
            $throttles ?? new InMemoryRequestThrottleRepository(),
            $cache ?? new InMemoryCacheStore(),
        );
    }

    /**
     * 生产配置的等价配置（限流开启，供限流用例使用）。
     */
    public static function configWithRateLimit(int $max, int $windowSeconds = 60): Config
    {
        return new Config(array_replace_recursive(self::configArray(), [
            'ratelimit' => [
                'create_max' => $max,
                'create_window_seconds' => $windowSeconds,
            ],
        ]));
    }

    /**
     * 与生产 fromGlobals 同语义：从 URI 拆出 path 与 query。
     * 默认补上 Host 与同源 Origin：真实浏览器的写请求一定带这两个头，
     * 缺失会被 CSRF 来源校验拒绝（属预期行为，见 SecurityTest）。
     * 需要构造跨站/缺失来源的用例，显式传入覆盖用的头即可。
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

        $defaults = [
            'host' => self::TEST_HOST,
            'origin' => 'http://'.self::TEST_HOST,
        ];
        foreach ($defaults as $name => $value) {
            if (!array_key_exists($name, $headers)) {
                $headers[$name] = $value;
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

    public static function defaultConfig(): Config
    {
        return new Config(self::configArray());
    }

    /**
     * @return array<string, mixed>
     */
    private static function configArray(): array
    {
        return [
            'app' => [
                'env' => 'testing',
                'debug' => false,
                'url' => '',
                'port' => 3001,
                'dist_index' => self::distIndexPath(),
                'max_body_bytes' => 16384,
            ],
            'security' => [
                'allowed_origins' => [],
                'csrf_allow_missing_origin' => false,
                'ip_hash_secret' => '',
                'csp_script_extra' => [],
                'csp_connect_extra' => [],
                'hsts_max_age' => 0,
            ],
            'ratelimit' => [
                // 既有用例保持原行为；限流用例显式开启
                'create_max' => 0,
                'create_window_seconds' => 60,
            ],
            'privacy' => [
                'store_full_referer' => false,
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
        ];
    }
}
