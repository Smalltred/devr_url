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
    healthScanEnabled: 'health_scan_enabled',
    healthScanHour: 'health_scan_hour',
    healthScanMinute: 'health_scan_minute',
    healthDeadThreshold: 'health_dead_threshold',
}

const DEFAULTS = {
    [SETTINGS_KEYS.codeMinLength]: '1',
    [SETTINGS_KEYS.codeRandom]: '0',
    [SETTINGS_KEYS.requireLogin]: '0',
}

export class SettingsService {
    /**
     * @param {{all: () => Record<string,string>, set: (k: string, v: string) => void}} repository
     * @param {{
     *   cacheTtl?: number, cacheNegativeTtl?: number,
     *   healthScanEnabled?: boolean, healthScanHour?: number, healthScanMinute?: number, healthDeadThreshold?: number
     * }} [defaults]
     */
    constructor(repository, defaults = {}) {
        this.repository = repository
        this.defaultCacheTtl = defaults.cacheTtl ?? 300
        this.defaultNegativeTtl = defaults.cacheNegativeTtl ?? 30
        this.defaultHealthScanEnabled = defaults.healthScanEnabled ?? true
        this.defaultHealthScanHour = defaults.healthScanHour ?? 12
        this.defaultHealthScanMinute = defaults.healthScanMinute ?? 0
        this.defaultHealthDeadThreshold = defaults.healthDeadThreshold ?? 3
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

    /** 是否启用每日定时巡检 */
    healthScanEnabled() {
        const raw = this.all()[SETTINGS_KEYS.healthScanEnabled]

        return raw === undefined ? this.defaultHealthScanEnabled : raw === '1' || raw === 'true'
    }

    /** 每日巡检小时（0-23，服务器本地时间） */
    healthScanHour() {
        const raw = this.all()[SETTINGS_KEYS.healthScanHour]
        const value = raw === undefined ? this.defaultHealthScanHour : Number.parseInt(raw, 10)

        return Number.isFinite(value) ? Math.max(0, Math.min(23, value)) : this.defaultHealthScanHour
    }

    /** 每日巡检分钟（0-59） */
    healthScanMinute() {
        const raw = this.all()[SETTINGS_KEYS.healthScanMinute]
        const value = raw === undefined ? this.defaultHealthScanMinute : Number.parseInt(raw, 10)

        return Number.isFinite(value) ? Math.max(0, Math.min(59, value)) : this.defaultHealthScanMinute
    }

    /** 连续失败多少次判定为死链（1-10） */
    healthDeadThreshold() {
        const raw = this.all()[SETTINGS_KEYS.healthDeadThreshold]
        const value = raw === undefined ? this.defaultHealthDeadThreshold : Number.parseInt(raw, 10)

        return Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : this.defaultHealthDeadThreshold
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
