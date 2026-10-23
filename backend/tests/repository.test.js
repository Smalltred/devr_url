/**
 * SQLite 仓储测试：计数器持久化、存量库增量迁移、级联删除、分页转义、巡检排序。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Database, utcDateTime } from '../src/db/database.js'
import { SqliteUrlRepository } from '../src/db/urlRepository.js'
import { SqliteClickRepository } from '../src/db/clickRepository.js'

describe('SQLite 仓储', () => {
    /** @type {string} */
    let dir
    /** @type {string} */
    let path
    /** @type {Database} */
    let database
    /** @type {SqliteUrlRepository} */
    let repo
    /** @type {SqliteClickRepository} */
    let clicks

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'devr-repo-'))
        path = join(dir, 'repo.sqlite3')
        database = new Database(path)
        repo = new SqliteUrlRepository(database)
        clicks = new SqliteClickRepository(database)
    })

    after(() => {
        database.close()
        rmSync(dir, { recursive: true, force: true })
    })

    it('计数器从 1 开始，重启后继续', () => {
        assert.equal(repo.nextId(), 1)
        assert.equal(repo.nextId(), 2)
        assert.equal(repo.nextId(), 3)

        const reopened = new Database(path)
        try {
            const restarted = new SqliteUrlRepository(reopened)
            assert.equal(restarted.nextId(), 4)
        } finally {
            reopened.close()
        }
    })

    it('WAL 模式与 busy_timeout 已启用', () => {
        const mode = database.get('PRAGMA journal_mode')
        assert.equal(String(mode.journal_mode).toLowerCase(), 'wal')
    })

    it('更新短码时迁移点击记录', () => {
        repo.save('abc', 'https://example.com')
        clicks.record('abc', { referer: null, referer_host: null, device: 'desktop', ip_hash: null })
        clicks.record('abc', { referer: null, referer_host: null, device: 'desktop', ip_hash: null })

        repo.update('abc', 'xyz', 'https://changed.example.com')

        assert.equal(repo.findByCode('xyz'), 'https://changed.example.com')
        assert.equal(repo.exists('abc'), false)
        assert.deepEqual(clicks.totalByCodes(['xyz']), { xyz: 2 })
    })

    it('删除短链级联删除点击记录', () => {
        repo.save('gone', 'https://example.com/gone')
        clicks.record('gone', { referer: null, referer_host: null, device: 'desktop', ip_hash: null })

        repo.delete('gone')

        assert.equal(repo.exists('gone'), false)
        assert.deepEqual(clicks.totalByCodes(['gone']), {})
    })

    it('分页搜索对 LIKE 通配符转义', () => {
        repo.save('alpha', 'https://foo.com/a')
        repo.save('beta', 'https://bar.com/b')

        const byUrl = repo.paginate(10, 0, 'bar.com')
        assert.equal(byUrl.total, 1)
        assert.equal(byUrl.items[0].code, 'beta')

        // '%' 被转义为字面量，不产生全量匹配
        assert.equal(repo.paginate(10, 0, '%').total, 0)
    })

    it('待检队列：从未检测的最先，其次按检测时间最旧优先', () => {
        const now = utcDateTime()
        database.run("UPDATE short_urls SET health_checked_at = NULL, health_status = 'unknown' WHERE code = 'alpha'")
        database.run("UPDATE short_urls SET health_checked_at = '2000-01-01 00:00:00', health_status = 'ok' WHERE code = 'beta'")
        database.run("UPDATE short_urls SET health_checked_at = ?, health_status = 'ok' WHERE code = 'xyz'", now)

        // 复检窗口：只把“从未检测”或“早于窗口”的算作待检
        const staleBefore = utcDateTime(Date.now() - 86_400_000)
        const pending = repo.findPendingHealthCheck(10, staleBefore)
        assert.deepEqual(
            pending.map((item) => item.code),
            ['alpha', 'beta'],
            '未检测优先，已检测按最旧优先；窗口内的不返回',
        )

        // 若窗口覆盖所有记录，则刚检测过的也会进入队列
        const all = repo.findPendingHealthCheck(10, utcDateTime(Date.now() + 1000))
        assert.equal(all.length, 3)
    })

    it('批量删除按状态级联清理', () => {
        database.run("UPDATE short_urls SET health_status = 'broken' WHERE code IN ('alpha', 'beta')")
        clicks.record('alpha', { referer: null, referer_host: null, device: 'desktop', ip_hash: null })

        const deleted = repo.deleteByHealthStatus('broken')

        assert.equal(deleted, 2)
        assert.equal(repo.exists('alpha'), false)
        assert.deepEqual(clicks.totalByCodes(['alpha']), {})
        assert.equal(repo.healthSummary().broken, 0)
    })
})

describe('存量库增量迁移', () => {
    it('旧 schema 自动补齐 health 列且保留数据', () => {
        const dir = mkdtempSync(join(tmpdir(), 'devr-legacy-'))
        const path = join(dir, 'legacy.sqlite3')

        // 构造与 PHP 旧版本一致的库（无 health 列）
        const legacy = new DatabaseSync(path)
        legacy.exec(`
            CREATE TABLE short_urls (
                code TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE short_url_counter (id INTEGER NOT NULL);
            INSERT INTO short_url_counter (id) VALUES (7);
            INSERT INTO short_urls (code, url) VALUES ('legacy', 'https://example.com/legacy');
        `)
        legacy.close()

        const database = new Database(path)
        try {
            const columns = database.all('PRAGMA table_info(short_urls)').map((row) => String(row.name))
            for (const name of ['health_status', 'health_http_code', 'health_checked_at', 'health_error']) {
                assert.ok(columns.includes(name), `缺少列 ${name}`)
            }

            const repo = new SqliteUrlRepository(database)
            assert.equal(repo.findByCode('legacy'), 'https://example.com/legacy', '存量数据可读')
            assert.deepEqual(
                repo.healthSummary(),
                { ok: 0, broken: 0, dead: 0, unknown: 1 },
                '存量数据默认未检测',
            )
            assert.equal(repo.nextId(), 8, '计数器从旧值继续')
        } finally {
            database.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
