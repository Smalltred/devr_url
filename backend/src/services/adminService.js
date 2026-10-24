/**
 * 管理端业务编排：概览、列表、编辑、删除、单链统计、站点设置、外链巡检。
 * 数据库存 UTC，统计桶与对外时间统一为北京时间（UTC+8）。
 */
import { SETTINGS_KEYS } from './settingsService.js'
import { conflictError, notFoundCode, validationError } from '../support/errors.js'
import { describeUserAgent } from '../support/userAgent.js'
import { DEFAULT_ADMIN_PATH, validateAdminPath } from '../support/adminPath.js'
import { chinaTodayAnchor, utcToChinaDateTime } from '../support/chinaTime.js'

const RESERVED_CODES = ['admin']
const CODE_PATTERN = /^[0-9A-Za-z]{1,32}$/
const PERIOD_BUCKETS = { day: 14, week: 12, month: 12, year: 5 }
const MAX_CODE_MIN_LENGTH = 16
const MIN_RANDOM_LENGTH = 3

const PERIODS = ['day', 'week', 'month', 'year']

/**
 * 严格整数解析：接受整数与纯数字字符串（对齐 PHP FILTER_VALIDATE_INT）。
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function strictInt(value) {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return Number.parseInt(value, 10)
    }

    return null
}

export class AdminService {
    /**
     * @param {object} urls 仓储（缓存装饰器）
     * @param {object} clicks
     * @param {import('./urlValidator.js').UrlValidator} validator
     * @param {import('./settingsService.js').SettingsService} settings
     * @param {object} cache
     * @param {import('./linkHealthService.js').LinkHealthService} health
     */
    constructor(urls, clicks, validator, settings, cache, health) {
        this.urls = urls
        this.clicks = clicks
        this.validator = validator
        this.settings = settings
        this.cache = cache
        this.health = health
    }

    // ---------------------------------------------------------------- 设置

    async settingsView() {
        const status = this.cache.status()
        const stats = await this.cache.stats()

        return {
            code_min_length: this.settings.codeMinLength(),
            code_random: this.settings.codeRandom(),
            // guest_access_enabled 为规范设置；require_login 保留给旧前端/调用方（二者互斥）
            guest_access_enabled: this.settings.guestAccessEnabled(),
            require_login: this.settings.requireLogin(),
            admin_path: this.settings.adminPath(),
            password_source: this.settings.hasCustomPassword() ? 'custom' : 'env',
            cache_ttl: this.settings.cacheTtl(),
            cache_negative_ttl: this.settings.cacheNegativeTtl(),
            cache: {
                driver: status.driver,
                available: status.available,
                servers: status.servers,
                stats,
            },
            health_scan_enabled: this.settings.healthScanEnabled(),
            health_scan_hour: this.settings.healthScanHour(),
            health_scan_minute: this.settings.healthScanMinute(),
            health_dead_threshold: this.settings.healthDeadThreshold(),
        }
    }

    /**
     * @param {unknown} payload
     */
    async updateSettings(payload) {
        const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
        const values = {}

        if (Object.prototype.hasOwnProperty.call(body, 'code_min_length')) {
            const length = strictInt(body.code_min_length)
            if (length === null || length < 1 || length > MAX_CODE_MIN_LENGTH) {
                throw validationError(`短链长度需为 1-${MAX_CODE_MIN_LENGTH} 的整数`)
            }
            values[SETTINGS_KEYS.codeMinLength] = String(length)
        }

        if (Object.prototype.hasOwnProperty.call(body, 'code_random')) {
            values[SETTINGS_KEYS.codeRandom] = AdminService.normalizeBool(body.code_random) ? '1' : '0'
        }

        // 游客访问开关：新旧两个键同时写入并保持互斥，读取以 guest_access_enabled 为准
        let guestAccess = null
        if (Object.prototype.hasOwnProperty.call(body, 'guest_access_enabled')) {
            guestAccess = AdminService.normalizeBool(body.guest_access_enabled)
        } else if (Object.prototype.hasOwnProperty.call(body, 'require_login')) {
            guestAccess = !AdminService.normalizeBool(body.require_login)
        }
        if (guestAccess !== null) {
            values[SETTINGS_KEYS.guestAccess] = guestAccess ? '1' : '0'
            values[SETTINGS_KEYS.requireLogin] = guestAccess ? '0' : '1'
        }

        if (Object.prototype.hasOwnProperty.call(body, 'admin_path')) {
            const result = validateAdminPath(body.admin_path)
            if (!result.valid) {
                throw validationError(result.error)
            }
            // 自定义入口不能与现有短码重合，否则短链会被入口页遮蔽
            if (result.value !== DEFAULT_ADMIN_PATH && this.urls.exists(result.value.slice(1))) {
                throw validationError('该路径已被现有短链占用，请换一个')
            }
            values[SETTINGS_KEYS.adminPath] = result.value
        }

        if (Object.prototype.hasOwnProperty.call(body, 'cache_ttl')) {
            const ttl = strictInt(body.cache_ttl)
            if (ttl === null || ttl < 0 || ttl > 86400) {
                throw validationError('缓存有效期需为 0-86400 秒的整数（0 = 不缓存）')
            }
            values[SETTINGS_KEYS.cacheTtl] = String(ttl)
        }

        if (Object.prototype.hasOwnProperty.call(body, 'cache_negative_ttl')) {
            const ttl = strictInt(body.cache_negative_ttl)
            if (ttl === null || ttl < 0 || ttl > 3600) {
                throw validationError('负缓存有效期需为 0-3600 秒的整数（0 = 不缓存不存在短码）')
            }
            values[SETTINGS_KEYS.cacheNegativeTtl] = String(ttl)
        }

        if (Object.prototype.hasOwnProperty.call(body, 'health_scan_enabled')) {
            values[SETTINGS_KEYS.healthScanEnabled] = AdminService.normalizeBool(body.health_scan_enabled) ? '1' : '0'
        }

        if (Object.prototype.hasOwnProperty.call(body, 'health_scan_hour')) {
            const hour = strictInt(body.health_scan_hour)
            if (hour === null || hour < 0 || hour > 23) {
                throw validationError('巡检小时需为 0-23 的整数')
            }
            values[SETTINGS_KEYS.healthScanHour] = String(hour)
        }

        if (Object.prototype.hasOwnProperty.call(body, 'health_scan_minute')) {
            const minute = strictInt(body.health_scan_minute)
            if (minute === null || minute < 0 || minute > 59) {
                throw validationError('巡检分钟需为 0-59 的整数')
            }
            values[SETTINGS_KEYS.healthScanMinute] = String(minute)
        }

        if (Object.prototype.hasOwnProperty.call(body, 'health_dead_threshold')) {
            const threshold = strictInt(body.health_dead_threshold)
            if (threshold === null || threshold < 1 || threshold > 10) {
                throw validationError('失效确认阈值需为 1-10 的整数')
            }
            values[SETTINGS_KEYS.healthDeadThreshold] = String(threshold)
        }

        // 合并后的有效组合校验（本次未提交的键取当前已存值）
        const randomValue = values[SETTINGS_KEYS.codeRandom] ?? (this.settings.codeRandom() ? '1' : '0')
        const lengthValue = Number(
            values[SETTINGS_KEYS.codeMinLength] ?? String(this.settings.codeMinLength()),
        )
        if (randomValue === '1' && lengthValue < MIN_RANDOM_LENGTH) {
            throw validationError(`开启随机短码后，长度至少为 ${MIN_RANDOM_LENGTH}`)
        }

        if (Object.keys(values).length > 0) {
            this.settings.save(values)
        }

        return await this.settingsView()
    }

    // ---------------------------------------------------------------- 概览

    /**
     * @param {string} period
     */
    async overview(period = 'day') {
        const normalized = AdminService.normalizePeriod(period)
        const topLinks = []
        for (const row of this.clicks.topCodes(10)) {
            const url = await this.urls.findByCode(row.code)
            topLinks.push({ code: row.code, url: url ?? '', clicks: row.clicks })
        }

        return {
            links: this.urls.countAll(),
            total_clicks: this.clicks.totalAll(),
            clicks_today: this.clicks.todayAll(),
            period: normalized,
            daily: this.#fillSeries(
                this.clicks.series(null, normalized, PERIOD_BUCKETS[normalized]),
                normalized,
            ),
            top_links: topLinks,
        }
    }

    // ---------------------------------------------------------------- 列表

    /**
     * @param {number} page
     * @param {number} perPage
     * @param {string} query
     * @param {string} healthStatus 空 = 全部；invalid = 失效（待确认 + 已判定）
     */
    links(page, perPage, query, healthStatus = '') {
        const safePage = Math.max(1, Number(page) || 1)
        const safePerPage = Math.min(100, Math.max(1, Number(perPage) || 20))
        const filter = ['ok', 'invalid', 'broken', 'dead', 'unknown'].includes(healthStatus) ? healthStatus : ''

        const result = this.urls.paginate(safePerPage, (safePage - 1) * safePerPage, query, filter)
        const codes = result.items.map((item) => item.code)
        const totals = this.clicks.totalByCodes(codes)
        const todays = this.clicks.todayByCodes(codes)

        const items = result.items.map((item) => ({
            code: item.code,
            url: item.url,
            created_at: utcToChinaDateTime(item.created_at),
            clicks: totals[item.code] ?? 0,
            clicks_today: todays[item.code] ?? 0,
            health_status: item.health_status,
            health_http_code: item.health_http_code,
            health_checked_at: utcToChinaDateTime(item.health_checked_at),
            health_error: item.health_error,
            health_fail_count: item.health_fail_count,
        }))

        return {
            total: result.total,
            page: safePage,
            per_page: safePerPage,
            items,
            health: this.health.overview(),
        }
    }

    // ---------------------------------------------------------------- 编辑

    /**
     * @param {string} code
     * @param {unknown} payload
     */
    async updateLink(code, payload) {
        const currentUrl = await this.urls.findByCode(code)
        if (currentUrl === null) {
            throw notFoundCode()
        }

        const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}

        let newCode = code
        if (Object.prototype.hasOwnProperty.call(body, 'code')) {
            if (typeof body.code !== 'string') {
                throw validationError('短码必须为字符串')
            }
            newCode = body.code.trim()
        }

        let url = currentUrl
        if (Object.prototype.hasOwnProperty.call(body, 'url')) {
            if (typeof body.url !== 'string') {
                throw validationError('目标链接必须为字符串')
            }
            url = body.url
        }

        this.#assertCodeValid(newCode)
        if (`/${newCode}` === this.settings.adminPath()) {
            throw validationError('该短码与后台安全入口冲突，请换一个')
        }
        if (newCode !== code && this.urls.exists(newCode)) {
            throw conflictError()
        }

        const validatedUrl = this.validator.validate(url)
        await this.urls.update(code, newCode, validatedUrl)

        return { code: newCode, url: validatedUrl }
    }

    /** @param {string} code */
    async deleteLink(code) {
        if (!this.urls.exists(code)) {
            throw notFoundCode()
        }

        await this.urls.delete(code)
    }

    // ---------------------------------------------------------------- 单链统计

    /**
     * @param {string} code
     * @param {string} period
     */
    async linkStats(code, period = 'day') {
        const url = await this.urls.findByCode(code)
        if (url === null) {
            throw notFoundCode()
        }

        const normalized = AdminService.normalizePeriod(period)
        const meta = await this.urls.findLinkMeta(code)

        return {
            code,
            url,
            total_clicks: this.clicks.totalByCodes([code])[code] ?? 0,
            clicks_today: this.clicks.todayByCodes([code])[code] ?? 0,
            visitors: this.clicks.visitors(code),
            period: normalized,
            daily: this.#fillSeries(
                this.clicks.series(code, normalized, PERIOD_BUCKETS[normalized]),
                normalized,
            ),
            referers: this.clicks.topRefererHosts(code, 10),
            devices: this.clicks.deviceSplit(code),
            creator: AdminService.creatorView(meta),
        }
    }

    // ---------------------------------------------------------------- 巡检

    /** @param {number} limit */
    async scanLinks(limit) {
        return await this.health.scanBatch(limit)
    }

    /** 一键清理全部失效链接（待确认 + 已判定，含点击记录） */
    async cleanupInvalidLinks() {
        const deleted = await this.health.cleanupInvalid()

        return { deleted, health: this.health.overview() }
    }

    /** 兼容旧接口：cleanup-dead 现与失效清理同义 */
    async cleanupDeadLinks() {
        return await this.cleanupInvalidLinks()
    }

    /** 兼容旧接口 */
    async cleanupBrokenLinks() {
        return await this.cleanupInvalidLinks()
    }

    healthOverview() {
        return this.health.overview()
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 创建者视图：游客 / 管理员 / API Key 名称，附带真实 IP 与设备标签。
     * 功能上线前的存量短链没有这些列，显示为「历史数据」。
     *
     * @param {?object} meta
     */
    static creatorView(meta) {
        const type = meta?.creator_type ?? null
        const name = meta?.creator_name ?? null
        const device = describeUserAgent(meta?.creator_ua ?? '')

        let label = '历史数据'
        if (type === 'api_key') {
            label = name ? `API Key：${name}` : 'API Key'
        } else if (type === 'admin') {
            label = name ? `管理员（${name}）` : '管理员'
        } else if (type === 'guest') {
            label = '游客'
        }

        return {
            type: type ?? 'unknown',
            label,
            name,
            ip: meta?.creator_ip ?? null,
            device: device.label,
            device_type: device.type,
            user_agent: meta?.creator_ua ?? null,
            created_at: utcToChinaDateTime(meta?.created_at ?? null),
        }
    }

    #assertCodeValid(code) {
        if (code === '') {
            throw validationError('短码不能为空')
        }
        if (!CODE_PATTERN.test(code)) {
            throw validationError('短码只能包含 1-32 位英文字母或数字')
        }
        if (RESERVED_CODES.includes(code.toLowerCase())) {
            throw validationError('该短码为系统保留，请换一个')
        }
    }

    /**
     * 把稀疏序列补齐为连续桶（北京时间）：
     * day → 最近 14 天；week → 最近 12 周（周一起始）；month → 12 个月；year → 5 年。
     *
     * @param {Array<{date: string, clicks: number}>} series
     * @param {string} period
     */
    #fillSeries(series, period) {
        const byDate = new Map(series.map((point) => [point.date, point.clicks]))
        const today = chinaTodayAnchor()

        return AdminService.bucketStarts(today, period).map((date) => ({
            date,
            clicks: byDate.get(date) ?? 0,
        }))
    }

    /**
     * 生成连续桶的起始日列表（升序，末位为当前桶）。
     *
     * @param {number} today 北京时间当天的日期锚点（毫秒）
     * @param {string} period
     * @returns {string[]}
     */
    static bucketStarts(today, period) {
        const count = PERIOD_BUCKETS[period] ?? 14
        const dates = []

        for (let i = count - 1; i >= 0; i -= 1) {
            switch (period) {
                case 'week': {
                    const weekday = new Date(today).getUTCDay() // 0=周日
                    const weekStart = today - ((weekday + 6) % 7) * 86_400_000
                    dates.push(new Date(weekStart - i * 7 * 86_400_000).toISOString().slice(0, 10))
                    break
                }
                case 'month': {
                    const year = new Date(today).getUTCFullYear()
                    const month = new Date(today).getUTCMonth() - i
                    const normalized = new Date(Date.UTC(year, month, 1))
                    dates.push(normalized.toISOString().slice(0, 10))
                    break
                }
                case 'year':
                    dates.push(`${new Date(today).getUTCFullYear() - i}-01-01`)
                    break
                default:
                    dates.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10))
            }
        }

        return dates
    }

    static normalizePeriod(period) {
        return PERIODS.includes(period) ? period : 'day'
    }

    static normalizeBool(value) {
        return value === true || value === 1 || value === '1' || value === 'true' || value === 'on'
    }
}
