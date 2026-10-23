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
/** “无法判定”条目的重试窗口：过了这个时间允许再次探测，避免旧状态长期停留 */
const UNKNOWN_RETRY_SECONDS = 600

export class LinkHealthService {
    /**
     * @param {object} urls 仓储（可能是缓存装饰器）
     * @param {{probe: (url: string) => Promise<{reachable: boolean|null, http_code: number|null, error: string|null}>}} probe
     * @param {import('../support/logger.js').Logger} logger
     * @param {number} [staleHours]
     * @param {{healthDeadThreshold: () => number}} [settings] 提供死链判定阈值
     */
    constructor(urls, probe, logger, staleHours = DEFAULT_STALE_HOURS, settings = { healthDeadThreshold: () => 3 }) {
        this.urls = urls
        this.probe = probe
        this.logger = logger
        this.staleHours = staleHours
        this.settings = settings
    }

    /**
     * @param {number} limit
     * @param {number} timeBudgetSeconds
     */
    async scanBatch(limit = DEFAULT_BATCH, timeBudgetSeconds = DEFAULT_TIME_BUDGET) {
        const cappedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH, MAX_BATCH))
        const budget = Math.max(1, Number(timeBudgetSeconds) || DEFAULT_TIME_BUDGET)
        const threshold = Math.max(1, Number(this.settings.healthDeadThreshold()) || 3)
        const staleBefore = this.#staleBefore()
        const unknownBefore = this.#unknownBefore()
        const targets = this.urls.findPendingHealthCheck(cappedLimit, staleBefore, unknownBefore)

        let ok = 0
        let broken = 0
        let dead = 0
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
                // 恢复正常：清零连续失败计数
                this.urls.saveHealthCheck(target.code, 'ok', outcome.http_code, null, 0)
                ok += 1
                continue
            }

            const failCount = Number(target.health_fail_count ?? 0) + 1
            const isDead = failCount >= threshold
            this.urls.saveHealthCheck(
                target.code,
                isDead ? 'dead' : 'broken',
                outcome.http_code,
                outcome.error,
                failCount,
            )
            if (isDead) {
                dead += 1
            } else {
                broken += 1
            }
        }

        return {
            scanned,
            ok,
            broken,
            dead,
            skipped,
            remaining: this.urls.countPendingHealthCheck(staleBefore, unknownBefore),
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
        const totals = { scanned: 0, ok: 0, broken: 0, dead: 0, skipped: 0, batches: 0 }
        const deadline = Date.now() + Math.max(1, budgetSeconds) * 1000

        while (Date.now() < deadline) {
            const result = await this.scanBatch(batchSize)
            totals.batches += 1
            totals.scanned += result.scanned
            totals.ok += result.ok
            totals.broken += result.broken
            totals.dead += result.dead
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

    /** 删除全部死链（连续失败达到阈值的短链，含点击记录） */
    async cleanupDead() {
        const deleted = await this.urls.deleteByHealthStatus('dead')
        if (deleted > 0) {
            this.logger.info('dead links cleaned up', { deleted })
        }

        return deleted
    }

    /** 兼容旧调用 */
    async cleanupBroken() {
        return await this.cleanupDead()
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
            dead: summary.dead,
            unknown: summary.unknown,
            pending: this.urls.countPendingHealthCheck(this.#staleBefore(), this.#unknownBefore()),
            last_scan_at: scanInfo.last_scan_at,
            dead_threshold: Math.max(1, Number(this.settings.healthDeadThreshold()) || 3),
        }
    }

    #staleBefore() {
        return utcDateTime(Date.now() - Math.max(1, this.staleHours) * 3600 * 1000)
    }

    #unknownBefore() {
        return utcDateTime(Date.now() - UNKNOWN_RETRY_SECONDS * 1000)
    }
}
