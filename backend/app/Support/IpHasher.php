<?php

declare(strict_types=1);

namespace App\Support;

use App\Repositories\MetaRepository;

/**
 * IP 匿名哈希：sha256(ip + 安装级随机盐) 前 24 位十六进制，用于独立访客估算与登录限流键。
 * 盐在首次使用时生成并持久化于 app_meta。
 *
 * 设置 IP_HASH_SECRET（环境变量）后改用 HMAC-SHA256：密钥不再随库存储，
 * 因此单靠数据库泄露无法离线爆破 IPv4 空间反推原始 IP（未设置时维持旧口径以兼容存量）。
 * 变更 IP_HASH_SECRET 会使历史 ip_hash 失配，独立访客数从零重新累计。
 */
final class IpHasher
{
    private const SALT_KEY = 'ip_hash_salt';

    private ?string $salt = null;

    public function __construct(
        private readonly MetaRepository $meta,
        private readonly string $secret = '',
    ) {
    }

    public function hash(string $ip): ?string
    {
        if ($ip === '') {
            return null;
        }

        if ($this->secret !== '') {
            return substr(hash_hmac('sha256', $ip, $this->secret), 0, 24);
        }

        return substr(hash('sha256', $ip.$this->salt()), 0, 24);
    }

    private function salt(): string
    {
        if ($this->salt !== null) {
            return $this->salt;
        }

        $stored = $this->meta->get(self::SALT_KEY);
        if (is_string($stored) && $stored !== '') {
            return $this->salt = $stored;
        }

        $generated = bin2hex(random_bytes(16));
        $this->meta->set(self::SALT_KEY, $generated);

        // 多进程（FPM）首次请求可能并发生成：回读一次，保证同一安装最终共用同一个盐，
        // 否则不同 worker 会算出彼此不一致的哈希（同一 IP 被计成多个访客）。
        $persisted = $this->meta->get(self::SALT_KEY);

        return $this->salt = is_string($persisted) && $persisted !== '' ? $persisted : $generated;
    }
}
