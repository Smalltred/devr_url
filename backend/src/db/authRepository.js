/**
 * 登录态、登录节流、键值元数据的 SQLite 仓储。
 * 时间统一用 Unix 秒（整数），避免时区与字符串比较问题。
 */
export class SqliteAuthRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    createToken(tokenHash, createdAt, expiresAt) {
        this.database.run(
            'INSERT INTO auth_tokens (token_hash, created_at, expires_at) VALUES (?, ?, ?)',
            tokenHash,
            createdAt,
            expiresAt,
        )
    }

    validExpiresAt(tokenHash, now) {
        const row = this.database.get('SELECT expires_at FROM auth_tokens WHERE token_hash = ?', tokenHash)
        if (!row) {
            return null
        }
        const expiresAt = Number(row.expires_at)

        return expiresAt > now ? expiresAt : null
    }

    deleteToken(tokenHash) {
        this.database.run('DELETE FROM auth_tokens WHERE token_hash = ?', tokenHash)
    }

    purgeExpiredTokens(now) {
        this.database.run('DELETE FROM auth_tokens WHERE expires_at <= ?', now)
    }

    purgeAllTokens() {
        this.database.run('DELETE FROM auth_tokens')
    }

    throttleState(ipHash) {
        const row = this.database.get('SELECT fails, window_start FROM auth_throttle WHERE ip_hash = ?', ipHash)

        return row ? { fails: Number(row.fails), window_start: Number(row.window_start) } : null
    }

    saveThrottle(ipHash, fails, windowStart) {
        this.database.run(
            `INSERT INTO auth_throttle (ip_hash, fails, window_start) VALUES (?, ?, ?)
             ON CONFLICT(ip_hash) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start`,
            ipHash,
            fails,
            windowStart,
        )
    }

    clearThrottle(ipHash) {
        this.database.run('DELETE FROM auth_throttle WHERE ip_hash = ?', ipHash)
    }
}

/**
 * app_meta 键值表（安装级随机数据，如 IP 哈希盐）。
 */
export class SqliteMetaRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    get(key) {
        const row = this.database.get('SELECT value FROM app_meta WHERE key = ?', key)

        return row && typeof row.value === 'string' ? row.value : null
    }

    set(key, value) {
        this.database.run(
            `INSERT INTO app_meta (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            key,
            value,
        )
    }
}

/**
 * 请求限流计数器（固定窗口）。
 */
export class SqliteThrottleRepository {
    /** @param {import('./database.js').Database} database */
    constructor(database) {
        this.database = database
    }

    /**
     * 同一窗口内自增并返回当前计数；跨窗口重置为 1。
     *
     * @returns {number} 当前窗口内的累计次数
     */
    increment(scope, subject, windowStart) {
        return this.database.transaction(() => {
            const row = this.database.get(
                'SELECT hits, window_start FROM request_throttle WHERE scope = ? AND subject = ?',
                scope,
                subject,
            )

            if (!row) {
                this.database.run(
                    'INSERT INTO request_throttle (scope, subject, window_start, hits) VALUES (?, ?, ?, 1)',
                    scope,
                    subject,
                    windowStart,
                )

                return 1
            }

            if (Number(row.window_start) === windowStart) {
                const hits = Number(row.hits) + 1
                this.database.run(
                    'UPDATE request_throttle SET hits = ? WHERE scope = ? AND subject = ?',
                    hits,
                    scope,
                    subject,
                )

                return hits
            }

            this.database.run(
                'UPDATE request_throttle SET hits = 1, window_start = ? WHERE scope = ? AND subject = ?',
                windowStart,
                scope,
                subject,
            )

            return 1
        })
    }
}
