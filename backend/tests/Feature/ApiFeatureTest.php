<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * API 全链路 Feature 测试（Router → Controller → Service → 内存仓库）。
 * 断言全部对齐原 Node 后端行为。
 */
final class ApiFeatureTest extends TestCase
{
    private InMemoryUrlRepository $repository;

    private App $app;

    protected function setUp(): void
    {
        $this->repository = new InMemoryUrlRepository();
        $this->app = TestApp::create($this->repository);
    }

    public function testCreateShortUrlReturnsLegacyPayload(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'));

        self::assertSame(200, $response->status());
        self::assertSame('application/json; charset=utf-8', $response->header('content-type'));
        self::assertSame(['url' => 'https://example.com', 'code' => 'S'], $response->decodedJson());
        self::assertSame('https://example.com', $this->repository->map['S'] ?? null);
    }

    public function testApiAliasCreatesSameShortUrl(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/api/url', '{"url":"https://example.com"}'));

        self::assertSame(200, $response->status());
        self::assertSame(['url' => 'https://example.com', 'code' => 'S'], $response->decodedJson());
    }

    public function testCreateRejectsInvalidUrlWithLegacyMessage(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url', '{"url":"ftp://example.com"}'));

        self::assertSame(400, $response->status());
        self::assertSame(['error' => 'Incorrect URL format'], $response->decodedJson());
    }

    public function testCreateRejectsMissingUrlField(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url', '{}'));

        self::assertSame(400, $response->status());
        self::assertSame(['error' => 'Incorrect URL format'], $response->decodedJson());
    }

    public function testCreateRejectsInvalidJsonBody(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url', '{invalid json'));

        self::assertSame(400, $response->status());
    }

    public function testCreateRejectsEmptyBody(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url'));

        self::assertSame(400, $response->status());
    }

    public function testRedirectLegacyData(): void
    {
        $this->repository->seed(100, ['abc' => 'https://example.com']);

        $response = $this->app->handle(TestApp::request('GET', '/abc'));

        self::assertSame(302, $response->status());
        self::assertSame('https://example.com', $response->header('location'));
    }

    public function testRedirectUnknownCodeReturnsLegacy404(): void
    {
        $response = $this->app->handle(TestApp::request('GET', '/unknown'));

        self::assertSame(404, $response->status());
        self::assertSame(['error' => 'Unknown URL'], $response->decodedJson());
    }

    public function testGetUrlPathFallsThroughToLegacyLookup(): void
    {
        // 原项目：GET /url 不匹配 POST /url，落入 GET /:code → Redis 查不到 → 404
        $response = $this->app->handle(TestApp::request('GET', '/url'));

        self::assertSame(404, $response->status());
        self::assertSame(['error' => 'Unknown URL'], $response->decodedJson());
    }

    public function testPostOnCodePathIsMethodNotAllowed(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/abc'));

        self::assertSame(405, $response->status());
        self::assertSame('GET', $response->header('allow'));
    }

    public function testGetOnApiUrlIsMethodNotAllowed(): void
    {
        $response = $this->app->handle(TestApp::request('GET', '/api/url'));

        self::assertSame(405, $response->status());
    }

    public function testMultiSegmentPathReturnsNotFound(): void
    {
        $response = $this->app->handle(TestApp::request('GET', '/a/b'));

        self::assertSame(404, $response->status());
        self::assertSame(['error' => 'Not Found'], $response->decodedJson());
    }

    public function testTrailingSlashTreatedSameAsExpress(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url/', '{"url":"https://example.com"}'));

        self::assertSame(200, $response->status());
    }

    public function testUnicodeUrlIsStoredNormalizedAndRedirects(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/中文"}'));

        self::assertSame(200, $response->status());
        self::assertSame('https://example.com/%E4%B8%AD%E6%96%87', $response->decodedJson()['url'] ?? null);

        $code = (string) ($response->decodedJson()['code'] ?? '');
        $redirect = $this->app->handle(TestApp::request('GET', '/'.$code));

        self::assertSame(302, $redirect->status());
        self::assertSame('https://example.com/%E4%B8%AD%E6%96%87', $redirect->header('location'));
    }

    public function testConcurrentStyleSequentialIdsNeverCollide(): void
    {
        $seen = [];
        for ($i = 0; $i < 50; $i++) {
            $response = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/'.$i.'"}'));
            $code = (string) ($response->decodedJson()['code'] ?? '');
            self::assertArrayNotHasKey($code, $seen, '短码不得重复');
            $seen[$code] = true;
        }

        self::assertCount(50, $this->repository->map);
    }
}
