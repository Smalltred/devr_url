/**
 * 服务入口：加载 .env → 装配应用 → 启动 HTTP 服务与进程内巡检定时任务。
 *
 * 与 PHP 版环境变量完全兼容；新增 HEALTH_SCAN_ENABLED / HEALTH_SCAN_INTERVAL_SECONDS
 * 控制进程内定时巡检（不再需要外部 cron / supervisord 定时器）。
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './support/env.js'
import { loadConfig } from './config.js'
import { createApp } from './http/app.js'
import { createServer } from './http/server.js'
import { startHealthScanCron } from './cron.js'

const here = dirname(fileURLToPath(import.meta.url))
const backendRoot = resolve(here, '..')
const projectRoot = resolve(backendRoot, '..')

// 与 PHP 版相同的加载顺序：backend/.env → 项目根 .env；真实环境变量优先
loadEnv(resolve(backendRoot, '.env'), resolve(projectRoot, '.env'))

const config = loadConfig()
const app = createApp(config)
const server = createServer(app, config)
const cron = startHealthScanCron(app.services.health, config, app.services.logger)

server.listen(config.app.port, '0.0.0.0', () => {
    console.log(`devr backend listening on http://0.0.0.0:${config.app.port}`)
})

/**
 * 优雅退出：停止接收新连接，关闭定时器与数据库。
 *
 * @param {string} signal
 */
function shutdown(signal) {
    console.log(`received ${signal}, shutting down`)
    cron.stop()
    server.close(() => {
        try {
            app.close()
        } catch {
            // 忽略关闭异常
        }
        process.exit(0)
    })
    // 兜底：10 秒内没关完也退出
    setTimeout(() => process.exit(0), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
