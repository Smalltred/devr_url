<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\InMemoryApiKeyRepository;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemorySettingsRepository;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * 开放 API 与 Key 管理 Feature 测试：创建/重置/删除、Bearer 与 X-API-Key 鉴权、
 * 明文仅返回一次、重置后旧 Key 失效、开放 API 不受 require_login 门控影响。
 */
final class ApiKeysFeatureTest extends TestCase
{
    private InMemoryUrlRepository $repository;

    private InMemoryApiKeyRepository $keyRepository;

    private App $app;

    protected function setUp(): void
    {
        $this->repository = new InMemoryUrlRepository();
        $this->keyRepository = new InMemoryApiKeyRepository();
        $this->app = TestApp::create(
            $this->repository,
            new InMemoryClickRepository(),
            new InMemoryAuthRepository(),
            new InMemorySettingsRepository(),
            $this->keyRepository,
        );
    }

    public function testAdminKeyEndpointsRequireAuth(): void
    {
        self::assertSame(401, $this->app->handle(TestApp::request('GET', '/api/admin/keys'))->status());
        self::assertSame(401, $this->app->handle(TestApp::request('POST', '/api/admin/keys', '{"name":"ci"}'))->status());
        self::assertSame(401, $this->app->handle(TestApp::request('POST', '/api/admin/keys/1/reset'))->status());
        self::assertSame(401, $this->app->handle(TestApp::request('DELETE', '/api/admin/keys/1'))->status());
    }

    public function testCreateKeyReturnsPlaintextOnce(): void
    {
        $token = $this->loginToken();
        $created = $this->createKey($token, 'ci');

        $body = $created->decodedJson() ?? [];
        self::assertSame(200, $created->status());
        self::assertSame(1, $body['id'] ?? 0);
        self::assertSame('ci', $body['name'] ?? '');
        $key = (string) ($body['key'] ?? '');
        self::assertMatchesRegularExpression('/^devr_[0-9a-f]{32}$/', $key, '明文 Key 格式：devr_ + 32 位十六进制');
        self::assertSame(substr($key, 0, 12), $body['prefix'] ?? '');

        // 列表只暴露前缀，绝不含明文与哈希
        $list = $this->fetchKeys($token);
        self::assertCount(1, $list);
        self::assertSame('ci', $list[0]['name']);
        self::assertSame(substr($key, 0, 12), $list[0]['prefix']);
        $encoded = (string) json_encode($list);
        self::assertStringNotContainsString($key, $encoded, '列表不得泄露明文 Key');
        self::assertStringNotContainsString(hash('sha256', $key), $encoded, '列表不得泄露 Key 哈希');
    }

    public function testCreateKeyValidatesName(): void
    {
        $token = $this->loginToken();

        $empty = $this->createKey($token, '');
        self::assertSame(400, $empty->status());

        $notString = $this->app->handle(
            TestApp::request('POST', '/api/admin/keys', '{"name":123}', TestApp::cookieHeader($token)),
        );
        self::assertSame(400, $notString->status());
    }

    public function testOpenShortenWithBearerKey(): void
    {
        $key = $this->createKeyAndTake('ci');

        $response = $this->app->handle(TestApp::request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com/open"}',
            ['authorization' => 'Bearer '.$key],
        ));

        $body = $response->decodedJson() ?? [];
        self::assertSame(200, $response->status());
        self::assertSame('https://example.com/open', $body['url'] ?? '');
        self::assertTrue($this->repository->exists((string) ($body['code'] ?? 'not-a-code')));

        // 最近使用时间被记录
        $list = $this->fetchKeys($this->loginToken());
        self::assertNotNull($list[0]['last_used_at']);
    }

    public function testOpenShortenWithXApiKeyHeader(): void
    {
        $key = $this->createKeyAndTake('header-style');

        $response = $this->app->handle(TestApp::request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com/x"}',
            ['x-api-key' => $key],
        ));

        self::assertSame(200, $response->status());
    }

    public function testOpenShortenRejectsMissingOrInvalidKey(): void
    {
        $missing = $this->app->handle(TestApp::request('POST', '/api/open/shorten', '{"url":"https://example.com"}'));
        self::assertSame(401, $missing->status());
        self::assertSame('Invalid API Key', $missing->decodedJson()['error'] ?? '');

        $invalid = $this->app->handle(TestApp::request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com"}',
            ['authorization' => 'Bearer devr_ffffffffffffffffffffffffffffffff'],
        ));
        self::assertSame(401, $invalid->status());

        // 登录态不能替代 API Key
        $token = $this->loginToken();
        $withSession = $this->app->handle(
            TestApp::request('POST', '/api/open/shorten', '{"url":"https://example.com"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(401, $withSession->status());
    }

    public function testOpenShortenValidatesUrl(): void
    {
        $key = $this->createKeyAndTake('ci');

        $response = $this->app->handle(TestApp::request(
            'POST',
            '/api/open/shorten',
            '{"url":"ftp://example.com"}',
            ['authorization' => 'Bearer '.$key],
        ));

        self::assertSame(400, $response->status());
        self::assertSame('Incorrect URL format', $response->decodedJson()['error'] ?? '');
    }

    public function testResetKeyInvalidatesOldKeyAndKeepsRow(): void
    {
        $token = $this->loginToken();
        $created = $this->createKey($token, 'leaked');
        $oldKey = (string) ($created->decodedJson()['key'] ?? '');

        $reset = $this->app->handle(
            TestApp::request('POST', '/api/admin/keys/1/reset', null, TestApp::cookieHeader($token)),
        );
        $resetBody = $reset->decodedJson() ?? [];
        self::assertSame(200, $reset->status());
        $newKey = (string) ($resetBody['key'] ?? '');
        self::assertMatchesRegularExpression('/^devr_[0-9a-f]{32}$/', $newKey);
        self::assertNotSame($oldKey, $newKey);
        self::assertSame('leaked', $resetBody['name'] ?? '');

        // 旧 Key 失效，新 Key 可用
        self::assertSame(401, $this->openShorten($oldKey)->status());
        self::assertSame(200, $this->openShorten($newKey)->status());

        // 行仍在，名称不变
        $list = $this->fetchKeys($token);
        self::assertCount(1, $list);
        self::assertSame('leaked', $list[0]['name']);

        // 不存在的 Key
        $missing = $this->app->handle(
            TestApp::request('POST', '/api/admin/keys/99/reset', null, TestApp::cookieHeader($token)),
        );
        self::assertSame(404, $missing->status());
        self::assertSame('API Key 不存在', $missing->decodedJson()['error'] ?? '');
    }

    public function testDeleteKeyRevokesImmediately(): void
    {
        $token = $this->loginToken();
        $key = $this->createKeyAndTake('temp');

        $deleted = $this->app->handle(
            TestApp::request('DELETE', '/api/admin/keys/1', null, TestApp::cookieHeader($token)),
        );
        self::assertSame(200, $deleted->status());
        self::assertSame(['ok' => true], $deleted->decodedJson());

        self::assertSame(401, $this->openShorten($key)->status());
        self::assertSame([], $this->fetchKeys($token));

        $missing = $this->app->handle(
            TestApp::request('DELETE', '/api/admin/keys/1', null, TestApp::cookieHeader($token)),
        );
        self::assertSame(404, $missing->status());
    }

    public function testOpenApiIgnoresRequireLoginGate(): void
    {
        $key = $this->createKeyAndTake('ci');
        $token = $this->loginToken();

        // 开启「创建短链需要登录」
        $this->app->handle(TestApp::request(
            'PUT',
            '/api/admin/settings',
            '{"require_login":true}',
            TestApp::cookieHeader($token),
        ));

        // 浏览器公开接口被拦
        self::assertSame(401, $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'))->status());

        // 开放 API 凭有效 Key 不受影响
        self::assertSame(200, $this->openShorten($key)->status());
    }

    private function loginToken(): string
    {
        $login = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));

        return self::tokenFrom((string) $login->header('set-cookie'));
    }

    private function createKey(string $token, string $name): \App\Http\Response
    {
        return $this->app->handle(
            TestApp::request('POST', '/api/admin/keys', '{"name":"'.$name.'"}', TestApp::cookieHeader($token)),
        );
    }

    private function createKeyAndTake(string $name): string
    {
        $response = $this->createKey($this->loginToken(), $name);

        return (string) ($response->decodedJson()['key'] ?? '');
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchKeys(string $token): array
    {
        $body = $this->app->handle(
            TestApp::request('GET', '/api/admin/keys', null, TestApp::cookieHeader($token)),
        )->decodedJson();
        $items = is_array($body) ? ($body['items'] ?? null) : null;

        return is_array($items) ? array_values($items) : [];
    }

    private function openShorten(string $key): \App\Http\Response
    {
        return $this->app->handle(TestApp::request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com/probe"}',
            ['authorization' => 'Bearer '.$key],
        ));
    }

    private static function tokenFrom(string $cookie): string
    {
        if (preg_match('/admin_token=([^;]+)/', $cookie, $matches) !== 1) {
            return '';
        }

        return $matches[1];
    }
}
