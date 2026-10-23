/**
 * SQLite 统一出入口：连接、建表、增量迁移与异常转译。
 *
 * 使用 Node 24 内置的 node:sqlite（DatabaseSync），无需任何原生依赖。
 * WAL + busy_timeout 适配多进程（PM2/cluster 或 CLI 与 Web 并发）。
 * 所有 SQL 异常统一转译为 503 StorageError。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { storageError } from '../support/errors.js'

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS short_urls (
        code TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        health_status TEXT NOT NULL DEFAULT 'unknown',
        health_http_code INTEGER,
        health_checked_at TEXT,
        health_error TEXT,
        health_fail_count INTEGER NOT NULL DEFAULT 0
    )`,
    'CREATE TABLE IF NOT EXISTS short_url_counter (id INTEGER NOT NULL)',
    'INSERT INTO short_url_counter (id) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM short_url_counter)',
    `CREATE TABLE IF NOT EXISTS short_url_clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
        referer TEXT,
        referer_host TEXT,
        device TEXT,
        ip_hash TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_clicks_code_time ON short_url_clicks (code, clicked_at)',
    'CREATE INDEX IF NOT EXISTS idx_clicks_time ON short_url_clicks (clicked_at)',
    `CREATE TABLE IF NOT EXISTS auth_tokens (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_throttle (
        ip_hash TEXT PRIMARY KEY,
        fails INTEGER NOT NULL,
        window_start INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS request_throttle (
        scope TEXT NOT NULL,
        subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        hits INTEGER NOT NULL,
        PRIMARY KEY (scope, subject)
    )`,
    'CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT
    )`,
]

/** 存量库增量列（SQLite 不支持 ADD COLUMN IF NOT EXISTS，按 PRAGMA 判断） */
const COLUMN_MIGRATIONS = {
    short_urls: {
        health_status: "TEXT NOT NULL DEFAULT 'unknown'",
        health_http_code: 'INTEGER',
        health_checked_at: 'TEXT',
        health_error: 'TEXT',
        health_fail_count: 'INTEGER NOT NULL DEFAULT 0',
    },
}

export class Database {
    /**
     * @param {string} path
     */
    constructor(path) {
        if (!path) {
            throw storageError('SQLite path is not configured')
        }

        try {
            mkdirSync(dirname(path), { recursive: true })
        } catch {
            // 目录已存在或无权限时交给下面的 open 报错
        }

        try {
            this.db = new DatabaseSync(path)
        } catch {
            throw storageError(`Unable to open SQLite database: ${path}`)
        }

        try {
            this.db.exec('PRAGMA journal_mode = WAL')
            this.db.exec('PRAGMA busy_timeout = 2500')
            for (const statement of SCHEMA) {
                this.db.exec(statement)
            }
            this.#migrateColumns()
        } catch {
            throw storageError('SQLite schema initialization failed')
        }
    }

    /**
     * 执行一段同步数据库操作，异常统一转为 503。
     *
     * @template T
     * @param {() => T} work
     * @returns {T}
     */
    execute(work) {
        try {
            return work()
        } catch (error) {
            if (error && error.name === 'AppError') {
                throw error
            }
            throw storageError('SQLite operation failed')
        }
    }

    /**
     * BEGIN IMMEDIATE 事务。
     *
     * @template T
     * @param {() => T} work
     * @returns {T}
     */
    transaction(work) {
        return this.execute(() => {
            this.db.exec('BEGIN IMMEDIATE')
            try {
                const result = work()
                this.db.exec('COMMIT')

                return result
            } catch (error) {
                try {
                    this.db.exec('ROLLBACK')
                } catch {
                    // 事务可能已因错误自动回滚
                }
                throw error
            }
        })
    }

    /** @param {string} sql @param {...any} params */
    run(sql, ...params) {
        return this.execute(() => this.db.prepare(sql).run(...params))
    }

    /** @param {string} sql @param {...any} params */
    get(sql, ...params) {
        return this.execute(() => this.db.prepare(sql).get(...params))
    }

    /** @param {string} sql @param {...any} params */
    all(sql, ...params) {
        return this.execute(() => this.db.prepare(sql).all(...params))
    }

    close() {
        try {
            this.db.close()
        } catch {
            // 已关闭
        }
    }

    #migrateColumns() {
        for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
            const existing = new Set(
                this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)),
            )
            for (const [name, definition] of Object.entries(columns)) {
                if (!existing.has(name)) {
                    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
                }
            }
        }
    }
}

/**
 * 当前 UTC 时间，格式与 SQLite datetime('now') 一致：YYYY-MM-DD HH:MM:SS。
 *
 * @param {number} [timestamp] 毫秒时间戳，默认当前
 */
export function utcDateTime(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ')
}
