/**
 * 每日定时巡检的调度工具测试（纯函数 + 抢占标记）。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chinaDateKey, isDailyRunDue, scheduledFor } from '../src/cron.js'
import { Database } from '../src/db/database.js'
import { SqliteMetaRepository } from '../src/db/authRepository.js'

describe('每日巡检调度', () => {
    it('scheduledFor 按北京时间计算，且不改动原对象', () => {
        const now = new Date('2026-10-23T00:05:30Z') // 北京 08:05:30
        const scheduled = scheduledFor(now, 12, 0)

        assert.equal(scheduled.toISOString(), '2026-10-23T04:00:00.000Z') // 北京 12:00
        assert.equal(now.toISOString(), '2026-10-23T00:05:30.000Z', '不得修改传入的 Date')

        // UTC 仍是 23 日，但北京已是 24 日 00:01：计划时刻应落在北京 24 日 12:00
        assert.equal(
            scheduledFor(new Date('2026-10-23T16:01:00Z'), 12, 0).toISOString(),
            '2026-10-24T04:00:00.000Z',
        )
    })

    it('到达北京时间配置时刻后才算到点，支持任意分钟', () => {
        const beforeNoon = new Date('2026-10-23T03:59:59Z') // 北京 11:59:59
        const atNoon = new Date('2026-10-23T04:00:01Z') // 北京 12:00:01

        assert.equal(isDailyRunDue(beforeNoon, 12, 0), false)
        assert.equal(isDailyRunDue(atNoon, 12, 0), true)
        assert.equal(isDailyRunDue(new Date('2026-10-23T01:29:00Z'), 9, 30), false) // 北京 09:29
        assert.equal(isDailyRunDue(new Date('2026-10-23T01:30:00Z'), 9, 30), true) // 北京 09:30
    })

    it('日期键为北京时间 YYYY-MM-DD', () => {
        assert.equal(chinaDateKey(new Date('2026-01-05T15:59:00Z')), '2026-01-05') // 北京 23:59
        assert.equal(chinaDateKey(new Date('2026-12-31T16:00:00Z')), '2027-01-01') // 北京次日 00:00
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
