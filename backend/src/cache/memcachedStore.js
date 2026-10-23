/**
 * Memcached 文本协议客户端（零依赖）。
 *
 * 只实现本项目用到的命令：get / set / delete / stats。
 * 任何网络或协议异常都降级为“未命中”语义并进入 30 秒冷却，
 * 绝不让缓存故障影响短链跳转。
 */
import net from 'node:net'

const KEY_PREFIX = 'devr:'
const FAILURE_COOLDOWN_MS = 30_000
const MAX_TTL_SECONDS = 2_592_000 // 30 天；超过会被 memcached 当作绝对时间戳

/**
 * 稳定哈希：用于多实例间选择服务器（单实例部署时始终为 0）。
 *
 * @param {string} value
 * @param {number} modulo
 */
function serverIndex(value, modulo) {
    let hash = 5381
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0
    }

    return hash % modulo
}

export class MemcachedStore {
    /**
     * @param {{servers: string[], ttl: number, negativeTtl: number, timeoutMs: number}} options
     * @param {import('../support/logger.js').Logger} logger
     */
    constructor({ servers, ttl, negativeTtl, timeoutMs = 200 }, logger) {
        this.servers = MemcachedStore.normalizeServers(servers)
        this.ttl = ttl
        this.negativeTtl = negativeTtl
        this.timeoutMs = Math.max(1, timeoutMs)
        this.logger = logger
        this.failedAt = 0
    }

    async get(key) {
        if (!this.#usable()) {
            return null
        }

        try {
            const response = await this.#send(Buffer.from(`get ${this.#key(key)}\r\n`, 'utf8'))

            return MemcachedStore.#parseValue(response)
        } catch (error) {
            this.#degrade('get', error)

            return null
        }
    }

    async set(key, value, ttlSeconds) {
        if (!this.#usable()) {
            return false
        }

        try {
            const ttl = Math.max(1, Math.min(Number(ttlSeconds) || 1, MAX_TTL_SECONDS))
            const valueBuffer = Buffer.from(value, 'utf8')
            const command = Buffer.concat([
                Buffer.from(`set ${this.#key(key)} 0 ${ttl} ${valueBuffer.length}\r\n`, 'utf8'),
                valueBuffer,
                Buffer.from('\r\n', 'utf8'),
            ])
            const response = await this.#send(command)

            return response.toString('utf8').startsWith('STORED')
        } catch (error) {
            this.#degrade('set', error)

            return false
        }
    }

    async delete(key) {
        if (!this.#usable()) {
            return true
        }

        try {
            await this.#send(Buffer.from(`delete ${this.#key(key)}\r\n`, 'utf8'))

            return true
        } catch (error) {
            this.#degrade('delete', error)

            return false
        }
    }

    status() {
        return {
            driver: 'memcached',
            enabled: true,
            available: this.#usable(),
            servers: this.servers.map((server) => `${server.host}:${server.port}`),
            ttl: this.ttl,
            negative_ttl: this.negativeTtl,
        }
    }

    async stats() {
        if (!this.#usable()) {
            return { hits: 0, misses: 0, items: 0 }
        }

        try {
            const totals = { hits: 0, misses: 0, items: 0 }
            for (const server of this.servers) {
                const text = (await this.#rawCommand(server, 'stats\r\n')).toString('utf8')
                const read = (name) => {
                    const match = new RegExp(`STAT ${name} (\\d+)`).exec(text)

                    return match ? Number(match[1]) : 0
                }
                totals.hits += read('get_hits')
                totals.misses += read('get_misses')
                totals.items += read('curr_items')
            }

            return totals
        } catch (error) {
            this.#degrade('stats', error)

            return { hits: 0, misses: 0, items: 0 }
        }
    }

    #key(key) {
        return KEY_PREFIX + key
    }

    #usable() {
        if (this.servers.length === 0) {
            return false
        }
        if (this.failedAt !== 0 && Date.now() - this.failedAt < FAILURE_COOLDOWN_MS) {
            return false
        }

        return true
    }

    #degrade(operation, error) {
        this.failedAt = Date.now()
        this.logger.error('memcached degraded', {
            operation,
            reason: String(error?.message ?? error).slice(0, 200),
        })
    }

    /**
     * 按命令首行的 key 选择服务器并发送。
     *
     * @param {Buffer} command
     */
    async #send(command) {
        // 命令首行形如 "get devr:url:CODE" / "set devr:url:CODE 0 300 25"
        const firstLine = command.toString('utf8', 0, Math.min(command.length, 512)).split('\r\n')[0]
        const keyForRouting = firstLine.split(' ')[1] ?? firstLine
        const server = this.servers[serverIndex(keyForRouting, this.servers.length)]

        return await this.#rawCommand(server, command)
    }

    /**
     * @param {{host: string, port: number}} server
     * @param {string|Buffer} command
     */
    async #rawCommand(server, command) {
        return await new Promise((resolve, reject) => {
            const socket = net.connect({ host: server.host, port: server.port })
            /** @type {Buffer[]} */
            const chunks = []
            let settled = false

            const done = (error) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                socket.destroy()
                if (error) {
                    reject(error)
                } else {
                    resolve(Buffer.concat(chunks))
                }
            }

            const timer = setTimeout(() => done(new Error('memcached timeout')), this.timeoutMs)
            timer.unref?.()

            socket.on('connect', () => {
                socket.write(command)
            })
            socket.on('data', (chunk) => {
                chunks.push(chunk)
                const text = Buffer.concat(chunks).toString('utf8')
                if (text.endsWith('END\r\n') || /^(STORED|NOT_STORED|DELETED|NOT_FOUND|ERROR)\r\n$/.test(text)) {
                    done(null)
                }
            })
            socket.on('error', (error) => done(error))
            socket.on('close', () => {
                if (!settled) {
                    done(null)
                }
            })
        })
    }

    /**
     * 解析 get 响应：命中返回字符串，未命中返回 null。
     *
     * @param {Buffer} buffer
     */
    static #parseValue(buffer) {
        const text = buffer.toString('utf8')
        if (text.startsWith('END')) {
            return null
        }

        const header = /^VALUE \S+ \d+ (\d+)\r\n/.exec(text)
        if (!header) {
            return null
        }

        const length = Number(header[1])
        const start = Buffer.byteLength(header[0], 'utf8')
        if (buffer.length < start + length) {
            return null
        }

        return buffer.subarray(start, start + length).toString('utf8')
    }

    /**
     * @param {string[]} servers
     * @returns {{host: string, port: number}[]}
     */
    static normalizeServers(servers) {
        const normalized = []
        for (const entry of servers) {
            const text = String(entry ?? '').trim()
            if (text === '') {
                continue
            }
            const separator = text.lastIndexOf(':')
            let host = text
            let port = 11211
            if (separator > 0) {
                host = text.slice(0, separator)
                const candidate = text.slice(separator + 1)
                if (/^\d+$/.test(candidate)) {
                    port = Number(candidate)
                }
            }
            host = host.replace(/^\[|\]$/g, '')
            if (host !== '') {
                normalized.push({ host, port })
            }
        }

        return normalized
    }
}
