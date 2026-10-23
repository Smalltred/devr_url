/**
 * 缓存驱动工厂：按配置选择 Memcached 或 Null 驱动。
 * 无论选中哪种驱动都返回可用对象（Memcached 不可用时内部降级），装配层无需判断。
 */
import { MemcachedStore } from './memcachedStore.js'
import { NullStore } from './nullStore.js'

export function createStore(cacheConfig, logger) {
    const driver = String(cacheConfig?.driver ?? 'memcached').toLowerCase()
    const servers = (cacheConfig?.servers ?? []).filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    const ttl = Math.max(0, Number(cacheConfig?.ttl) || 0)
    const negativeTtl = Math.max(0, Number(cacheConfig?.negativeTtl) || 0)

    if (driver === 'none' || driver === 'null' || servers.length === 0) {
        return new NullStore({ servers, ttl, negativeTtl })
    }

    return new MemcachedStore(
        {
            servers,
            ttl,
            negativeTtl,
            timeoutMs: Math.max(1, Number(cacheConfig?.timeoutMs) || 200),
        },
        logger,
    )
}
