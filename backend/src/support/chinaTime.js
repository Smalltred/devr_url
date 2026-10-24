/**
 * 中国标准时间（Asia/Shanghai，UTC+8）。
 *
 * 数据库仍以 UTC 存储（datetime('now')，历史数据无需迁移），
 * 统计分桶、今日归属、页面展示与定时任务统一换算到北京时间。
 * 中国不实行夏令时，固定 +8 时区即可，无需引入时区数据库。
 */
export const CHINA_OFFSET_HOURS = 8
export const CHINA_OFFSET_SQL = `+${CHINA_OFFSET_HOURS} hours`
export const CHINA_OFFSET_SQL_NEGATIVE = `-${CHINA_OFFSET_HOURS} hours`

const OFFSET_MS = CHINA_OFFSET_HOURS * 3600 * 1000

/**
 * 当前/指定时刻的北京时间串：YYYY-MM-DD HH:MM:SS。
 *
 * @param {number} [timestamp] 毫秒时间戳，默认当前
 */
export function chinaDateTime(timestamp = Date.now()) {
    return new Date(timestamp + OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * 把数据库里的 UTC 时间串转成北京时间串。
 * 已是带时区的 ISO 字符串也支持；无法解析时原样返回。
 *
 * @param {?string} value
 * @returns {?string}
 */
export function utcToChinaDateTime(value) {
    if (value === null || value === undefined || value === '') {
        return null
    }
    const normalized = String(value).replace(' ', 'T')
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    const date = new Date(hasZone ? normalized : `${normalized}Z`)
    if (Number.isNaN(date.getTime())) {
        return String(value)
    }

    return chinaDateTime(date.getTime())
}

/**
 * 北京时间日期键：YYYY-MM-DD（用于“每天只跑一次”的抢占标记）。
 *
 * @param {Date} [date]
 */
export function chinaDateString(date = new Date()) {
    return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 北京时间当天的日期锚点（毫秒）。
 * 仅用于日历运算（周/月/年桶），不是真实 UTC 零点。
 *
 * @param {Date} [now]
 */
export function chinaTodayAnchor(now = new Date()) {
    const shifted = new Date(now.getTime() + OFFSET_MS)

    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}
