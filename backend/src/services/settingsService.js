/**
 * 管理端设置：短码长度/随机性、创建需登录、后台改密哈希、缓存 TTL。
 *
 * 默认值与 PHP 版一致（顺序短码、长度不限、无需登录），保证存量部署升级无感。
 * 缓存 TTL 的缺省值来自环境变量，数据库值优先；读取时按范围夹紧。
 */
export const SETTINGS_KEYS = {
    codeMinLength: 'code_min_length',
    codeRandom: 'code_random',
    requireLogin: 'require_login',
    adminPasswordHash: 'admin_password_hash',
    cacheTtl: 'cache_ttl',
    cacheNegativeTtl: 'cache_negative_ttl',
}

const DEFAULTS = {
    [SETTINGS_KEYS.codeMinLength]: '1',
    [SETTINGS_KEYS.codeRandom]: '0',
    [SETTINGS_KEYS.requireLogin]: '0',
}

export class SettingsService {
    /**
     * @param {{all: () => Record<string,string>, set: (k: string, v: string) => void}} repository
     * @param {{cacheTtl?: number, cacheNegativeTtl?: number}} [defaults]
     */
    constructor(repository, defaults = {}) {
        this.repository = repository
        this.defaultCacheTtl = defaults.cacheTtl ?? 300
        this.defaultNegativeTtl = defaults.cacheNegativeTtl ?? 30
        this.cache = null
        this.cachedAt = 0
    }

    /**
     * @returns {Record<string, string>}
     */
    all() {
        // 2 秒 TTL：同一请求内避免重复查询，同时保证多进程部署时
        // 后台改动能在一秒级内被其它 worker 感知（进程内 save() 会立即失效缓存）
        const now = Date.now()
        if (this.cache === null || now - this.cachedAt > 2000) {
            this.cache = {
                ...DEFAULTS,
                [SETTINGS_KEYS.adminPasswordHash]: '',
                ...this.repository.all(),
            }
            this.cachedAt = now
        }

        return this.cache
    }

    codeMinLength() {
        const raw = Number.parseInt(this.all()[SETTINGS_KEYS.codeMinLength] ?? '1', 10)

        return Number.isFinite(raw) ? Math.max(1, Math.min(16, raw)) : 1
    }

    codeRandom() {
        return this.#flag(SETTINGS_KEYS.codeRandom)
    }

    requireLogin() {
        return this.#flag(SETTINGS_KEYS.requireLogin)
    }

    adminPasswordHash() {
        return String(this.all()[SETTINGS_KEYS.adminPasswordHash] ?? '')
    }

    hasCustomPassword() {
        return this.adminPasswordHash() !== ''
    }

    cacheTtl() {
        const raw = this.all()[SETTINGS_KEYS.cacheTtl]
        const value = raw === undefined ? this.defaultCacheTtl : Number.parseInt(raw, 10)

        return Number.isFinite(value) ? Math.max(0, Math.min(86400, value)) : this.defaultCacheTtl
    }

    cacheNegativeTtl() {
        const raw = this.all()[SETTINGS_KEYS.cacheNegativeTtl]
        const value = raw === undefined ? this.defaultNegativeTtl : Number.parseInt(raw, 10)

        return Number.isFinite(value) ? Math.max(0, Math.min(3600, value)) : this.defaultNegativeTtl
    }

    /**
     * @param {Record<string, string>} values
     */
    save(values) {
        for (const [key, value] of Object.entries(values)) {
            this.repository.set(key, value)
        }
        this.cache = null
        this.cachedAt = 0
    }

    #flag(key) {
        const value = this.all()[key]

        return value === '1' || value === 'true'
    }
}
