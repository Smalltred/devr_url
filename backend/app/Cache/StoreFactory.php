<?php

declare(strict_types=1);

namespace App\Cache;

use App\Support\Config;
use App\Support\Logger;

/**
 * 缓存驱动工厂：按配置选择 Memcached 或 Null 驱动。
 * 无论选中哪种驱动都返回可用对象（Memcached 不可用时内部降级），
 * 因此装配层无需判断扩展是否存在。
 */
final class StoreFactory
{
    public static function create(Config $config, Logger $logger): Store
    {
        $driver = strtolower((string) $config->get('cache.driver', 'memcached'));
        $servers = self::stringList($config->get('cache.servers'));
        $ttl = max(0, (int) $config->get('cache.ttl', 300));
        $negativeTtl = max(0, (int) $config->get('cache.negative_ttl', 30));

        if ($driver === 'none' || $driver === 'null' || $servers === []) {
            return new NullStore(false, $servers, $ttl, $negativeTtl);
        }

        return new MemcachedStore(
            $logger,
            $servers,
            $ttl,
            $negativeTtl,
            max(1, (int) $config->get('cache.timeout_ms', 200)),
        );
    }

    /**
     * @return list<string>
     */
    private static function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $list = [];
        foreach ($value as $item) {
            if (is_string($item) && trim($item) !== '') {
                $list[] = trim($item);
            }
        }

        return $list;
    }
}
