/**
 * 短链仓储（SQLite）：与 PHP 版 SQL 完全一致，保证存量库可直接读写。
 */
import { utcDateTime } from './database.js'

/**
 * LIKE 模式：两侧通配，转义 % _ \；空查询返回 null 表示不过滤。
 *
 * @param {string} query
 */
function likePattern(query) {
    const trimmed = (query ?? '').trim()
    if (trimmed === '') {
        return null
    }

    return `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

export class SqliteUrlRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    nextId() {
        return this.database.transaction(() => {
            const row = this.database.get('SELECT id FROM short_url_counter LIMIT 1')
            const previous = row ? Number(row.id) : 0
            const next = previous + 1

            if (!row) {
                this.database.run('INSERT INTO short_url_counter (id) VALUES (?)', next)
            } else {
                this.database.run('UPDATE short_url_counter SET id = ? WHERE id = ?', next, previous)
            }

            return next
        })
    }

    /**
     * @param {string} code
     * @param {string} url
     * @param {?{type: string, name: ?string, ip: ?string, userAgent: ?string}} creator
     */
    save(code, url, creator = null) {
        this.database.run(
            `INSERT INTO short_urls (code, url, creator_type, creator_name, creator_ip, creator_ua)
             VALUES (?, ?, ?, ?, ?, ?)`,
            code,
            url,
            creator?.type ?? null,
            creator?.name ?? null,
            creator?.ip ?? null,
            creator?.userAgent ? String(creator.userAgent).slice(0, 500) : null,
        )
    }

    findByCode(code) {
        const row = this.database.get('SELECT url FROM short_urls WHERE code = ?', code)

        return row && typeof row.url === 'string' ? row.url : null
    }

    /**
     * 单链元信息（创建者、创建时间）：后台统计使用，不进缓存。
     *
     * @param {string} code
     */
    findLinkMeta(code) {
        const row = this.database.get(
            `SELECT code, url, created_at, creator_type, creator_name, creator_ip, creator_ua
             FROM short_urls WHERE code = ?`,
            code,
        )
        if (!row) {
            return null
        }

        return {
            code: String(row.code),
            url: String(row.url),
            created_at: String(row.created_at),
            creator_type: typeof row.creator_type === 'string' && row.creator_type !== '' ? row.creator_type : null,
            creator_name: typeof row.creator_name === 'string' && row.creator_name !== '' ? row.creator_name : null,
            creator_ip: typeof row.creator_ip === 'string' && row.creator_ip !== '' ? row.creator_ip : null,
            creator_ua: typeof row.creator_ua === 'string' && row.creator_ua !== '' ? row.creator_ua : null,
        }
    }

    exists(code) {
        return this.database.get('SELECT 1 AS ok FROM short_urls WHERE code = ?', code) !== undefined
    }

    countAll() {
        const row = this.database.get('SELECT COUNT(*) AS total FROM short_urls')

        return Number(row?.total ?? 0)
    }

    /**
     * @param {number} limit
     * @param {number} offset
     * @param {string} query
     * @param {string} healthStatus 空 = 全部
     */
    paginate(limit, offset, query, healthStatus = '') {
        const conditions = []
        const params = []

        const like = likePattern(query)
        if (like !== null) {
            conditions.push("(code LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')")
            params.push(like, like)
        }
        if (healthStatus === 'invalid') {
            // 失效 = 待确认失效（broken）+ 已确认失效（dead）。
            // 产品语义上二者不再区分，内部状态只用于决定复检节奏。
            conditions.push("health_status IN ('broken', 'dead')")
        } else if (['ok', 'broken', 'dead', 'unknown'].includes(healthStatus)) {
            conditions.push('health_status = ?')
            params.push(healthStatus)
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const totalRow = this.database.get(`SELECT COUNT(*) AS total FROM short_urls ${where}`, ...params)
        const rows = this.database.all(
            `SELECT code, url, created_at, health_status, health_http_code, health_checked_at, health_error, health_fail_count
             FROM short_urls ${where}
             ORDER BY created_at DESC, rowid DESC
             LIMIT ? OFFSET ?`,
            ...params,
            limit,
            offset,
        )

        const items = rows.map((row) => ({
            code: String(row.code),
            url: String(row.url),
            created_at: String(row.created_at),
            health_status: String(row.health_status ?? 'unknown'),
            health_http_code: row.health_http_code === null || row.health_http_code === undefined
                ? null
                : Number(row.health_http_code),
            health_checked_at: typeof row.health_checked_at === 'string' ? row.health_checked_at : null,
            health_error: typeof row.health_error === 'string' ? row.health_error : null,
            health_fail_count: Number(row.health_fail_count ?? 0),
        }))

        return { items, total: Number(totalRow?.total ?? 0) }
    }

    /**
     * 更新目标 URL 与短码；改短码时在同一事务内迁移点击记录。
     */
    update(code, newCode, url) {
        this.database.transaction(() => {
            this.database.run('UPDATE short_urls SET code = ?, url = ? WHERE code = ?', newCode, url, code)
            if (newCode !== code) {
                this.database.run('UPDATE short_url_clicks SET code = ? WHERE code = ?', newCode, code)
            }
        })
    }

    /** 删除短链并级联删除点击记录。 */
    delete(code) {
        this.database.transaction(() => {
            this.database.run('DELETE FROM short_urls WHERE code = ?', code)
            this.database.run('DELETE FROM short_url_clicks WHERE code = ?', code)
        })
    }

    /**
     * 待检队列：
     * - 从未检测或超过复检窗口的；
     * - “无法判定”和“尚未确认失效的条目”按短重试窗口再次探测（累计失败次数）；
     * - 已确认失效的只按正常复检窗口重试（保留计数，避免频繁骚扰对方站点）。
     *
     * @param {number} limit
     * @param {string} staleBefore 正常复检窗口起点
     * @param {string} [unknownBefore] 未知/待确认失效的重试窗口起点
     */
    findPendingHealthCheck(limit, staleBefore, unknownBefore = staleBefore) {
        const rows = this.database.all(
            `SELECT code, url, health_status, health_fail_count FROM short_urls
             WHERE health_checked_at IS NULL
                OR health_checked_at < ?
                OR (health_status IN ('unknown', 'broken') AND health_checked_at < ?)
             ORDER BY health_checked_at IS NOT NULL, health_checked_at ASC, rowid ASC
             LIMIT ?`,
            staleBefore,
            unknownBefore,
            limit,
        )

        return rows.map((row) => ({
            code: String(row.code),
            url: String(row.url),
            health_status: String(row.health_status ?? 'unknown'),
            health_fail_count: Number(row.health_fail_count ?? 0),
        }))
    }

    /**
     * @param {string} staleBefore
     * @param {string} [unknownBefore]
     */
    countPendingHealthCheck(staleBefore, unknownBefore = staleBefore) {
        const row = this.database.get(
            `SELECT COUNT(*) AS total FROM short_urls
             WHERE health_checked_at IS NULL
                OR health_checked_at < ?
                OR (health_status IN ('unknown', 'broken') AND health_checked_at < ?)`,
            staleBefore,
            unknownBefore,
        )

        return Number(row?.total ?? 0)
    }

    /**
     * @param {string} code
     * @param {'ok'|'broken'|'dead'|'unknown'} status
     * @param {number|null} httpCode
     * @param {string|null} error
     * @param {number} failCount 连续失败次数
     */
    saveHealthCheck(code, status, httpCode, error, failCount = 0) {
        this.database.run(
            `UPDATE short_urls
             SET health_status = ?, health_http_code = ?, health_checked_at = datetime('now'),
                 health_error = ?, health_fail_count = ?
             WHERE code = ?`,
            status,
            httpCode,
            error,
            failCount,
            code,
        )
    }

    touchHealthCheck(code) {
        this.database.run("UPDATE short_urls SET health_checked_at = datetime('now') WHERE code = ?", code)
    }

    healthSummary() {
        const rows = this.database.all('SELECT health_status, COUNT(*) AS total FROM short_urls GROUP BY health_status')
        const summary = { ok: 0, broken: 0, dead: 0, unknown: 0 }
        for (const row of rows) {
            const key = String(row.health_status)
            if (key in summary) {
                summary[key] = Number(row.total)
            }
        }

        return summary
    }

    healthScanInfo() {
        const row = this.database.get('SELECT MIN(health_checked_at) AS first_at, MAX(health_checked_at) AS last_at FROM short_urls')

        return {
            checked_at: typeof row?.first_at === 'string' ? row.first_at : null,
            last_scan_at: typeof row?.last_at === 'string' ? row.last_at : null,
        }
    }

    /**
     * @param {string|string[]} status 单个状态或状态数组
     * @returns {string[]} 匹配的短码
     */
    codesByHealthStatus(status) {
        const statuses = Array.isArray(status) ? status : [status]
        if (statuses.length === 0) return []

        const placeholders = statuses.map(() => '?').join(', ')

        return this.database
            .all(`SELECT code FROM short_urls WHERE health_status IN (${placeholders})`, ...statuses)
            .map((row) => String(row.code))
    }

    /**
     * 批量删除指定健康状态的短链与点击记录，返回删除条数。
     *
     * @param {string|string[]} status 单个状态或状态数组（失效清理会一次传入
     *        ['broken','dead']，二者在产品上统称「失效」）
     */
    deleteByHealthStatus(status) {
        const statuses = Array.isArray(status) ? status : [status]
        if (statuses.length === 0) return 0

        const placeholders = statuses.map(() => '?').join(', ')

        return this.database.transaction(() => {
            const countRow = this.database.get(
                `SELECT COUNT(*) AS total FROM short_urls WHERE health_status IN (${placeholders})`,
                ...statuses,
            )
            this.database.run(
                `DELETE FROM short_url_clicks WHERE code IN (SELECT code FROM short_urls WHERE health_status IN (${placeholders}))`,
                ...statuses,
            )
            this.database.run(`DELETE FROM short_urls WHERE health_status IN (${placeholders})`, ...statuses)

            return Number(countRow?.total ?? 0)
        })
    }

    /** 供巡检使用：当前 UTC 时间串 */
    static staleBefore(staleHours) {
        return utcDateTime(Date.now() - Math.max(1, staleHours) * 3600 * 1000)
    }
}
