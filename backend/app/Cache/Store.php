<?php

declare(strict_types=1);

namespace App\Cache;

/**
 * 短链缓存存储契约：字符串键值 + 秒级 TTL。
 * 生产实现为 Memcached（MemcachedStore）；扩展缺失或服务不可用时降级为
 * NullStore（始终未命中，全部请求穿透数据库），因此调用方无需处理“缓存不可用”分支。
 */
interface Store
{
    /**
     * 读取缓存；未命中或不可用时返回 false。
     */
    public function get(string $key): string|false;

    /**
     * 写入缓存；不可用或写入失败时返回 false（调用方无需处理失败）。
     */
    public function set(string $key, string $value, int $ttlSeconds): bool;

    /**
     * 删除缓存键（幂等：键不存在视为成功）。
     */
    public function delete(string $key): bool;

    /**
     * 驱动状态，供管理端「设置」页展示。
     *
     * @return array{driver: string, enabled: bool, available: bool, servers: list<string>, ttl: int, negative_ttl: int}
     */
    public function status(): array;

    /**
     * 服务端累计命中统计；不支持统计的驱动返回全 0。
     *
     * @return array{hits: int, misses: int, items: int}
     */
    public function stats(): array;
}
