<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\FailingCacheStore;
use Tests\Doubles\InMemoryApiKeyRepository;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryCacheStore;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemoryRequestThrottleRepository;
use Tests\Doubles\InMemorySettingsRepository;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * 短链 Memcached 缓存 Feature 测试：
 * 跳转命中缓存、写操作失效缓存、负缓存、TTL 可配置、缓存不可用时降级不中断业务。
 */
final class CacheFeatureTest extends TestCase
{
    private InMemoryUrlRepository $repository;

    private InMemoryCacheStore $cache;

    private App $app;

    protected function setUp(): void
    {
        $this->repository = new InMemoryUrlRepository();
        $this->cache = new InMemoryCacheStore();
        $this->app = TestApp::create($this->repository, null, null, null, null, null, null, $this->cache);
    }

    public function testRedirectPopulatesCacheAndSecondRedirectHitsIt(): void
    {
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        $first = $this->app->handle(TestApp::request('GET', '/abc'));
        self::assertSame(302, $first->status());
        self::assertSame('https://example.com', $first->header('location'));
        self::assertSame('https://example.com', $this->cache->data['url:abc'] ?? null, '首次跳转应回填缓存');

        $setCallsAfterFirst = $this->cache->setCalls;
        $second = $this->app->handle(TestApp::request('GET', '/abc'));

        self::assertSame(302, $second->status());
        self::assertSame('https://example.com', $second->header('location'));
        self::assertSame($setCallsAfterFirst, $this->cache->setCalls, '缓存命中时不应重复回填');
    }

    public function testCacheHitServesWithoutTouchingDatabase(): void
    {
        // 缓存中已有值，但数据库已被清空：命中缓存时不应查询数据库
        $this->cache->set('url:abc', 'https://from-cache.example.com', 300);

        $response = $this->app->handle(TestApp::request('GET', '/abc'));

        self::assertSame(302, $response->status());
        self::assertSame('https://from-cache.example.com', $response->header('location'));
    }

    public function testUnknownCodeIsNegativeCached(): void
    {
        $response = $this->app->handle(TestApp::request('GET', '/ghost'));

        self::assertSame(404, $response->status());
        self::assertArrayHasKey('url:ghost', $this->cache->data, '不存在的短码应写入负缓存');
        self::assertStringNotContainsString('https', (string) $this->cache->data['url:ghost'], '负缓存不得写入 URL');
    }

    public function testNegativeCacheEntryPreventsRepeatedLookups(): void
    {
        // 先探测一次不存在，写入负缓存
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/ghost'))->status());

        // 之后该短码被真实创建（模拟补数据），负缓存仍在有效期内
        $this->repository->seed(1, ['ghost' => 'https://example.com']);

        // 负缓存命中，仍返回 404，直到缓存过期或写操作失效（见下一个用例）
        $stillCached = $this->app->handle(TestApp::request('GET', '/ghost'))->status();
        self::assertSame(404, $stillCached);
    }

    public function testCreateInvalidatesNegativeCache(): void
    {
        // 先让该短码进入负缓存，再由正常创建流程写入（不复用 seed，以验证 save() 的失效逻辑）
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/S'))->status());
        self::assertArrayHasKey('url:S', $this->cache->data);

        $created = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'));
        self::assertSame(200, $created->status());
        self::assertArrayNotHasKey('url:S', $this->cache->data, '创建后必须清除该短码的负缓存');

        // 立刻可跳转
        $redirect = $this->app->handle(TestApp::request('GET', '/S'));
        self::assertSame(302, $redirect->status());
        self::assertSame('https://example.com', $redirect->header('location'));
    }

    public function testUpdateInvalidatesOldCodeAndNewCode(): void
    {
        $this->repository->seed(1, ['abc' => 'https://example.com']);
        // 预热缓存
        self::assertSame(302, $this->app->handle(TestApp::request('GET', '/abc'))->status());
        self::assertSame('https://example.com', $this->cache->data['url:abc'] ?? null);

        $token = $this->loginToken();
        $updated = $this->app->handle(TestApp::request(
            'PUT',
            '/api/admin/links/abc',
            '{"code":"xyz","url":"https://changed.example.com"}',
            TestApp::cookieHeader($token),
        ));

        self::assertSame(200, $updated->status());
        self::assertArrayNotHasKey('url:abc', $this->cache->data, '旧短码缓存必须失效');

        // 新短码跳转返回更新后的 URL（而非旧缓存值）
        $response = $this->app->handle(TestApp::request('GET', '/xyz'));
        self::assertSame(302, $response->status());
        self::assertSame('https://changed.example.com', $response->header('location'));
    }

    public function testDeleteInvalidatesCache(): void
    {
        $this->repository->seed(1, ['abc' => 'https://example.com']);
        self::assertSame(302, $this->app->handle(TestApp::request('GET', '/abc'))->status());

        $token = $this->loginToken();
        $deleted = $this->app->handle(TestApp::request('DELETE', '/api/admin/links/abc', null, TestApp::cookieHeader($token)));

        self::assertSame(200, $deleted->status());
        self::assertArrayNotHasKey('url:abc', $this->cache->data, '删除后缓存必须失效');
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/abc'))->status());
    }

    public function testCacheFailuresDegradeGracefully(): void
    {
        // 缓存完全不可用：跳转与创建都必须正常工作
        $app = App::create(
            TestApp::defaultConfig(),
            $this->repository,
            null,
            new InMemoryClickRepository(),
            new InMemoryAuthRepository(),
            new InMemorySettingsRepository(),
            new InMemoryApiKeyRepository(),
            new InMemoryRequestThrottleRepository(),
            new FailingCacheStore(),
        );
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        $redirect = $app->handle(TestApp::request('GET', '/abc'));
        self::assertSame(302, $redirect->status());
        self::assertSame('https://example.com', $redirect->header('location'));

        $created = $app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/new"}'));
        self::assertSame(200, $created->status());

        self::assertSame(404, $app->handle(TestApp::request('GET', '/ghost'))->status());
    }

    public function testCacheTtlIsConfigurableAndZeroDisablesCaching(): void
    {
        $settings = new InMemorySettingsRepository();
        $app = TestApp::create($this->repository, null, null, $settings, null, null, null, $this->cache);
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        // 注意：token 必须由同一个 $app 实例签发（内存登录态仓库不跨实例共享）
        $login = $app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));
        $token = self::tokenFrom((string) $login->header('set-cookie'));

        // 自定义 TTL
        $saved = $app->handle(TestApp::request(
            'PUT',
            '/api/admin/settings',
            '{"cache_ttl":600,"cache_negative_ttl":45}',
            TestApp::cookieHeader($token),
        ));
        $body = $saved->decodedJson() ?? [];
        self::assertSame(200, $saved->status());
        self::assertSame(600, $body['cache_ttl'] ?? null);
        self::assertSame(45, $body['cache_negative_ttl'] ?? null);

        // TTL 生效于实际写入
        $this->cache->data = [];
        $this->cache->setLog = [];
        $app->handle(TestApp::request('GET', '/abc'));
        self::assertSame([['key' => 'url:abc', 'ttl' => 600]], $this->cache->setLog);

        // TTL = 0 表示不缓存
        $app->handle(TestApp::request('PUT', '/api/admin/settings', '{"cache_ttl":0}', TestApp::cookieHeader($token)));
        $this->cache->data = [];
        $app->handle(TestApp::request('GET', '/abc'));
        self::assertArrayNotHasKey('url:abc', $this->cache->data, 'cache_ttl=0 时不得写入缓存');
    }

    public function testSettingsRejectInvalidCacheTtl(): void
    {
        $token = $this->loginToken();

        self::assertSame(400, $this->putSettings($token, ['cache_ttl' => -1])->status());
        self::assertSame(400, $this->putSettings($token, ['cache_ttl' => 86401])->status());
        self::assertSame(400, $this->putSettings($token, ['cache_ttl' => 'abc'])->status());
        self::assertSame(400, $this->putSettings($token, ['cache_negative_ttl' => 3601])->status());
    }

    public function testOpenApiCreationInvalidatesCache(): void
    {
        // 负缓存先落位，再通过开放 API 创建（走同一条 ShortUrlService 路径）
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/S'))->status());

        $login = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));
        $token = self::tokenFrom((string) $login->header('set-cookie'));
        $created = $this->app->handle(TestApp::request('POST', '/api/admin/keys', '{"name":"ci"}', TestApp::cookieHeader($token)));
        $key = (string) ($created->decodedJson()['key'] ?? '');

        $response = $this->app->handle(TestApp::request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com/open"}',
            ['authorization' => 'Bearer '.$key],
        ));
        self::assertSame(200, $response->status());
        self::assertArrayNotHasKey('url:S', $this->cache->data, '开放 API 创建同样必须清除负缓存');
        self::assertSame(302, $this->app->handle(TestApp::request('GET', '/S'))->status());
    }

    private function loginToken(): string
    {
        $login = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));

        return self::tokenFrom((string) $login->header('set-cookie'));
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function putSettings(string $token, array $payload): \App\Http\Response
    {
        return $this->app->handle(
            TestApp::request('PUT', '/api/admin/settings', (string) json_encode($payload), TestApp::cookieHeader($token)),
        );
    }

    private static function tokenFrom(string $cookie): string
    {
        if (preg_match('/admin_token=([^;]+)/', $cookie, $matches) !== 1) {
            return '';
        }

        return $matches[1];
    }
}
