<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 登录态与登录限流的存储契约。
 * 时间统一使用 Unix 时间戳（INTEGER），规避 SQLite datetime('now') 与 PHP 时区的混用。
 * 生产实现为 SQLite（SqliteAuthRepository），测试实现为内存替身。
 */
interface AuthRepository
{
    /**
     * 写入登录 token 哈希与过期时间（Unix 秒）。
     */
    public function createToken(string $tokenHash, int $createdAt, int $expiresAt): void;

    /**
     * 查询 token 哈希对应的过期时间；不存在或已过期返回 null。
     */
    public function validExpiresAt(string $tokenHash, int $now): ?int;

    public function deleteToken(string $tokenHash): void;

    /**
     * 清理已过期 token（登录时顺带执行）。
     */
    public function purgeExpiredTokens(int $now): void;

    /**
     * 撤销全部登录态（修改密码后强制所有端重新登录）。
     */
    public function purgeAllTokens(): void;

    /**
     * 查询限流状态；无记录返回 null。
     *
     * @return array{fails: int, window_start: int}|null
     */
    public function throttleState(string $ipHash): ?array;

    /**
     * 保存限流状态（upsert）。
     */
    public function saveThrottle(string $ipHash, int $fails, int $windowStart): void;

    public function clearThrottle(string $ipHash): void;
}
