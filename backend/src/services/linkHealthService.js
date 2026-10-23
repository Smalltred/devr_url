/**
 * 失效链接巡检：分批扫描短链目标地址，记录可达状态。
 *
 * 与 PHP 版一致：只有 ok / broken 会覆盖状态；无法判定（限流/内网/瞬断）
 * 只刷新检测时间，避免重复探测，也不会被一键清理误删。
 */
import { utcDateTime } from '../db/database.js'

const DEFAULT_BATCH = 20
const MAX_BATCH = 100
const DEFAULT_STALE_HOURS = 24
const DEFAULT_TIME_BUDGET = 20

export class LinkHealthService {
    /**
     * @param {object} urls 仓储（可能是缓存装饰器）
     * @param {{probe: (url: string) => Promise<{reachable: boolean|null, http_code: number|null, error: string|null}>}} probe
     * @param {import('../support/logger.js').Logger} logger
     * @param {number} [staleHours]
     */
    constructor(urls, probe, logger, staleHours = DEFAULT_STALE_HOURS) {
        this.urls = urls
        this.probe = probe
        this.logger = logger
        this.staleHours = staleHours
    }

    /**
     * @param {number} limit
     * @param {number} timeBudgetSeconds
     */
    async scanBatch(limit = DEFAULT_BATCH, timeBudgetSeconds = DEFAULT_TIME_BUDGET) {
        const cappedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH, MAX_BATCH))
        const budget = Math.max(1, Number(timeBudgetSeconds) || DEFAULT_TIME_BUDGET)
        const staleBefore = this.#staleBefore()
        const targets = this.urls.findPendingHealthCheck(cappedLimit, staleBefore)

        let ok = 0
        let broken = 0
        let skipped = 0
        let scanned = 0
        const deadline = Date.now() + budget * 1000

        for (const target of targets) {
            // 至少处理 1 条，之后超预算即停：避免单请求拖过网关/进程超时
            if (scanned > 0 && Date.now() >= deadline) {
                break
            }

            const outcome = await this.probe.probe(target.url)
            scanned += 1

            if (outcome.reachable === null) {
                this.urls.touchHealthCheck(target.code)
                skipped += 1
                continue
            }

            if (outcome.reachable) {
                this.urls.saveHealthCheck(target.code, 'ok', outcome.http_code, null)
                ok += 1
                continue
            }

            this.urls.saveHealthCheck(target.code, 'broken', outcome.http_code, outcome.error)
            broken += 1
        }

        return {
            scanned,
            ok,
            broken,
            skipped,
            remaining: this.urls.countPendingHealthCheck(staleBefore),
            summary: this.urls.healthSummary(),
        }
    }

    /**
     * 连续扫描直到没有待检链接或达到时间预算（供进程内定时任务/CLI 使用）。
     *
     * @param {number} batchSize
     * @param {number} budgetSeconds
     */
    async scanAll(batchSize = DEFAULT_BATCH, budgetSeconds = 600) {
        const totals = { scanned: 0, ok: 0, broken: 0, skipped: 0, batches: 0 }
        const deadline = Date.now() + Math.max(1, budgetSeconds) * 1000

        while (Date.now() < deadline) {
            const result = await this.scanBatch(batchSize)
            totals.batches += 1
            totals.scanned += result.scanned
            totals.ok += result.ok
            totals.broken += result.broken
            totals.skipped += result.skipped

            if (result.scanned === 0 || (result.remaining === 0 && result.skipped === 0)) {
                break
            }
            if (result.skipped === result.scanned) {
                break
            }
        }

        this.logger.info('link health scan finished', totals)

        return totals
    }

    /** 删除全部失效短链（含点击记录），返回删除数量 */
    async cleanupBroken() {
        const deleted = await this.urls.deleteByHealthStatus('broken')
        if (deleted > 0) {
            this.logger.info('broken links cleaned up', { deleted })
        }

        return deleted
    }

    /**
     * 巡检概览：各状态数量、待检数量、最近检测时间。
     */
    overview() {
        const summary = this.urls.healthSummary()
        const scanInfo = this.urls.healthScanInfo()

        return {
            ok: summary.ok,
            broken: summary.broken,
            unknown: summary.unknown,
            pending: this.urls.countPendingHealthCheck(this.#staleBefore()),
            last_scan_at: scanInfo.last_scan_at,
        }
    }

    #staleBefore() {
        return utcDateTime(Date.now() - Math.max(1, this.staleHours) * 3600 * 1000)
    }
}
