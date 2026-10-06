<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Cache\Store;

/**
 * 内存缓存替身：行为对齐 MemcachedStore（字符串键值、TTL 不做过期模拟，
 * 过期语义由 TTL 断言覆盖）。记录调用次数，供测试证明缓存确实生效。
 */
final class InMemoryCacheStore implements Store
{
    /** @var array<string, string> */
    public array $data = [];

    public int $getCalls = 0;

    public int $setCalls = 0;

    public int $deleteCalls = 0;

    /** @var list<array{key: string, ttl: int}> */
    public array $setLog = [];

    /**
     * @param list<string> $servers
     */
    public function __construct(
        private readonly bool $enabled = true,
        private readonly array $servers = ['127.0.0.1:11211'],
        private readonly int $ttl = 300,
        private readonly int $negativeTtl = 30,
    ) {
    }

    public function get(string $key): string|false
    {
        $this->getCalls++;

        return $this->data[$key] ?? false;
    }

    public function set(string $key, string $value, int $ttlSeconds): bool
    {
        $this->setCalls++;
        $this->setLog[] = ['key' => $key, 'ttl' => $ttlSeconds];
        $this->data[$key] = $value;

        return true;
    }

    public function delete(string $key): bool
    {
        $this->deleteCalls++;
        unset($this->data[$key]);

        return true;
    }

    public function status(): array
    {
        return [
            'driver' => 'memcached',
            'enabled' => $this->enabled,
            'available' => true,
            'servers' => $this->servers,
            'ttl' => $this->ttl,
            'negative_ttl' => $this->negativeTtl,
        ];
    }
    public function stats(): array
    {
        return ['hits' => $this->getCalls, 'misses' => 0, 'items' => count($this->data)];
    }
}
