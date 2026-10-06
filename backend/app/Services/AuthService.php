<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\ThrottleException;
use App\Exceptions\UnauthorizedException;
use App\Exceptions\ValidationException;
use App\Http\Request;
use App\Repositories\AuthRepository;
use App\Support\Config;
use App\Support\IpHasher;
use App\Support\Logger;

/**
 * 单管理员登录与鉴权：
 * - 凭据：后台修改后的密码哈希（settings）优先，其次 ADMIN_PASSWORD_HASH，最后 ADMIN_PASSWORD；
 * - 登录成功签发 256 位随机 token，Cookie 仅存原文、库存 sha256 哈希；
 * - 登录失败按 IP 哈希节流：同一窗口（15 分钟）内累计失败 5 次后锁定；
 * - requireAuth 校验 Cookie 中 token 的哈希存在且未过期；修改密码后撤销全部登录态。
 */
final class AuthService
{
    private const THROTTLE_WINDOW_SECONDS = 900;

    private const THROTTLE_MAX_FAILURES = 5;

    private const MIN_PASSWORD_LENGTH = 8;

    public const COOKIE_NAME = 'admin_token';

    public function __construct(
        private readonly AuthRepository $repository,
        private readonly Config $config,
        private readonly Logger $logger,
        private readonly IpHasher $ipHasher,
        private readonly SettingsService $settings,
    ) {
    }

    /**
     * 校验凭据并签发 token，返回 Set-Cookie 头所需的完整 Cookie 值。
     *
     * @param mixed $username 请求体中的用户名（未校验类型）
     * @param mixed $password 请求体中的密码（未校验类型）
     * @param bool  $secure   当前请求是否经 HTTPS（部署层 TLS 终结时由 X-Forwarded-Proto 判定）
     */
    public function login(mixed $username, mixed $password, string $ip, bool $secure = false): string
    {
        $ipHash = $this->ipHasher->hash($ip) ?? 'anonymous';
        $this->assertNotThrottled($ipHash);

        if (!$this->credentialsMatch($username, $password)) {
            $this->recordFailure($ipHash);
            $this->logger->info('admin login failed', ['ip_hash' => $ipHash]);

            throw new UnauthorizedException('用户名或密码错误');
        }

        $this->repository->clearThrottle($ipHash);

        $token = bin2hex(random_bytes(32));
        $now = time();
        $ttl = max(1, (int) $this->config->get('auth.token_ttl_days', 7)) * 86400;
        $this->repository->createToken(hash('sha256', $token), $now, $now + $ttl);
        $this->repository->purgeExpiredTokens($now);

        return $this->authCookie($token, $ttl, $secure);
    }

    public function logout(Request $request, bool $secure = false): string
    {
        $token = $request->cookie(self::COOKIE_NAME);
        if ($token !== null) {
            $this->repository->deleteToken(hash('sha256', $token));
        }

        return sprintf(
            '%s=; Path=/; HttpOnly; SameSite=Strict%s; Max-Age=0',
            self::COOKIE_NAME,
            $secure ? '; Secure' : '',
        );
    }

    public function isAuthenticated(Request $request): bool
    {
        $token = $request->cookie(self::COOKIE_NAME);
        if ($token === null || $token === '') {
            return false;
        }

        return $this->repository->validExpiresAt(hash('sha256', $token), time()) !== null;
    }

    /**
     * 管理端接口的鉴权门卫：未登录抛 UnauthorizedException（HTTP 401）。
     */
    public function requireAuth(Request $request): void
    {
        if (!$this->isAuthenticated($request)) {
            throw new UnauthorizedException();
        }
    }

    /**
     * 登录成功后的 Set-Cookie 值。
     * Secure 依据当前请求的实际协议（含反代 X-Forwarded-Proto）或 APP_URL 为 https 时附加，
     * 避免 HTTPS 站点在未配置 APP_URL 时下发可被明文回传的会话 Cookie。
     */
    public function authCookie(string $token, int $ttl, bool $secure = false): string
    {
        $https = $secure || str_starts_with(strtolower((string) $this->config->get('app.url', '')), 'https://');

        return sprintf(
            '%s=%s; Path=/; HttpOnly; SameSite=Strict%s; Max-Age=%d',
            self::COOKIE_NAME,
            $token,
            $https ? '; Secure' : '',
            $ttl,
        );
    }

    private function assertNotThrottled(string $ipHash): void
    {
        $state = $this->repository->throttleState($ipHash);
        if ($state === null) {
            return;
        }

        if (time() - $state['window_start'] < self::THROTTLE_WINDOW_SECONDS
            && $state['fails'] >= self::THROTTLE_MAX_FAILURES) {
            throw new ThrottleException('失败次数过多，请 15 分钟后再试');
        }
    }

    private function recordFailure(string $ipHash): void
    {
        $now = time();
        $state = $this->repository->throttleState($ipHash);

        $fails = 1;
        $windowStart = $now;
        if ($state !== null && $now - $state['window_start'] < self::THROTTLE_WINDOW_SECONDS) {
            $fails = $state['fails'] + 1;
            $windowStart = $state['window_start'];
        }

        $this->repository->saveThrottle($ipHash, $fails, $windowStart);
    }

    private function credentialsMatch(mixed $username, mixed $password): bool
    {
        if (!is_string($username) || !is_string($password) || $username === '' || $password === '') {
            return false;
        }

        $expectedUsername = (string) $this->config->get('auth.username', 'admin');

        return hash_equals($expectedUsername, $username) && $this->verifyPassword($password);
    }

    /**
     * 密码校验：后台修改后的哈希（settings）→ 环境变量哈希 → 环境变量明文。
     */
    public function verifyPassword(string $password): bool
    {
        $customHash = $this->settings->adminPasswordHash();
        if ($customHash !== '') {
            return password_verify($password, $customHash);
        }

        $storedHash = $this->config->get('auth.password_hash');
        if (is_string($storedHash) && $storedHash !== '') {
            return password_verify($password, $storedHash);
        }

        $expectedPassword = (string) $this->config->get('auth.password', 'admin123');

        return hash_equals($expectedPassword, $password);
    }

    /**
     * 修改管理员密码：校验当前密码 → 新哈希落库 → 撤销全部登录态（强制重新登录）。
     */
    public function changePassword(string $currentPassword, string $newPassword): void
    {
        if (!$this->verifyPassword($currentPassword)) {
            throw new UnauthorizedException('当前密码不正确');
        }

        if (strlen($newPassword) < self::MIN_PASSWORD_LENGTH) {
            throw new ValidationException('新密码至少需要 '.self::MIN_PASSWORD_LENGTH.' 位');
        }

        $this->settings->save([
            SettingsService::KEY_ADMIN_PASSWORD_HASH => password_hash($newPassword, PASSWORD_DEFAULT),
        ]);
        $this->repository->purgeAllTokens();
        $this->logger->info('admin password changed');
    }
}
