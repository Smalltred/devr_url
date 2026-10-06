<?php

declare(strict_types=1);

namespace Tests\Security;

use App\Foundation\App;
use App\Http\Request;
use App\Security\SecurityHeaders;
use App\Validation\UrlValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\InMemoryApiKeyRepository;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemoryRequestThrottleRepository;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * 安全回归测试：把审计中确认的问题固化为断言，防止回归。
 *
 * 覆盖：
 *  - 未登录访问管理端接口一律 401；
 *  - 跨站写操作被 CSRF 来源校验拒绝（403），同源放行；
 *  - 请求体与 URL 超限返回 413；
 *  - 创建类接口按 IP 限流（429）；
 *  - 客户端 IP 在路由参数注入后仍然保留（限流分桶与独立访客都依赖它）；
 *  - 安全响应头与 CSP 内联脚本哈希；
 *  - 短码/短链的输入校验与危险 scheme 拒绝；
 *  - API Key 仅存哈希、重置与删除后立即失效。
 */
final class SecurityTest extends TestCase
{
    private InMemoryUrlRepository $urls;

    private InMemoryClickRepository $clicks;

    private InMemoryAuthRepository $auth;

    protected function setUp(): void
    {
        $this->urls = new InMemoryUrlRepository();
        $this->clicks = new InMemoryClickRepository();
        $this->auth = new InMemoryAuthRepository();
    }

    // ---------------------------------------------------------------- 认证与授权

    /**
     * 未登录访问全部管理端接口必须 401，且不能返回 200。
     *
     * @return iterable<string, array{string, string}>
     */
    public static function adminEndpointProvider(): iterable
    {
        yield 'overview' => ['GET', '/api/admin/overview'];
        yield 'links' => ['GET', '/api/admin/links'];
        yield 'link update' => ['PUT', '/api/admin/links/abc'];
        yield 'link delete' => ['DELETE', '/api/admin/links/abc'];
        yield 'link stats' => ['GET', '/api/admin/links/abc/stats'];
        yield 'settings read' => ['GET', '/api/admin/settings'];
        yield 'settings write' => ['PUT', '/api/admin/settings'];
        yield 'password change' => ['POST', '/api/admin/settings/password'];
        yield 'keys list' => ['GET', '/api/admin/keys'];
        yield 'key create' => ['POST', '/api/admin/keys'];
        yield 'key reset' => ['POST', '/api/admin/keys/1/reset'];
        yield 'key delete' => ['DELETE', '/api/admin/keys/1'];
    }

    #[DataProvider('adminEndpointProvider')]
    public function testAdminEndpointsRejectAnonymous(string $method, string $path): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request($method, $path, '{}'));

        self::assertSame(401, $response->status(), $method.' '.$path.' 未登录必须 401');
    }

    public function testForgedCookieIsRejected(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(TestApp::request(
            'GET',
            '/api/admin/overview',
            null,
            TestApp::cookieHeader(str_repeat('a', 64)),
        ));

        self::assertSame(401, $response->status());
    }

    // ---------------------------------------------------------------- CSRF

    public function testCrossSiteWriteIsRejected(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/keys',
            '{"name":"csrf"}',
            ['origin' => 'https://evil.example', 'host' => TestApp::TEST_HOST, 'cookie' => 'admin_token=x'],
        ));

        self::assertSame(403, $response->status());
        self::assertSame(['error' => 'Cross-site request rejected'], $response->decodedJson());
    }

    public function testWriteWithoutOriginOrRefererIsRejectedByDefault(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(new Request(
            'POST',
            '/api/admin/keys',
            '{"name":"no-origin"}',
            [],
            ['host' => TestApp::TEST_HOST, 'content-type' => 'application/json'],
        ));

        self::assertSame(403, $response->status());
    }

    public function testSameOriginWriteIsAllowed(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/keys',
            '{"name":"same-origin"}',
            TestApp::cookieHeader($token),
        ));

        self::assertSame(200, $response->status());
    }

    public function testRefererWithoutOriginIsAcceptedWhenSameOrigin(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/keys',
            '{"name":"referer-only"}',
            array_merge(TestApp::cookieHeader($token), [
                'referer' => 'http://'.TestApp::TEST_HOST.'/admin',
                'origin' => '',
            ]),
        ));

        self::assertSame(200, $response->status());
    }

    public function testCrossSiteRefererIsRejected(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/keys',
            '{"name":"evil-referer"}',
            array_merge(TestApp::cookieHeader($token), [
                'referer' => 'https://evil.example/form',
                'origin' => '',
            ]),
        ));

        self::assertSame(403, $response->status());
    }

    public function testNullOriginIsRejected(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/keys',
            '{"name":"null-origin"}',
            array_merge(TestApp::cookieHeader($token), ['origin' => 'null']),
        ));

        self::assertSame(403, $response->status());
    }

    public function testPublicCreationRequiresSameOriginToo(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(TestApp::request(
            'POST',
            '/url',
            '{"url":"https://example.com"}',
            ['origin' => 'https://evil.example'],
        ));

        self::assertSame(403, $response->status());
    }

    public function testGetRequestIsNotBlockedByCsrfGuard(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(TestApp::request(
            'GET',
            '/api/auth/me',
            null,
            ['origin' => 'https://evil.example'],
        ));

        self::assertSame(200, $response->status());
    }

    /**
     * 开放 API 面向脚本客户端，它们不会发送 Origin/Referer。
     * 显式 API Key 头不是环境凭据（跨站表单无法设置自定义头），因此不应被 CSRF 校验拦截。
     */
    public function testApiKeyRequestWithoutOriginIsNotBlockedByCsrfGuard(): void
    {
        $keys = new InMemoryApiKeyRepository();
        $keys->seed('devr_scriptclient', 'ci');
        $app = TestApp::create($this->urls, $this->clicks, $this->auth, null, $keys);

        // 刻意不带 Origin/Referer，模拟文档中的 curl / SDK 调用
        $response = $app->handle(new Request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com"}',
            [],
            ['host' => TestApp::TEST_HOST, 'content-type' => 'application/json', 'x-api-key' => 'devr_scriptclient'],
        ));

        self::assertSame(200, $response->status(), '带 API Key 的脚本调用不应被 CSRF 校验拦截');
    }

    public function testBearerKeyWithoutOriginIsNotBlockedByCsrfGuard(): void
    {
        $keys = new InMemoryApiKeyRepository();
        $keys->seed('devr_bearerclient', 'ci');
        $app = TestApp::create($this->urls, $this->clicks, $this->auth, null, $keys);

        $response = $app->handle(new Request(
            'POST',
            '/api/open/shorten',
            '{"url":"https://example.com"}',
            [],
            [
                'host' => TestApp::TEST_HOST,
                'content-type' => 'application/json',
                'authorization' => 'Bearer devr_bearerclient',
            ],
        ));

        self::assertSame(200, $response->status());
    }

    /**
     * 例外只针对显式凭据头：管理端仅凭 Cookie 的跨站写操作仍必须被拦下。
     */
    public function testExplicitCredentialExemptionDoesNotWeakenCookieFlow(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/keys',
            '{"name":"still-blocked"}',
            array_merge(TestApp::cookieHeader($token), ['origin' => 'https://evil.example']),
        ));

        self::assertSame(403, $response->status());
    }

    public function testPublicCreationWithoutOriginStillRejected(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(new Request(
            'POST',
            '/url',
            '{"url":"https://example.com"}',
            [],
            ['host' => TestApp::TEST_HOST, 'content-type' => 'application/json'],
        ));

        self::assertSame(403, $response->status(), '公开创建接口无凭据头时不得豁免来源校验');
    }

    // ---------------------------------------------------------------- 请求体与 URL 上限

    public function testOversizedRequestBodyIsRejected(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $body = json_encode(['url' => 'https://example.com/'.str_repeat('a', 20000)]);
        $response = $app->handle(TestApp::request('POST', '/url', (string) $body));

        self::assertSame(413, $response->status());
        self::assertSame(['error' => 'Payload Too Large'], $response->decodedJson());
    }

    public function testOversizedUrlIsRejectedEvenUnderBodyLimit(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        // 构造长度介于 URL 上限（2048）与请求体上限（16384）之间：必须被 URL 规则拦下
        $body = json_encode(['url' => 'https://example.com/'.str_repeat('a', 4000)]);
        $response = $app->handle(TestApp::request('POST', '/url', (string) $body));

        self::assertSame(413, $response->status());
        self::assertSame([], $this->urls->map, '超长 URL 不得入库');
    }

    public function testMaxLengthUrlIsAccepted(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $prefix = 'https://example.com/';
        $url = $prefix.str_repeat('a', UrlValidator::MAX_LENGTH - strlen($prefix));
        $response = $app->handle(TestApp::request('POST', '/url', (string) json_encode(['url' => $url])));

        self::assertSame(200, $response->status());
    }

    // ---------------------------------------------------------------- 创建限流

    public function testCreationIsRateLimitedPerIp(): void
    {
        $throttles = new InMemoryRequestThrottleRepository();
        $app = TestApp::create(
            $this->urls,
            $this->clicks,
            $this->auth,
            null,
            null,
            $throttles,
            TestApp::configWithRateLimit(3, 60),
        );

        $statuses = [];
        for ($i = 0; $i < 5; $i++) {
            $statuses[] = $app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'))->status();
        }

        self::assertSame([200, 200, 200, 429, 429], $statuses, '超过窗口配额必须 429');
    }

    public function testRateLimitUsesClientIpNotSharedBucket(): void
    {
        $throttles = new InMemoryRequestThrottleRepository();
        $app = TestApp::create(
            $this->urls,
            $this->clicks,
            $this->auth,
            null,
            null,
            $throttles,
            TestApp::configWithRateLimit(1, 60),
        );

        $first = $app->handle(new Request(
            'POST',
            '/url',
            '{"url":"https://example.com"}',
            [],
            ['host' => TestApp::TEST_HOST, 'origin' => 'http://'.TestApp::TEST_HOST, 'content-type' => 'application/json'],
            [],
            '203.0.113.1',
        ));
        $second = $app->handle(new Request(
            'POST',
            '/url',
            '{"url":"https://example.com"}',
            [],
            ['host' => TestApp::TEST_HOST, 'origin' => 'http://'.TestApp::TEST_HOST, 'content-type' => 'application/json'],
            [],
            '203.0.113.2',
        ));
        $third = $app->handle(new Request(
            'POST',
            '/url',
            '{"url":"https://example.com"}',
            [],
            ['host' => TestApp::TEST_HOST, 'origin' => 'http://'.TestApp::TEST_HOST, 'content-type' => 'application/json'],
            [],
            '203.0.113.1',
        ));

        self::assertSame(200, $first->status());
        self::assertSame(200, $second->status(), '不同 IP 不应共享配额');
        self::assertSame(429, $third->status(), '同一 IP 再次请求应被限流');
    }

    public function testOpenApiIsRateLimitedToo(): void
    {
        $apiKeys = new InMemoryApiKeyRepository();
        $key = 'devr_'.bin2hex(random_bytes(16));
        $apiKeys->seed($key, 'audit');

        $app = TestApp::create(
            $this->urls,
            $this->clicks,
            $this->auth,
            null,
            $apiKeys,
            new InMemoryRequestThrottleRepository(),
            TestApp::configWithRateLimit(1, 60),
        );

        $payload = '{"url":"https://example.com"}';
        $headers = ['x-api-key' => $key];
        $first = $app->handle(TestApp::request('POST', '/api/open/shorten', $payload, $headers));
        $second = $app->handle(TestApp::request('POST', '/api/open/shorten', $payload, $headers));

        self::assertSame(200, $first->status());
        self::assertSame(429, $second->status());
    }

    // ---------------------------------------------------------------- 客户端 IP 保留

    public function testClientIpSurvivesRouteParameterInjection(): void
    {
        $request = new Request('POST', '/url', '{}', [], [], [], '198.51.100.9');

        self::assertSame('198.51.100.9', $request->clientIp());
        self::assertSame('198.51.100.9', $request->withParams(['code' => 'abc'])->clientIp(), 'withParams 必须保留客户端 IP');
    }

    public function testRedirectRecordingKeepsIpHashWhenIpKnown(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $this->urls->seed(1, ['abc' => 'https://example.com']);

        $app->handle(new Request(
            'GET',
            '/abc',
            '',
            [],
            ['host' => TestApp::TEST_HOST, 'user-agent' => 'Mozilla/5.0'],
            [],
            '198.51.100.9',
        ));

        self::assertCount(1, $this->clicks->clicks);
        self::assertNotNull($this->clicks->clicks[0]['ip_hash'], '带 IP 的跳转必须写入独立访客哈希');
    }

    // ---------------------------------------------------------------- 响应头

    public function testSecurityHeadersArePresentOnApiResponses(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request('GET', '/api/auth/me'));

        self::assertSame('nosniff', $response->header('x-content-type-options'));
        self::assertSame('DENY', $response->header('x-frame-options'));
        self::assertSame('strict-origin-when-cross-origin', $response->header('referrer-policy'));
        self::assertNotNull($response->header('content-security-policy'));
        self::assertNotNull($response->header('permissions-policy'));
    }

    public function testSecurityHeadersArePresentOnErrorResponses(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request('GET', '/api/admin/overview'));

        self::assertSame(401, $response->status());
        self::assertSame('nosniff', $response->header('x-content-type-options'));
    }

    public function testHstsIsNotSentForPlainHttp(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request('GET', '/api/auth/me'));

        self::assertNull($response->header('strict-transport-security'), 'HTTP 请求不得下发 HSTS');
    }

    public function testCspAllowsInlineScriptsByHashForHtmlResponses(): void
    {
        // /admin 返回 HTML 面板：内联脚本必须按内容哈希放行，否则 CSP 会打断 SPA
        $page = '<!DOCTYPE html><html><head><script>var a=1;</script></head><body></body></html>';
        $path = TestApp::distIndexPath();
        file_put_contents($path, $page);

        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request('GET', '/admin'));

        $csp = (string) $response->header('content-security-policy');
        $expected = "'sha256-".base64_encode(hash('sha256', 'var a=1;', true))."'";

        self::assertStringContainsString($expected, $csp, 'CSP 必须包含 HTML 内联脚本哈希');
        self::assertStringContainsString("frame-ancestors 'none'", $csp);
        self::assertStringContainsString("object-src 'none'", $csp);
    }

    public function testInlineScriptHashIgnoresExternalScripts(): void
    {
        $hashes = SecurityHeaders::inlineScriptHashes('<script src="/a.js"></script><script>x()</script>');

        self::assertCount(1, $hashes);
        self::assertSame("'sha256-".base64_encode(hash('sha256', 'x()', true))."'", $hashes[0]);
    }

    // ---------------------------------------------------------------- 输入校验

    /**
     * @return iterable<string, array{string}>
     */
    public static function maliciousUrlProvider(): iterable
    {
        yield 'javascript scheme' => ['javascript:alert(1)'];
        yield 'data scheme' => ['data:text/html,<script>alert(1)</script>'];
        yield 'file scheme' => ['file:///etc/passwd'];
        yield 'ftp scheme' => ['ftp://example.com'];
        yield 'protocol relative' => ['//evil.example'];
        yield 'CRLF in url' => ["https://example.com/\r\nSet-Cookie:a=b"];
        yield 'encoded CRLF header injection' => ['https://example.com/%0d%0aSet-Cookie:a=b'];
        yield 'XSS payload in path' => ['https://example.com/"><img src=x onerror=alert(1)>'];
        yield 'whitespace inside' => ['https://exa mple.com'];
    }

    #[DataProvider('maliciousUrlProvider')]
    public function testMaliciousUrlsAreRejectedOrEncoded(string $url): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request('POST', '/url', (string) json_encode(['url' => $url])));

        if ($response->status() === 200) {
            // 被接受时（如 %0d%0a 被当作普通路径字符）必须按原样存字符串、且不得出现在响应头里
            $payload = $response->decodedJson();
            $code = (string) ($payload['code'] ?? '');
            $redirect = $app->handle(TestApp::request('GET', '/'.$code));

            self::assertSame(302, $redirect->status());
            self::assertStringNotContainsString("\r", (string) $redirect->header('location'));
            self::assertStringNotContainsString("\n", (string) $redirect->header('location'));
        } else {
            self::assertContains($response->status(), [400, 413]);
        }
    }

    public function testRedirectLocationNeverAllowsHeaderInjection(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        // 直接向仓库塞入含 CRLF 的脏数据，模拟历史数据被污染的最坏情况
        $this->urls->seed(1, ['abc' => "https://example.com/\r\nSet-Cookie:evil=1"]);

        $response = $app->handle(TestApp::request('GET', '/abc'));

        // Response::redirect 拒绝带 CRLF 的 Location，异常被 App 兜底为 500：
        // 关键是绝不能输出被污染的 location 头
        self::assertSame(500, $response->status());
        self::assertNull($response->header('location'));
    }

    public function testUrlWithControlCharactersCannotBeStored(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);

        $response = $app->handle(TestApp::request(
            'POST',
            '/url',
            (string) json_encode(['url' => "https://example.com/\r\nSet-Cookie:evil=1"]),
        ));

        self::assertSame(400, $response->status(), '含换行的 URL 必须被输入校验拒绝');
        self::assertSame([], $this->urls->map);
    }

    public function testReservedAndInvalidShortCodesAreRejected(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));
        $this->urls->seed(1, ['abc' => 'https://example.com']);

        // 保留码 /admin 不可被占用
        $reserved = $app->handle(TestApp::request(
            'PUT',
            '/api/admin/links/abc',
            '{"code":"admin"}',
            TestApp::cookieHeader($token),
        ));
        self::assertSame(400, $reserved->status());

        // 非字母数字短码（含 XSS payload）不可写入
        $payload = $app->handle(TestApp::request(
            'PUT',
            '/api/admin/links/abc',
            '{"code":"<img src=x onerror=alert(1)>"}',
            TestApp::cookieHeader($token),
        ));
        self::assertSame(400, $payload->status());
    }

    public function testShortCodeLongerThanLimitIsRejected(): void
    {
        $token = $this->login($app = TestApp::create($this->urls, $this->clicks, $this->auth));
        $this->urls->seed(1, ['abc' => 'https://example.com']);

        $response = $app->handle(TestApp::request(
            'PUT',
            '/api/admin/links/abc',
            (string) json_encode(['code' => str_repeat('a', 33)]),
            TestApp::cookieHeader($token),
        ));

        self::assertSame(400, $response->status());
    }

    // ---------------------------------------------------------------- API Key 安全

    public function testApiKeyIsStoredAsHashOnly(): void
    {
        $keys = new InMemoryApiKeyRepository();
        $service = new \App\Services\ApiKeyService($keys, new \App\Support\Logger(sys_get_temp_dir().'/short-url-security-logs'));

        $created = $service->create('audit-key');
        $plain = (string) $created['key'];

        self::assertStringStartsWith('devr_', $plain);

        $rows = $keys->rawRows();
        self::assertCount(1, $rows);
        self::assertSame(hash('sha256', $plain), $rows[0]['key_hash'], '库存必须是 sha256 哈希');
        self::assertNotSame($plain, $rows[0]['key_hash'], '库存不得是明文 Key');
        self::assertSame(substr($plain, 0, 12), $rows[0]['prefix'], '列表只暴露展示用前缀');
        self::assertSame($rows[0]['id'], $keys->findIdByKeyHash(hash('sha256', $plain)), '必须可用 sha256 反查');
    }

    public function testResetInvalidatesOldKeyImmediately(): void
    {
        $keys = new InMemoryApiKeyRepository();
        $keys->seed('devr_oldkey', 'audit');
        $urls = $this->urls;
        $app = TestApp::create($urls, $this->clicks, $this->auth, null, $keys);
        $token = $this->login($app);

        $reset = $app->handle(TestApp::request('POST', '/api/admin/keys/1/reset', null, TestApp::cookieHeader($token)));
        $newKey = (string) ($reset->decodedJson()['key'] ?? '');

        self::assertSame(200, $reset->status());
        self::assertNotSame('', $newKey);

        $old = $app->handle(TestApp::request('POST', '/api/open/shorten', '{"url":"https://example.com"}', ['x-api-key' => 'devr_oldkey']));
        $fresh = $app->handle(TestApp::request('POST', '/api/open/shorten', '{"url":"https://example.com"}', ['x-api-key' => $newKey]));

        self::assertSame(401, $old->status(), '重置后旧 Key 必须立即失效');
        self::assertSame(200, $fresh->status(), '重置后新 Key 必须可用');
    }

    public function testDeletedKeyStopsWorking(): void
    {
        $keys = new InMemoryApiKeyRepository();
        $keys->seed('devr_temp', 'audit');
        $app = TestApp::create($this->urls, $this->clicks, $this->auth, null, $keys);
        $token = $this->login($app);

        $before = $app->handle(TestApp::request('POST', '/api/open/shorten', '{"url":"https://example.com"}', ['x-api-key' => 'devr_temp']));
        self::assertSame(200, $before->status());

        $app->handle(TestApp::request('DELETE', '/api/admin/keys/1', null, TestApp::cookieHeader($token)));

        $after = $app->handle(TestApp::request('POST', '/api/open/shorten', '{"url":"https://example.com"}', ['x-api-key' => 'devr_temp']));
        self::assertSame(401, $after->status(), '删除后 Key 必须立即失效');
    }

    public function testSessionCookieIsHardened(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request(
            'POST',
            '/api/auth/login',
            '{"username":"admin","password":"secret123"}',
        ));

        $cookie = (string) $response->header('set-cookie');
        self::assertStringContainsString('HttpOnly', $cookie);
        self::assertStringContainsString('SameSite=Strict', $cookie);
        self::assertStringContainsString('Path=/', $cookie);
    }

    public function testSessionCookieIsSecureBehindHttpsProxy(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $response = $app->handle(TestApp::request(
            'POST',
            '/api/auth/login',
            '{"username":"admin","password":"secret123"}',
            ['x-forwarded-proto' => 'https'],
        ));

        self::assertStringContainsString('; Secure', (string) $response->header('set-cookie'));
    }

    public function testPasswordChangeRevokesEverySession(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $first = $this->login($app);
        $second = $this->login($app);

        $change = $app->handle(TestApp::request(
            'POST',
            '/api/admin/settings/password',
            '{"current_password":"secret123","new_password":"BrandNewPass1"}',
            TestApp::cookieHeader($second),
        ));
        self::assertSame(200, $change->status());

        foreach ([$first, $second] as $token) {
            $response = $app->handle(TestApp::request('GET', '/api/admin/overview', null, TestApp::cookieHeader($token)));
            self::assertSame(401, $response->status(), '改密后所有旧 Session 必须失效');
        }
    }

    public function testWeakNewPasswordIsRejected(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $token = $this->login($app);

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/settings/password',
            '{"current_password":"secret123","new_password":"short"}',
            TestApp::cookieHeader($token),
        ));

        self::assertSame(400, $response->status());
    }

    public function testWrongCurrentPasswordIsRejected(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $token = $this->login($app);

        $response = $app->handle(TestApp::request(
            'POST',
            '/api/admin/settings/password',
            '{"current_password":"wrong","new_password":"BrandNewPass1"}',
            TestApp::cookieHeader($token),
        ));

        self::assertSame(401, $response->status());
    }

    // ---------------------------------------------------------------- 隐私

    public function testFullRefererIsNotPersistedByDefault(): void
    {
        $app = TestApp::create($this->urls, $this->clicks, $this->auth);
        $this->urls->seed(1, ['abc' => 'https://example.com']);

        $app->handle(TestApp::request('GET', '/abc', null, [
            'referer' => 'https://mail.example.com/inbox?token=SECRET-TOKEN-123',
        ]));

        $click = $this->clicks->clicks[0];
        self::assertNull($click['referer'], '默认不得落库完整 Referer（可能含查询串密钥）');
        self::assertSame('mail.example.com', $click['referer_host'], '来源域名仍应保留');
    }

    private function login(App $app): string
    {
        $response = $app->handle(TestApp::request(
            'POST',
            '/api/auth/login',
            '{"username":"admin","password":"secret123"}',
        ));

        self::assertSame(200, $response->status(), '测试登录必须成功');
        $cookie = (string) $response->header('set-cookie');
        self::assertMatchesRegularExpression('/admin_token=([0-9a-f]{64})/', $cookie, '必须签发 256 位随机 token');

        return (string) preg_replace('/^admin_token=([0-9a-f]{64}).*$/s', '$1', $cookie);
    }
}
