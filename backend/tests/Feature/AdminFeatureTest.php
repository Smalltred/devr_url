<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use App\Http\Response;
use App\Support\Config;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * 管理后台全链路 Feature 测试：登录/会话/节流、短链列表/编辑/删除、统计接口与 /admin 面板页。
 */
final class AdminFeatureTest extends TestCase
{
    private InMemoryUrlRepository $repository;

    private InMemoryClickRepository $clicks;

    private InMemoryAuthRepository $authRepository;

    private App $app;
    protected function setUp(): void
    {
        $this->repository = new InMemoryUrlRepository();
        $this->clicks = new InMemoryClickRepository();
        $this->authRepository = new InMemoryAuthRepository();
        $this->app = TestApp::create($this->repository, $this->clicks, $this->authRepository);
        @unlink(TestApp::distIndexPath());
    }

    protected function tearDown(): void
    {
        @unlink(TestApp::distIndexPath());
    }

    public function testLoginRejectsWrongPassword(): void
    {
        $response = $this->login('admin', 'wrong');

        self::assertSame(401, $response->status());
    }

    public function testLoginRejectsNonStringCredentials(): void
    {
        $response = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":1,"password":2}'));

        self::assertSame(401, $response->status());
    }

    public function testLoginIssuesHttpOnlyCookieAndSessionWorks(): void
    {
        $response = $this->login('admin', 'secret123');

        self::assertSame(200, $response->status());
        $cookie = (string) $response->header('set-cookie');
        self::assertStringContainsString('admin_token=', $cookie);
        self::assertStringContainsString('HttpOnly', $cookie);
        self::assertStringContainsString('SameSite=Strict', $cookie);

        $token = self::tokenFrom($cookie);
        self::assertNotSame('', $token);

        $me = $this->app->handle(TestApp::request('GET', '/api/auth/me', null, TestApp::cookieHeader($token)));
        self::assertSame(['authenticated' => true, 'require_login' => false], $me->decodedJson());

        $anonymous = $this->app->handle(TestApp::request('GET', '/api/auth/me'));
        self::assertSame(['authenticated' => false, 'require_login' => false], $anonymous->decodedJson());
    }

    public function testLoginSupportsPasswordHash(): void
    {
        $config = new Config([
            'app' => ['env' => 'testing', 'debug' => false, 'url' => '', 'port' => 3001, 'dist_index' => TestApp::distIndexPath()],
            'database' => ['path' => sys_get_temp_dir().'/short-url-test.sqlite3'],
            'auth' => [
                'username' => 'admin',
                'password' => '',
                'password_hash' => password_hash('hashed-secret', PASSWORD_DEFAULT),
                'token_ttl_days' => 7,
            ],
            'logging' => ['path' => sys_get_temp_dir().'/short-url-test-logs'],
        ]);
        $app = App::create($config, $this->repository, null, $this->clicks, $this->authRepository);

        $wrong = $app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));
        self::assertSame(401, $wrong->status());

        $right = $app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"hashed-secret"}'));
        self::assertSame(200, $right->status());
    }

    public function testAdminEndpointsRequireAuth(): void
    {
        foreach (['/api/admin/overview', '/api/admin/links'] as $path) {
            $response = $this->app->handle(TestApp::request('GET', $path));
            self::assertSame(401, $response->status(), $path.' 未登录必须 401');
        }

        $response = $this->app->handle(TestApp::request('PUT', '/api/admin/links/abc', '{"url":"https://example.com"}'));
        self::assertSame(401, $response->status());

        $response = $this->app->handle(TestApp::request('DELETE', '/api/admin/links/abc'));
        self::assertSame(401, $response->status());

        $response = $this->app->handle(TestApp::request('GET', '/api/admin/links/abc/stats'));
        self::assertSame(401, $response->status());
    }

    public function testLoginThrottlesRepeatedFailures(): void
    {
        for ($i = 0; $i < 5; $i++) {
            self::assertSame(401, $this->login('admin', 'wrong')->status());
        }

        $locked = $this->login('admin', 'secret123');
        self::assertSame(429, $locked->status(), '第 6 次尝试即使密码正确也应被限流');
    }

    public function testSuccessfulLoginClearsThrottle(): void
    {
        $first = $this->login('admin', 'wrong');
        self::assertSame(401, $first->status());
        $second = $this->login('admin', 'wrong');
        self::assertSame(401, $second->status());

        $success = $this->login('admin', 'secret123');
        self::assertSame(200, $success->status());

        self::assertSame([], $this->authRepository->throttles, '登录成功后必须清除失败计数');
    }

    public function testLogoutRevokesToken(): void
    {
        $token = self::tokenFrom((string) $this->login('admin', 'secret123')->header('set-cookie'));

        $this->app->handle(TestApp::request('POST', '/api/auth/logout', null, TestApp::cookieHeader($token)));

        $me = $this->app->handle(TestApp::request('GET', '/api/auth/me', null, TestApp::cookieHeader($token)));
        self::assertSame(['authenticated' => false, 'require_login' => false], $me->decodedJson());
    }

    public function testLinksListRequiresNoAuthBypassAndPaginates(): void
    {
        for ($i = 1; $i <= 25; $i++) {
            $this->repository->save('code'.$i, 'https://example.com/'.$i);
        }
        $token = $this->loginToken();

        $page1 = $this->app->handle(TestApp::request('GET', '/api/admin/links?page=1&per_page=20', null, TestApp::cookieHeader($token)));
        self::assertSame(200, $page1->status());
        $body1 = $page1->decodedJson() ?? [];
        self::assertSame(25, $body1['total']);
        self::assertCount(20, $body1['items']);
        self::assertSame('code25', $body1['items'][0]['code'], '最新创建的排最前');

        $page2 = $this->app->handle(TestApp::request('GET', '/api/admin/links?page=2&per_page=20', null, TestApp::cookieHeader($token)));
        $body2 = $page2->decodedJson() ?? [];
        $items2 = is_array($body2['items'] ?? null) ? $body2['items'] : [];
        self::assertCount(5, $items2);
    }

    public function testLinksSearchFiltersByCodeAndUrl(): void
    {
        $this->repository->save('alpha', 'https://foo.com/a');
        $this->repository->save('beta', 'https://bar.com/b');
        $token = $this->loginToken();

        $byCode = $this->app->handle(TestApp::request('GET', '/api/admin/links?q=alpha', null, TestApp::cookieHeader($token)));
        $byCodeBody = $byCode->decodedJson() ?? [];
        self::assertSame(1, $byCodeBody['total'] ?? null);

        $byUrl = $this->app->handle(TestApp::request('GET', '/api/admin/links?q=bar.com', null, TestApp::cookieHeader($token)));
        $byUrlBody = $byUrl->decodedJson() ?? [];
        $items = is_array($byUrlBody['items'] ?? null) ? $byUrlBody['items'] : [];
        self::assertSame(1, $byUrlBody['total'] ?? null);
        self::assertSame('beta', $items[0]['code'] ?? null);
    }

    public function testListIncludesClickCounts(): void
    {
        $this->repository->save('abc', 'https://example.com');
        $this->clicks->record('abc', self::clickContext());
        $this->clicks->record('abc', self::clickContext());
        $token = $this->loginToken();

        $response = $this->app->handle(TestApp::request('GET', '/api/admin/links', null, TestApp::cookieHeader($token)));
        $item = $response->decodedJson()['items'][0] ?? [];

        self::assertSame(2, $item['clicks']);
        self::assertSame(2, $item['clicks_today']);
    }

    public function testUpdateChangesUrlOnly(): void
    {
        $this->repository->save('abc', 'https://old.example.com');
        $token = $this->loginToken();

        $response = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/abc', '{"url":"https://new.example.com"}', TestApp::cookieHeader($token)),
        );

        self::assertSame(200, $response->status());
        self::assertSame(['code' => 'abc', 'url' => 'https://new.example.com'], $response->decodedJson());
        self::assertSame('https://new.example.com', $this->repository->findByCode('abc'));
    }

    public function testUpdateChangesCodeAndKeepsRedirectWorking(): void
    {
        $this->repository->save('abc', 'https://example.com');
        $token = $this->loginToken();

        $response = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/abc', '{"code":"newcode"}', TestApp::cookieHeader($token)),
        );

        self::assertSame(200, $response->status());
        self::assertSame(['code' => 'newcode', 'url' => 'https://example.com'], $response->decodedJson());
        self::assertFalse($this->repository->exists('abc'));
        self::assertSame('https://example.com', $this->repository->findByCode('newcode'));
    }

    public function testUpdateToExistingCodeConflicts(): void
    {
        $this->repository->save('abc', 'https://example.com');
        $this->repository->save('taken', 'https://example.com/taken');
        $token = $this->loginToken();

        $response = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/abc', '{"code":"taken"}', TestApp::cookieHeader($token)),
        );

        self::assertSame(409, $response->status());
        self::assertTrue($this->repository->exists('abc'), '冲突时原短链必须保持不变');
    }

    public function testUpdateRejectsInvalidCodeAndUrl(): void
    {
        $this->repository->save('abc', 'https://example.com');
        $token = $this->loginToken();

        $badCode = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/abc', '{"code":"非 法!"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(400, $badCode->status());

        $reserved = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/abc', '{"code":"admin"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(400, $reserved->status());

        $badUrl = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/abc', '{"url":"ftp://example.com"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(400, $badUrl->status());
        self::assertSame(['error' => 'Incorrect URL format'], $badUrl->decodedJson());
    }

    public function testUpdateUnknownCodeReturns404(): void
    {
        $token = $this->loginToken();

        $response = $this->app->handle(
            TestApp::request('PUT', '/api/admin/links/ghost', '{"url":"https://example.com"}', TestApp::cookieHeader($token)),
        );

        self::assertSame(404, $response->status());
    }

    public function testDeleteRemovesLinkAndRedirectBecomes404(): void
    {
        $this->repository->save('abc', 'https://example.com');
        $this->clicks->record('abc', self::clickContext());
        $token = $this->loginToken();

        $response = $this->app->handle(
            TestApp::request('DELETE', '/api/admin/links/abc', null, TestApp::cookieHeader($token)),
        );

        self::assertSame(200, $response->status());
        self::assertSame(['ok' => true], $response->decodedJson());
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/abc'))->status());
    }

    public function testDeleteUnknownCodeReturns404(): void
    {
        $token = $this->loginToken();

        $response = $this->app->handle(
            TestApp::request('DELETE', '/api/admin/links/ghost', null, TestApp::cookieHeader($token)),
        );

        self::assertSame(404, $response->status());
    }

    public function testOverviewAndLinkStats(): void
    {
        $this->repository->save('abc', 'https://example.com');
        $this->repository->save('def', 'https://example.org');
        $this->clicks->record('abc', self::clickContext('https://google.com/search', 'ip-1'));
        $this->clicks->record('abc', self::clickContext('https://google.com/search', 'ip-2'));
        $this->clicks->record('abc', self::clickContext('https://bing.com/', 'ip-1'));
        $token = $this->loginToken();

        $overview = $this->app->handle(TestApp::request('GET', '/api/admin/overview', null, TestApp::cookieHeader($token)));
        $overviewBody = $overview->decodedJson() ?? [];
        self::assertSame(2, $overviewBody['links']);
        self::assertSame(3, $overviewBody['total_clicks']);
        self::assertSame(3, $overviewBody['clicks_today']);
        self::assertCount(14, $overviewBody['daily'], '近 14 天序列必须补零补齐');
        self::assertSame('abc', $overviewBody['top_links'][0]['code']);
        self::assertSame(3, $overviewBody['top_links'][0]['clicks']);

        $stats = $this->app->handle(TestApp::request('GET', '/api/admin/links/abc/stats', null, TestApp::cookieHeader($token)));
        $statsBody = $stats->decodedJson() ?? [];
        self::assertSame(3, $statsBody['total_clicks']);
        self::assertSame(2, $statsBody['visitors']);
        self::assertSame('google.com', $statsBody['referers'][0]['referer_host']);
        self::assertSame(2, $statsBody['referers'][0]['clicks']);
        self::assertSame(14, count($statsBody['daily']));
        self::assertSame(0, $statsBody['devices']['mobile']);
    }

    public function testAdminPageServesDistIndex(): void
    {
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/admin'))->status());

        file_put_contents(TestApp::distIndexPath(), '<!doctype html><html><body>admin</body></html>');

        $response = $this->app->handle(TestApp::request('GET', '/admin'));
        self::assertSame(200, $response->status());
        self::assertSame('text/html; charset=utf-8', $response->header('content-type'));
        self::assertStringContainsString('admin', $response->body());
    }

    public function testAdminRouteBeatsShortCodeFallback(): void
    {
        // 存量短码 'admin' 也无法劫持管理面板：/admin 永远返回面板页
        $this->repository->save('admin', 'https://example.com');
        self::assertSame(404, $this->app->handle(TestApp::request('GET', '/admin'))->status());
    }

    private function login(string $username, string $password): Response
    {
        return $this->app->handle(
            TestApp::request('POST', '/api/auth/login', '{"username":"'.$username.'","password":"'.$password.'"}'),
        );
    }

    private function loginToken(): string
    {
        return self::tokenFrom((string) $this->login('admin', 'secret123')->header('set-cookie'));
    }

    private static function tokenFrom(string $cookie): string
    {
        if (preg_match('/admin_token=([^;]+)/', $cookie, $matches) !== 1) {
            return '';
        }

        return $matches[1];
    }

    /**
     * @return array{referer: ?string, referer_host: ?string, device: string, ip_hash: ?string}
     */
    private static function clickContext(string $referer = 'https://google.com/search', string $ipHash = 'ip-hash'): array
    {
        $host = parse_url($referer, PHP_URL_HOST);

        return [
            'referer' => $referer,
            'referer_host' => is_string($host) ? $host : null,
            'device' => 'desktop',
            'ip_hash' => $ipHash,
        ];
    }
}
