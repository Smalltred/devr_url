<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\FailingClickRepository;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * 点击采集 Feature 测试：跳转时落一条点击（来源域名/设备/IP 匿名哈希），HEAD 与未知短码不落。
 */
final class ClickTrackingTest extends TestCase
{
    private InMemoryUrlRepository $repository;

    private InMemoryClickRepository $clicks;

    private App $app;

    protected function setUp(): void
    {
        $this->repository = new InMemoryUrlRepository();
        $this->clicks = new InMemoryClickRepository();
        $this->app = TestApp::create($this->repository, $this->clicks);
    }

    public function testRedirectRecordsClickWithRefererHostAndDevice(): void
    {
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        $response = $this->app->handle(TestApp::request('GET', '/abc', null, [
            'referer' => 'https://Google.com/search?q=x',
            'user-agent' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
        ]));

        self::assertSame(302, $response->status());
        self::assertCount(1, $this->clicks->clicks);
        $click = $this->clicks->clicks[0];
        self::assertSame('abc', $click['code']);
        self::assertSame('google.com', $click['referer_host'], '来源域名必须小写化');
        self::assertSame('mobile', $click['device']);
        self::assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $click['clicked_at']);
    }

    public function testDesktopUserAgentClassifiedAsDesktop(): void
    {
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        $this->app->handle(TestApp::request('GET', '/abc', null, [
            'user-agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        ]));

        self::assertSame('desktop', $this->clicks->clicks[0]['device']);
    }

    public function testHeadRequestDoesNotRecordClick(): void
    {
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        $response = $this->app->handle(TestApp::request('HEAD', '/abc'));

        self::assertSame(302, $response->status());
        self::assertSame([], $this->clicks->clicks);
    }

    public function testUnknownCodeDoesNotRecordClick(): void
    {
        $response = $this->app->handle(TestApp::request('GET', '/ghost'));

        self::assertSame(404, $response->status());
        self::assertSame([], $this->clicks->clicks);
    }

    public function testClickFailsSoftlyWhenStorageBroken(): void
    {
        // 记录失败只允许影响统计，不允许影响跳转
        $app = TestApp::create($this->repository, new FailingClickRepository());
        $this->repository->seed(1, ['abc' => 'https://example.com']);

        $response = $app->handle(TestApp::request('GET', '/abc'));

        self::assertSame(302, $response->status());
        self::assertSame('https://example.com', $response->header('location'));
    }
}
