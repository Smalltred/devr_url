/**
 * 设置与 API Key 的 SQLite 仓储。
 */

export class SqliteSettingsRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    /** @returns {Record<string, string>} */
    all() {
        const rows = this.database.all('SELECT key, value FROM settings')
        /** @type {Record<string, string>} */
        const values = {}
        for (const row of rows) {
            values[String(row.key)] = String(row.value)
        }

        return values
    }

    set(key, value) {
        this.database.run(
            `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            key,
            value,
        )
    }
}

export class SqliteApiKeyRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    create(name, keyHash, prefix) {
        const result = this.database.run(
            'INSERT INTO api_keys (name, key_hash, prefix) VALUES (?, ?, ?)',
            name,
            keyHash,
            prefix,
        )

        return Number(result.lastInsertRowid)
    }

    findAll() {
        const rows = this.database.all(
            'SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY id DESC',
        )

        return rows.map(SqliteApiKeyRepository.toView)
    }

    find(id) {
        const row = this.database.get(
            'SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE id = ?',
            id,
        )

        return row ? SqliteApiKeyRepository.toView(row) : null
    }

    findIdByKeyHash(keyHash) {
        const row = this.database.get('SELECT id FROM api_keys WHERE key_hash = ?', keyHash)

        return row ? Number(row.id) : null
    }

    touchLastUsed(id) {
        this.database.run("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", id)
    }

    updateKeyHash(id, keyHash, prefix) {
        const result = this.database.run('UPDATE api_keys SET key_hash = ?, prefix = ? WHERE id = ?', keyHash, prefix, id)

        return Number(result.changes) > 0
    }

    delete(id) {
        const result = this.database.run('DELETE FROM api_keys WHERE id = ?', id)

        return Number(result.changes) > 0
    }

    static toView(row) {
        return {
            id: Number(row.id),
            name: String(row.name),
            prefix: String(row.prefix),
            created_at: String(row.created_at),
            last_used_at: typeof row.last_used_at === 'string' && row.last_used_at !== '' ? row.last_used_at : null,
        }
    }
}
