/**
 * 点击统计仓储（SQLite）：存储用 UTC，按北京时间（UTC+8）分桶。
 */
import { CHINA_OFFSET_SQL, CHINA_OFFSET_SQL_NEGATIVE } from '../support/chinaTime.js'

// 北京时间当天 0 点对应的 UTC 时刻（用于今日计数，仍可走 clicked_at 索引）
const CHINA_TODAY_START_UTC = `datetime('now', '${CHINA_OFFSET_SQL}', 'start of day', '${CHINA_OFFSET_SQL_NEGATIVE}')`

export class SqliteClickRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    /**
     * @param {string} code
     * @param {{referer: ?string, referer_host: ?string, device: string, ip_hash: ?string}} context
     */
    record(code, context) {
        this.database.run(
            `INSERT INTO short_url_clicks (code, referer, referer_host, device, ip_hash)
             VALUES (?, ?, ?, ?, ?)`,
            code,
            context.referer,
            context.referer_host,
            context.device,
            context.ip_hash,
        )
    }

    #countMap(rows) {
        const map = {}
        for (const row of rows) {
            map[String(row.code)] = Number(row.clicks)
        }

        return map
    }

    totalByCodes(codes) {
        if (codes.length === 0) {
            return {}
        }
        const placeholders = codes.map(() => '?').join(', ')
        const rows = this.database.all(
            `SELECT code, COUNT(*) AS clicks FROM short_url_clicks WHERE code IN (${placeholders}) GROUP BY code`,
            ...codes,
        )

        return this.#countMap(rows)
    }

    todayByCodes(codes) {
        if (codes.length === 0) {
            return {}
        }
        const placeholders = codes.map(() => '?').join(', ')
        const rows = this.database.all(
            `SELECT code, COUNT(*) AS clicks FROM short_url_clicks
             WHERE code IN (${placeholders}) AND clicked_at >= ${CHINA_TODAY_START_UTC}
             GROUP BY code`,
            ...codes,
        )

        return this.#countMap(rows)
    }

    totalAll() {
        return Number(this.database.get('SELECT COUNT(*) AS total FROM short_url_clicks')?.total ?? 0)
    }

    todayAll() {
        return Number(
            this.database.get(`SELECT COUNT(*) AS total FROM short_url_clicks WHERE clicked_at >= ${CHINA_TODAY_START_UTC}`)?.total ?? 0,
        )
    }

    topCodes(limit) {
        const rows = this.database.all(
            'SELECT code, COUNT(*) AS clicks FROM short_url_clicks GROUP BY code ORDER BY clicks DESC, code ASC LIMIT ?',
            limit,
        )

        return rows.map((row) => ({ code: String(row.code), clicks: Number(row.clicks) }))
    }

    /**
     * 趋势序列：只返回窗口内有数据的桶，缺失桶由调用方补零。
     *
     * @param {?string} code null 表示全站
     * @param {'day'|'week'|'month'|'year'} period
     * @param {number} buckets
     */
    series(code, period, buckets) {
        const bucketExpression = SqliteClickRepository.bucketExpression(period)
        const rangeStart = SqliteClickRepository.rangeStartExpression(period, buckets)

        const params = []
        let sql = `SELECT ${bucketExpression} AS date, COUNT(*) AS clicks
                   FROM short_url_clicks
                   WHERE date(clicked_at, '${CHINA_OFFSET_SQL}') >= ${rangeStart}`
        if (code !== null) {
            sql += ' AND code = ?'
            params.push(code)
        }
        sql += ' GROUP BY date ORDER BY date ASC'

        return this.database.all(sql, ...params).map((row) => ({
            date: String(row.date),
            clicks: Number(row.clicks),
        }))
    }

    visitors(code) {
        return Number(
            this.database.get(
                'SELECT COUNT(DISTINCT ip_hash) AS total FROM short_url_clicks WHERE code = ? AND ip_hash IS NOT NULL',
                code,
            )?.total ?? 0,
        )
    }

    /**
     * 来源 Top N。
     *
     * 没有 Referer 的点击（聊天软件直接打开、地址栏输入等）归入
     * `referer_host: null`，由前端显示为「直接访问」——
     * 否则「有大量点击但来源区一片空白」会让人误以为统计没生效。
     */
    topRefererHosts(code, limit) {
        const rows = this.database.all(
            `SELECT COALESCE(NULLIF(referer_host, ''), '') AS referer_host, COUNT(*) AS clicks
             FROM short_url_clicks
             WHERE code = ?
             GROUP BY COALESCE(NULLIF(referer_host, ''), '')
             ORDER BY clicks DESC, referer_host ASC LIMIT ?`,
            code,
            limit,
        )

        return rows.map((row) => ({
            referer_host: row.referer_host === '' ? null : String(row.referer_host),
            clicks: Number(row.clicks),
        }))
    }

    deviceSplit(code) {
        const rows = this.database.all(
            "SELECT device, COUNT(*) AS clicks FROM short_url_clicks WHERE code = ? AND device IN ('mobile', 'desktop') GROUP BY device",
            code,
        )
        const split = { mobile: 0, desktop: 0 }
        for (const row of rows) {
            const device = String(row.device)
            if (device in split) {
                split[device] = Number(row.clicks)
            }
        }

        return split
    }

    deleteByCode(code) {
        this.database.run('DELETE FROM short_url_clicks WHERE code = ?', code)
    }

    /** 桶起始日的 SQL 表达式（北京时间，UTC+8） */
    static bucketExpression(period) {
        switch (period) {
            case 'week':
                return `date(clicked_at, '${CHINA_OFFSET_SQL}', '-' || ((cast(strftime('%w', clicked_at, '${CHINA_OFFSET_SQL}') as integer) + 6) % 7) || ' days')`
            case 'month':
                return `date(clicked_at, '${CHINA_OFFSET_SQL}', 'start of month')`
            case 'year':
                return `date(clicked_at, '${CHINA_OFFSET_SQL}', 'start of year')`
            default:
                return `date(clicked_at, '${CHINA_OFFSET_SQL}')`
        }
    }

    /** 统计起点表达式：对齐到北京时间当前桶后回退 buckets-1 个桶 */
    static rangeStartExpression(period, buckets) {
        const offset = Math.max(1, buckets) - 1
        switch (period) {
            case 'week':
                return `date('now', '${CHINA_OFFSET_SQL}', '-' || ((cast(strftime('%w', 'now', '${CHINA_OFFSET_SQL}') as integer) + 6) % 7) || ' days', '-${offset * 7} days')`
            case 'month':
                return `date('now', '${CHINA_OFFSET_SQL}', 'start of month', '-${offset} months')`
            case 'year':
                return `date('now', '${CHINA_OFFSET_SQL}', 'start of year', '-${offset} years')`
            default:
                return `date('now', '${CHINA_OFFSET_SQL}', '-${offset} days')`
        }
    }
}
