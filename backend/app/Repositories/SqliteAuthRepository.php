<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * 登录态（auth_tokens）与登录限流（auth_throttle）的 SQLite 实现。
 */
final class SqliteAuthRepository implements AuthRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function createToken(string $tokenHash, int $createdAt, int $expiresAt): void
    {
        $this->database->execute(static function (PDO $pdo) use ($tokenHash, $createdAt, $expiresAt): void {
            $statement = $pdo->prepare(
                'INSERT INTO auth_tokens (token_hash, created_at, expires_at) VALUES (:token_hash, :created_at, :expires_at)',
            );
            $statement->bindValue(':token_hash', $tokenHash, PDO::PARAM_STR);
            $statement->bindValue(':created_at', $createdAt, PDO::PARAM_INT);
            $statement->bindValue(':expires_at', $expiresAt, PDO::PARAM_INT);
            $statement->execute();
        });
    }

    public function validExpiresAt(string $tokenHash, int $now): ?int
    {
        return $this->database->execute(static function (PDO $pdo) use ($tokenHash, $now): ?int {
            $statement = $pdo->prepare('SELECT expires_at FROM auth_tokens WHERE token_hash = :token_hash');
            $statement->bindValue(':token_hash', $tokenHash, PDO::PARAM_STR);
            $statement->execute();
            $result = $statement->fetchColumn();
            if (!is_int($result) && !is_string($result)) {
                return null;
            }

            $expiresAt = (int) $result;

            return $expiresAt > $now ? $expiresAt : null;
        });
    }

    public function deleteToken(string $tokenHash): void
    {
        $this->database->execute(static function (PDO $pdo) use ($tokenHash): void {
            $statement = $pdo->prepare('DELETE FROM auth_tokens WHERE token_hash = :token_hash');
            $statement->bindValue(':token_hash', $tokenHash, PDO::PARAM_STR);
            $statement->execute();
        });
    }

    public function purgeExpiredTokens(int $now): void
    {
        $this->database->execute(static function (PDO $pdo) use ($now): void {
            $statement = $pdo->prepare('DELETE FROM auth_tokens WHERE expires_at <= :now');
            $statement->bindValue(':now', $now, PDO::PARAM_INT);
            $statement->execute();
        });
    }

    public function purgeAllTokens(): void
    {
        $this->database->execute(static function (PDO $pdo): void {
            $pdo->exec('DELETE FROM auth_tokens');
        });
    }

    public function throttleState(string $ipHash): ?array
    {
        return $this->database->execute(static function (PDO $pdo) use ($ipHash): ?array {
            $statement = $pdo->prepare('SELECT fails, window_start FROM auth_throttle WHERE ip_hash = :ip_hash');
            $statement->bindValue(':ip_hash', $ipHash, PDO::PARAM_STR);
            $statement->execute();
            /** @var array<string, mixed>|false $row */
            $row = $statement->fetch(PDO::FETCH_ASSOC);
            if ($row === false) {
                return null;
            }

            return [
                'fails' => (int) $row['fails'],
                'window_start' => (int) $row['window_start'],
            ];
        });
    }

    public function saveThrottle(string $ipHash, int $fails, int $windowStart): void
    {
        $this->database->execute(static function (PDO $pdo) use ($ipHash, $fails, $windowStart): void {
            $statement = $pdo->prepare(
                'INSERT INTO auth_throttle (ip_hash, fails, window_start) VALUES (:ip_hash, :fails, :window_start)
                 ON CONFLICT(ip_hash) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start',
            );
            $statement->bindValue(':ip_hash', $ipHash, PDO::PARAM_STR);
            $statement->bindValue(':fails', $fails, PDO::PARAM_INT);
            $statement->bindValue(':window_start', $windowStart, PDO::PARAM_INT);
            $statement->execute();
        });
    }

    public function clearThrottle(string $ipHash): void
    {
        $this->database->execute(static function (PDO $pdo) use ($ipHash): void {
            $statement = $pdo->prepare('DELETE FROM auth_throttle WHERE ip_hash = :ip_hash');
            $statement->bindValue(':ip_hash', $ipHash, PDO::PARAM_STR);
            $statement->execute();
        });
    }
}
