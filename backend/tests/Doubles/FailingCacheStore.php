<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Cache\Store;

/**
 * 永远失败的缓存替身：模拟 memcached 服务不可用，
 * 验证缓存故障时跳转与创建仍可用（降级为直连数据库）。
 */
final class FailingCacheStore implements Store
{
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
        return false;
    }

    public function status(): array
    {
        return [
            'driver' => 'memcached',
            'enabled' => true,
            'available' => false,
            'servers' => ['127.0.0.1:11211'],
            'ttl' => 300,
            'negative_ttl' => 30,
        ];
    }

    public function stats(): array
    {
        return ['hits' => 0, 'misses' => 0, 'items' => 0];
    }
}
