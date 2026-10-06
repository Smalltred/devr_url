<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\AuthRepository;

/**
 * 内存登录态仓库替身：时间语义与 SqliteAuthRepository 一致（Unix 秒、过期严格判断）。
 */
final class InMemoryAuthRepository implements AuthRepository
{
    /** @var array<string, array{created_at: int, expires_at: int}> */
    public array $tokens = [];

    /** @var array<string, array{fails: int, window_start: int}> */
    public array $throttles = [];

    /** @var array<string, string> */
    public array $meta = [];

    public function createToken(string $tokenHash, int $createdAt, int $expiresAt): void
    {
        $this->tokens[$tokenHash] = ['created_at' => $createdAt, 'expires_at' => $expiresAt];
    }

    public function validExpiresAt(string $tokenHash, int $now): ?int
    {
        $token = $this->tokens[$tokenHash] ?? null;
        if ($token === null || $token['expires_at'] <= $now) {
            return null;
        }

        return $token['expires_at'];
    }

    public function deleteToken(string $tokenHash): void
    {
        unset($this->tokens[$tokenHash]);
    }

    public function purgeExpiredTokens(int $now): void
    {
        $this->tokens = array_filter(
            $this->tokens,
            static fn (array $token): bool => $token['expires_at'] > $now,
        );
    }

    public function purgeAllTokens(): void
    {
        $this->tokens = [];
    }

    public function throttleState(string $ipHash): ?array
    {
        return $this->throttles[$ipHash] ?? null;
    }

    public function saveThrottle(string $ipHash, int $fails, int $windowStart): void
    {
        $this->throttles[$ipHash] = ['fails' => $fails, 'window_start' => $windowStart];
    }

    public function clearThrottle(string $ipHash): void
    {
        unset($this->throttles[$ipHash]);
    }
}
