/**
 * 短链仓储的缓存装饰器：
 * - findByCode 走缓存，命中免查库；
 * - 查不到时写负缓存（抵御公网扫描流量）；
 * - save/update/delete/批量删除主动失效相关短码，改完立即可见；
 * - 缓存层任何失败都静默穿透数据库。
 */
const NOT_FOUND_MARKER = '\0__devr_miss__'
const KEY_PREFIX = 'url:'

export class CachedUrlRepository {
    /**
     * @param {object} inner 底层仓储
     * @param {object} cache Store
     * @param {import('../services/settingsService.js').SettingsService} settings
     */
    constructor(inner, cache, settings) {
        this.inner = inner
        this.cache = cache
        this.settings = settings
    }

    nextId() {
        return this.inner.nextId()
    }

    async save(code, url) {
        this.inner.save(code, url)
        // 该短码可能刚被负缓存过（不存在的探测），必须清掉
        await this.#safe(() => this.cache.delete(KEY_PREFIX + code), false)
    }

    async findByCode(code) {
        if (!code) {
            return null
        }

        const cached = await this.#safe(() => this.cache.get(KEY_PREFIX + code), null)
        if (typeof cached === 'string') {
            return cached === NOT_FOUND_MARKER ? null : cached
        }

        const url = this.inner.findByCode(code)
        if (url === null || url === undefined) {
            const negativeTtl = this.settings.cacheNegativeTtl()
            if (negativeTtl > 0) {
                await this.#safe(() => this.cache.set(KEY_PREFIX + code, NOT_FOUND_MARKER, negativeTtl), false)
            }

            return null
        }

        const ttl = this.settings.cacheTtl()
        if (ttl > 0) {
            await this.#safe(() => this.cache.set(KEY_PREFIX + code, url, ttl), false)
        }

        return url
    }

    exists(code) {
        return this.inner.exists(code)
    }

    countAll() {
        return this.inner.countAll()
    }

    paginate(limit, offset, query, healthStatus = '') {
        return this.inner.paginate(limit, offset, query, healthStatus)
    }

    async update(code, newCode, url) {
        this.inner.update(code, newCode, url)
        await this.#safe(() => this.cache.delete(KEY_PREFIX + code), false)
        if (newCode !== code) {
            await this.#safe(() => this.cache.delete(KEY_PREFIX + newCode), false)
        }
    }

    async delete(code) {
        this.inner.delete(code)
        await this.#safe(() => this.cache.delete(KEY_PREFIX + code), false)
    }

    findPendingHealthCheck(limit, staleBefore, unknownBefore = staleBefore) {
        return this.inner.findPendingHealthCheck(limit, staleBefore, unknownBefore)
    }

    countPendingHealthCheck(staleBefore, unknownBefore = staleBefore) {
        return this.inner.countPendingHealthCheck(staleBefore, unknownBefore)
    }

    // 巡检结果不影响短码→URL 映射，无需动缓存
    saveHealthCheck(code, status, httpCode, error, failCount = 0) {
        this.inner.saveHealthCheck(code, status, httpCode, error, failCount)
    }

    touchHealthCheck(code) {
        this.inner.touchHealthCheck(code)
    }

    healthSummary() {
        return this.inner.healthSummary()
    }

    healthScanInfo() {
        return this.inner.healthScanInfo()
    }

    codesByHealthStatus(status) {
        return this.inner.codesByHealthStatus(status)
    }

    async deleteByHealthStatus(status) {
        // 先取待删短码逐个失效缓存，避免删除后旧缓存继续跳转到死链
        for (const code of this.inner.codesByHealthStatus(status)) {
            await this.#safe(() => this.cache.delete(KEY_PREFIX + code), false)
        }

        return this.inner.deleteByHealthStatus(status)
    }

    /**
     * 缓存调用兜底：任何异常都吞掉并返回回退值。
     * 短链跳转的可用性优先于缓存收益，装饰器本身也要防御第三方 Store 抛错。
     *
     * @template T
     * @param {() => Promise<T>} operation
     * @param {T} fallback
     * @returns {Promise<T>}
     */
    async #safe(operation, fallback) {
        try {
            return await operation()
        } catch {
            return fallback
        }
    }
}
