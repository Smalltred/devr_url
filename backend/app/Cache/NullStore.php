<?php

declare(strict_types=1);

namespace App\Cache;

/**
 * 空缓存驱动：不读不写，所有查询直接穿透数据库。
 * 用于缓存未启用、memcached 扩展缺失或连接失败的部署形态，
 * 保证任何环境下短链跳转都可用（仅损失缓存加速）。
 */
final class NullStore implements Store
{
    /**
     * @param list<string> $servers
     */
    public function __construct(
        private readonly bool $enabled,
        private readonly array $servers,
        private readonly int $ttl,
        private readonly int $negativeTtl,
    ) {
    }

    public function get(string $key): string|false
    {
        return false;
    }

    public function set(string $key, string $value, int $ttlSeconds): bool
    {
        return false;
    }

    public function delete(string $key): bool
    {
        return true;
    }

    public function status(): array
    {
        return [
            'driver' => 'null',
            'enabled' => $this->enabled,
            'available' => false,
            'servers' => $this->servers,
            'ttl' => $this->ttl,
            'negative_ttl' => $this->negativeTtl,
        ];
    }

    public function stats(): array
    {
        return ['hits' => 0, 'misses' => 0, 'items' => 0];
    }
}
