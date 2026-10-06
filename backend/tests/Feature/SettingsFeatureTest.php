<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use App\Http\Response;
use PHPUnit\Framework\TestCase;
use Tests\Doubles\InMemoryAuthRepository;
use Tests\Doubles\InMemoryClickRepository;
use Tests\Doubles\InMemorySettingsRepository;
use Tests\Doubles\InMemoryUrlRepository;
use Tests\Support\TestApp;

/**
 * 管理端设置 Feature 测试：短链长度/随机性、创建需登录门控、后台修改密码（含全端强制下线）。
 */
final class SettingsFeatureTest extends TestCase
{
    private InMemoryUrlRepository $repository;

    private InMemorySettingsRepository $settings;

    private App $app;

    protected function setUp(): void
    {
        $this->repository = new InMemoryUrlRepository();
        $this->settings = new InMemorySettingsRepository();
        $this->app = TestApp::create($this->repository, new InMemoryClickRepository(), new InMemoryAuthRepository(), $this->settings);
    }

    public function testSettingsEndpointsRequireAuth(): void
    {
        self::assertSame(401, $this->app->handle(TestApp::request('GET', '/api/admin/settings'))->status());
        self::assertSame(401, $this->app->handle(TestApp::request('PUT', '/api/admin/settings', '{}'))->status());
        self::assertSame(401, $this->app->handle(TestApp::request('POST', '/api/admin/settings/password', '{}'))->status());
    }

    public function testDefaultSettingsPreserveLegacyBehavior(): void
    {
        $token = $this->loginToken();

        $view = $this->app->handle(TestApp::request('GET', '/api/admin/settings', null, TestApp::cookieHeader($token)))->decodedJson();

        self::assertSame([
            'code_min_length' => 1,
            'code_random' => false,
            'require_login' => false,
            'password_source' => 'env',
        ], $view);

        // 默认设置下首个短码与历史行为逐位一致
        $created = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'));
        self::assertSame(['url' => 'https://example.com', 'code' => 'S'], $created->decodedJson());
    }

    public function testUpdateSettingsValidatesInput(): void
    {
        $token = $this->loginToken();

        $tooLong = $this->put($token, ['code_min_length' => 20]);
        self::assertSame(400, $tooLong->status());

        $notInt = $this->put($token, ['code_min_length' => 'abc']);
        self::assertSame(400, $notInt->status());

        // 开随机但长度不足
        $randomTooShort = $this->put($token, ['code_random' => true]);
        self::assertSame(400, $randomTooShort->status());
    }

    public function testUpdateSettingsPersistsValues(): void
    {
        $token = $this->loginToken();

        $saved = $this->put($token, ['code_min_length' => 4, 'code_random' => false, 'require_login' => true]);

        $savedBody = $saved->decodedJson() ?? [];
        self::assertSame(200, $saved->status());
        self::assertSame(4, $savedBody['code_min_length'] ?? null);
        self::assertSame(false, $savedBody['code_random'] ?? null);
        self::assertSame(true, $savedBody['require_login'] ?? null);

        // 持久化：重新 GET 仍是保存后的值
        $view = $this->app->handle(TestApp::request('GET', '/api/admin/settings', null, TestApp::cookieHeader($token)))->decodedJson() ?? [];
        self::assertSame(4, $view['code_min_length'] ?? null);
        self::assertSame(true, $view['require_login'] ?? null);
    }

    public function testMinLengthPadsSequentialCodes(): void
    {
        $token = $this->loginToken();
        $this->put($token, ['code_min_length' => 4]);

        $firstBody = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/1"}'))->decodedJson() ?? [];
        $secondBody = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/2"}'))->decodedJson() ?? [];

        $first = (string) ($firstBody['code'] ?? '');
        $second = (string) ($secondBody['code'] ?? '');
        self::assertSame('GGGS', $first, 'encode(1)=S 左补 3 位字母表首字符');
        self::assertSame('GGG2', $second, 'encode(2)=2 左补 3 位字母表首字符');
        self::assertNotSame($first, $second);
    }

    public function testRandomCodesHaveLengthAndAreUnique(): void
    {
        $token = $this->loginToken();
        $this->put($token, ['code_min_length' => 4, 'code_random' => true]);

        $codes = [];
        for ($i = 0; $i < 15; $i++) {
            $body = $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/'.$i.'"}'))->decodedJson();
            $code = (string) ($body['code'] ?? '');
            self::assertSame(4, strlen($code), '随机短码必须达到设置的最小长度');
            self::assertMatchesRegularExpression('/^[0-9A-Za-z]{4}$/', $code);
            self::assertArrayNotHasKey($code, $codes, '随机短码不得重复');
            $codes[$code] = true;
        }
    }

    public function testRequireLoginGatesPublicCreation(): void
    {
        // 默认无需登录
        self::assertSame(200, $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'))->status());

        $token = $this->loginToken();
        $this->put($token, ['require_login' => true]);

        // 开启后未登录创建被拒
        self::assertSame(401, $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/x"}'))->status());
        self::assertSame(401, $this->app->handle(TestApp::request('POST', '/api/url', '{"url":"https://example.com/x"}'))->status());

        // me() 必须向首页暴露 require_login
        $me = $this->app->handle(TestApp::request('GET', '/api/auth/me'))->decodedJson();
        self::assertSame(['authenticated' => false, 'require_login' => true], $me);

        // 登录后可正常创建；跳转不受影响
        self::assertSame(200, $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/y"}', TestApp::cookieHeader($token)))->status());

        // 关闭后恢复公开
        $this->put($token, ['require_login' => false]);
        self::assertSame(200, $this->app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com/z"}'))->status());
    }

    public function testChangePasswordValidatesInput(): void
    {
        $token = $this->loginToken();

        $wrongCurrent = $this->app->handle(
            TestApp::request('POST', '/api/admin/settings/password', '{"current_password":"bad","new_password":"newpassword1"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(401, $wrongCurrent->status());
        $wrongBody = $wrongCurrent->decodedJson() ?? [];
        self::assertSame('当前密码不正确', $wrongBody['error'] ?? null);

        $tooShort = $this->app->handle(
            TestApp::request('POST', '/api/admin/settings/password', '{"current_password":"secret123","new_password":"short"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(400, $tooShort->status());

        $missing = $this->app->handle(
            TestApp::request('POST', '/api/admin/settings/password', '{"current_password":"secret123"}', TestApp::cookieHeader($token)),
        );
        self::assertSame(400, $missing->status());
    }

    public function testChangePasswordRevokesAllSessionsAndSwitchesCredentials(): void
    {
        $tokenA = $this->loginToken();
        $tokenB = $this->loginToken();

        $changed = $this->app->handle(
            TestApp::request('POST', '/api/admin/settings/password', '{"current_password":"secret123","new_password":"newpassword1"}', TestApp::cookieHeader($tokenA)),
        );
        self::assertSame(200, $changed->status());

        // 全部旧 token 失效
        $meA = $this->app->handle(TestApp::request('GET', '/api/auth/me', null, TestApp::cookieHeader($tokenA)));
        self::assertSame(['authenticated' => false, 'require_login' => false], $meA->decodedJson());
        self::assertSame(401, $this->app->handle(TestApp::request('GET', '/api/admin/links', null, TestApp::cookieHeader($tokenB)))->status());

        // 旧密码（环境变量）不再可用，新密码可登录
        $oldLogin = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));
        self::assertSame(401, $oldLogin->status());

        $newLogin = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"newpassword1"}'));
        self::assertSame(200, $newLogin->status());

        // 密码来源切换为后台自定义
        $tokenC = self::tokenFrom((string) $newLogin->header('set-cookie'));
        $view = $this->app->handle(TestApp::request('GET', '/api/admin/settings', null, TestApp::cookieHeader($tokenC)))->decodedJson() ?? [];
        self::assertSame('custom', $view['password_source'] ?? null);
    }

    private function loginToken(): string
    {
        $login = $this->app->handle(TestApp::request('POST', '/api/auth/login', '{"username":"admin","password":"secret123"}'));

        return self::tokenFrom((string) $login->header('set-cookie'));
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function put(string $token, array $payload): Response
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
