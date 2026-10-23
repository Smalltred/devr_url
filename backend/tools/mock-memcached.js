#!/usr/bin/env node
/**
 * 极简 memcached 文本协议服务端（仅供本地验证缓存链路，不用于生产）。
 *
 * 支持 get / set / delete / stats / version；
 * 用法：node tools/mock-memcached.js [port]
 */
import net from 'node:net'

const port = Number(process.argv[2] ?? 11211)
/** @type {Map<string, {value: Buffer, expiresAt: number}>} */
const store = new Map()
let hits = 0
let misses = 0

/**
 * 把 memcached 的 exptime 换算成绝对毫秒：≤30 天为相对秒数，>30 天为 Unix 秒时间戳。
 *
 * @param {number} expires
 */
function expiresAt(expires) {
    if (expires === 0) {
        return 0
    }
    if (expires > 2_592_000) {
        return expires * 1000
    }

    return Date.now() + expires * 1000
}

const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0)

    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])

        while (true) {
            // 先找命令行
            const lineEnd = buffer.indexOf('\r\n')
            if (lineEnd === -1) {
                return
            }

            const line = buffer.subarray(0, lineEnd).toString('utf8')
            const parts = line.split(' ')
            const command = parts[0].toLowerCase()

            if (command === 'set' || command === 'add' || command === 'replace') {
                const bytes = Number(parts[4] ?? 0)
                const total = lineEnd + 2 + bytes + 2
                if (buffer.length < total) {
                    return // 数据块未到齐
                }
                const key = parts[1] ?? ''
                const value = buffer.subarray(lineEnd + 2, lineEnd + 2 + bytes)
                const exists = store.has(key)
                const outcome = command === 'add' && exists
                    ? 'NOT_STORED'
                    : (command === 'replace' && !exists ? 'NOT_STORED' : 'STORED')
                if (outcome === 'STORED') {
                    store.set(key, { value: Buffer.from(value), expiresAt: expiresAt(Number(parts[3] ?? 0)) })
                }
                socket.write(`${outcome}\r\n`)
                buffer = buffer.subarray(total)
                continue
            }

            buffer = buffer.subarray(lineEnd + 2)

            if (command === 'get') {
                const key = parts[1] ?? ''
                const entry = store.get(key)
                if (!entry || (entry.expiresAt !== 0 && entry.expiresAt <= Date.now())) {
                    misses += 1
                    store.delete(key)
                    socket.write('END\r\n')
                    continue
                }
                hits += 1
                socket.write(
                    Buffer.concat([
                        Buffer.from(`VALUE ${key} 0 ${entry.value.length}\r\n`, 'utf8'),
                        entry.value,
                        Buffer.from('\r\nEND\r\n', 'utf8'),
                    ]),
                )
                continue
            }

            if (command === 'delete') {
                const key = parts[1] ?? ''
                const existed = store.delete(key)
                socket.write(existed ? 'DELETED\r\n' : 'NOT_FOUND\r\n')
                continue
            }

            if (command === 'stats') {
                socket.write(
                    `STAT get_hits ${hits}\r\nSTAT get_misses ${misses}\r\nSTAT curr_items ${store.size}\r\nEND\r\n`,
                )
                continue
            }

            if (command === 'version') {
                socket.write('VERSION 1.6.0-mock\r\n')
                continue
            }

            if (command === 'quit') {
                socket.end()
                return
            }

            socket.write('ERROR\r\n')
        }
    })

    socket.on('error', () => socket.destroy())
})

server.listen(port, '127.0.0.1', () => {
    console.log(`mock memcached listening on 127.0.0.1:${port}`)
})
