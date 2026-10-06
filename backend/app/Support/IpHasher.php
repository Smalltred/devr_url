<?php

declare(strict_types=1);

namespace App\Support;

use App\Repositories\MetaRepository;

/**
 * IP 匿名哈希：sha256(ip + 安装级随机盐) 前 24 位十六进制。
 * 盐在首次使用时生成并持久化于 app_meta，库文件泄露也无法反推原始 IP。
 */
final class IpHasher
{
    private const SALT_KEY = 'ip_hash_salt';

    private ?string $salt = null;

    public function __construct(private readonly MetaRepository $meta)
    {
    }

    public function hash(string $ip): ?string
    {
        if ($ip === '') {
            return null;
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

        return $this->salt = $generated;
    }
}
