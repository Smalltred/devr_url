/**
 * 进程内定时巡检（Node 相对 PHP 的核心收益：不需要外部 cron / supervisord 定时器）。
 *
 * - HEALTH_SCAN_ENABLED=true（默认）时启用；
 * - 启动 30 秒后跑第一轮（给服务预热），之后每 HEALTH_SCAN_INTERVAL_SECONDS 秒（默认 1 小时）一轮；
 * - 上一轮未结束时跳过本轮，避免任务堆积；
 * - 定时器 unref，不阻塞进程退出（CLI/测试场景安全）。
 */
export function startHealthScanCron(healthService, config, logger) {
    if (!config.health.scanEnabled) {
        logger.info('link health scan disabled')

        return { stop() {}, runNow: async () => {} }
    }

    const intervalSeconds = Math.max(60, Number(config.health.scanIntervalSeconds) || 3600)
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
                logger.info('link health cron finished', result)
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

    const initialTimer = setTimeout(run, 30_000)
    const intervalTimer = setInterval(run, intervalSeconds * 1000)
    initialTimer.unref?.()
    intervalTimer.unref?.()

    logger.info('link health cron scheduled', { interval_seconds: intervalSeconds, batch_size: batchSize })

    return {
        stop() {
            clearTimeout(initialTimer)
            clearInterval(intervalTimer)
        },
        runNow: run,
    }
}
