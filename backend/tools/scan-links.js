#!/usr/bin/env node
/**
 * 手动巡检 CLI（定时巡检已内置在服务进程里，这个脚本用于临时补扫/排查）。
 *
 * 用法：
 *   node tools/scan-links.js                 # 每批 20 条，最多跑 10 分钟
 *   node tools/scan-links.js --batch-size=50
 *   node tools/scan-links.js --budget=60
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../src/support/env.js'
import { loadConfig } from '../src/config.js'
import { Database } from '../src/db/database.js'
import { SqliteUrlRepository } from '../src/db/urlRepository.js'
import { SqliteSettingsRepository } from '../src/db/settingsRepository.js'
import { SqliteMetaRepository } from '../src/db/authRepository.js'
import { CachedUrlRepository } from '../src/cache/cachedUrlRepository.js'
import { createStore } from '../src/cache/storeFactory.js'
import { SettingsService } from '../src/services/settingsService.js'
import { LinkHealthService } from '../src/services/linkHealthService.js'
import { HttpLinkProbe } from '../src/services/httpLinkProbe.js'
import { Logger } from '../src/support/logger.js'

const here = dirname(fileURLToPath(import.meta.url))
const backendRoot = resolve(here, '..')
const projectRoot = resolve(backendRoot, '..')

loadEnv(resolve(backendRoot, '.env'), resolve(projectRoot, '.env'))

const config = loadConfig()
const options = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.replace(/^--/, '').split('=')

        return [key, value ?? 'true']
    }),
)

const batchSize = /^\d+$/.test(options['batch-size'] ?? '') ? Number(options['batch-size']) : config.health.batchSize
const budget = /^\d+$/.test(options.budget ?? '') ? Number(options.budget) : 600

const logger = new Logger(config.logging.path)
const database = new Database(config.database.path)
const settings = new SettingsService(new SqliteSettingsRepository(database), {
    cacheTtl: config.cache.ttl,
    cacheNegativeTtl: config.cache.negativeTtl,
})
const cache = createStore(config.cache, logger)
const urls = new CachedUrlRepository(new SqliteUrlRepository(database), cache, settings)
const probe = new HttpLinkProbe({
    timeoutSeconds: config.health.timeoutSeconds,
    connectTimeoutSeconds: config.health.connectTimeoutSeconds,
})
const service = new LinkHealthService(urls, probe, logger, config.health.staleHours)

const startedAt = Date.now()
const result = await service.scanAll(batchSize, budget)
const summary = service.overview()
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

console.log(
    `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] 巡检完成：批次 ${result.batches}，`
    + `扫描 ${result.scanned} 条（正常 ${result.ok} / 失效 ${result.broken} / 跳过 ${result.skipped}），耗时 ${elapsed}s`,
)
console.log(
    `累计状态：正常 ${summary.ok} / 失效 ${summary.broken} / 未检测 ${summary.unknown}，待检 ${summary.pending}`,
)

// 缓存客户端可能已建立连接，显式结束进程
process.exit(0)
