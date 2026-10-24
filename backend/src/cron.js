/**
 * 每日定时巡检（进程内调度，无需外部 cron）。
 *
 * - 每天在后台「设置」页配置的时刻（默认 12:00，北京时间 UTC+8）执行一轮；
 * - 每 30 秒检查一次是否到点；到点后用 app_meta 的日期标记抢占，
 *   多进程（PM2 cluster）部署时保证当天只有一个进程执行；
 * - 进程在当天到点后才启动时，会补跑一次（日期标记保证只补一次）；
 * - 后台修改时间/开关后无需重启，下一轮检查即生效。
 */
import { CHINA_OFFSET_HOURS, chinaDateString } from './support/chinaTime.js'

const CHECK_INTERVAL_MS = 30_000
const STARTUP_DELAY_MS = 5_000
const CLAIM_KEY = 'health_scan_last_date'
const OFFSET_MS = CHINA_OFFSET_HOURS * 3600 * 1000

/**
 * 北京时间当天计划执行时刻对应的 Date。
 *
 * @param {Date} now
 * @param {number} hour 北京时间小时（0-23）
 * @param {number} minute
 * @returns {Date}
 */
export function scheduledFor(now, hour, minute) {
    const shifted = new Date(now.getTime() + OFFSET_MS)
    const scheduledInChina = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
        Math.max(0, Math.min(23, Number(hour) || 0)),
        Math.max(0, Math.min(59, Number(minute) || 0)),
        0,
        0,
    )

    return new Date(scheduledInChina - OFFSET_MS)
}

/**
 * 是否已过北京时间当天计划时刻。
 *
 * @param {Date} now
 * @param {number} hour
 * @param {number} minute
 */
export function isDailyRunDue(now, hour, minute) {
    return now.getTime() >= scheduledFor(now, hour, minute).getTime()
}

/**
 * 北京时间日期键（YYYY-MM-DD），用于“每天只跑一次”的抢占标记。
 *
 * @param {Date} date
 */
export function chinaDateKey(date) {
    return chinaDateString(date)
}

/**
 * @param {import('./services/linkHealthService.js').LinkHealthService} healthService
 * @param {object} config
 * @param {import('./support/logger.js').Logger} logger
 * @param {object} settings SettingsService
 * @param {{claim: (key: string, value: string) => boolean}} meta
 */
export function startHealthScanCron(healthService, config, logger, settings, meta) {
    // 注意：是否启用以后台设置为准（环境变量只提供初始默认值），
    // 否则会出现「后台开关打开但实际不跑」的矛盾状态。
    const batchSize = Math.max(1, Number(config.health.batchSize) || 20)
    let running = false

    const run = async () => {
        if (running) {
            logger.info('link health scan skipped (previous run still active)')

            return
        }

        running = true
        try {
            const result = await healthService.scanAll(batchSize, 600)
            if (result.scanned > 0) {
                logger.info('link health daily scan finished', result)
            }
        } catch (error) {
            logger.error('link health scan failed', {
                exception: error?.name ?? 'Error',
                message: String(error?.message ?? ''),
            })
        } finally {
            running = false
        }
    }

    const tick = async () => {
        if (!settings.healthScanEnabled()) {
            return
        }

        const now = new Date()
        const hour = settings.healthScanHour()
        const minute = settings.healthScanMinute()
        if (!isDailyRunDue(now, hour, minute)) {
            return
        }

        // 多进程下只有一个进程能抢占到当天的执行权（按北京时间跨天）
        if (!meta.claim(CLAIM_KEY, chinaDateKey(now))) {
            return
        }

        logger.info('link health daily scan started', {
            hour,
            minute,
            threshold: settings.healthDeadThreshold(),
        })
        await run()
    }

    const startupTimer = setTimeout(() => {
        tick().catch(() => {})
    }, STARTUP_DELAY_MS)
    const intervalTimer = setInterval(() => {
        tick().catch(() => {})
    }, CHECK_INTERVAL_MS)
    startupTimer.unref?.()
    intervalTimer.unref?.()

    logger.info('link health daily cron scheduled', {
        hour: settings.healthScanHour(),
        minute: settings.healthScanMinute(),
        dead_threshold: settings.healthDeadThreshold(),
    })

    return {
        stop() {
            clearTimeout(startupTimer)
            clearInterval(intervalTimer)
        },
        runNow: run,
    }
}
