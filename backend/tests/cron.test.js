/**
 * 每日定时巡检的调度工具测试（纯函数 + 抢占标记）。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDailyRunDue, localDateKey, scheduledFor } from '../src/cron.js'
import { Database } from '../src/db/database.js'
import { SqliteMetaRepository } from '../src/db/authRepository.js'

describe('每日巡检调度', () => {
    it('scheduledFor 使用本地时间，且不改动原对象', () => {
        const now = new Date(2026, 9, 23, 8, 5, 30)
        const scheduled = scheduledFor(now, 12, 0)

        assert.equal(scheduled.getHours(), 12)
        assert.equal(scheduled.getMinutes(), 0)
        assert.equal(scheduled.getSeconds(), 0)
        assert.equal(now.getHours(), 8, '不得修改传入的 Date')
    })

    it('到达配置时刻后才算到点，支持任意分钟', () => {
        const beforeNoon = new Date(2026, 9, 23, 11, 59, 59)
        const atNoon = new Date(2026, 9, 23, 12, 0, 1)

        assert.equal(isDailyRunDue(beforeNoon, 12, 0), false)
        assert.equal(isDailyRunDue(atNoon, 12, 0), true)
        assert.equal(isDailyRunDue(new Date(2026, 9, 23, 9, 29), 9, 30), false)
        assert.equal(isDailyRunDue(new Date(2026, 9, 23, 9, 30), 9, 30), true)
    })

    it('日期键为本地 YYYY-MM-DD', () => {
        assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
        assert.equal(localDateKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31')
    })

    it('多进程抢占：同一天只有第一个进程执行，跨天可再次执行', () => {
        const dir = mkdtempSync(join(tmpdir(), 'devr-cron-'))
        const database = new Database(join(dir, 'cron.sqlite3'))
        try {
            const meta = new SqliteMetaRepository(database)

            assert.equal(meta.claim('health_scan_last_date', '2026-10-23'), true, '首个进程抢到执行权')
            assert.equal(meta.claim('health_scan_last_date', '2026-10-23'), false, '其它进程当天不再执行')
            assert.equal(meta.claim('health_scan_last_date', '2026-10-24'), true, '跨天可再次执行')
            assert.equal(meta.get('health_scan_last_date'), '2026-10-24')
        } finally {
            database.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
