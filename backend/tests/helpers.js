/**
 * 测试基础设施：临时数据库 + 真实 HTTP 服务。
 * 用 node:http 直接发请求，便于精确控制 Host/Origin/Cookie（fetch 会忽略部分头）。
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import http from 'node:http'
import { createApp } from '../src/http/app.js'
import { createServer } from '../src/http/server.js'

export const TEST_HOST = 'localhost:3001'

function deepMerge(target, source) {
    const output = { ...target }
    for (const [key, value] of Object.entries(source ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            output[key] = deepMerge(target[key] ?? {}, value)
        } else {
            output[key] = value
        }
    }

    return output
}

/**
 * @param {string} dbPath
 * @param {string} distIndex
 */
export function baseConfig(dbPath, distIndex) {
    return {
        app: {
            env: 'testing',
            debug: false,
            url: '',
            port: 0,
            distIndex,
            distDir: dirname(distIndex),
            maxBodyBytes: 16384,
        },
        security: {
            allowedOrigins: [],
            csrfAllowMissingOrigin: false,
            ipHashSecret: '',
            cspScriptExtra: [],
            cspConnectExtra: [],
            hstsMaxAge: 0,
        },
        ratelimit: { createMax: 0, createWindowSeconds: 60 },
        privacy: { storeFullReferer: false },
        database: { path: dbPath },
        cache: { driver: 'none', servers: [], ttl: 300, negativeTtl: 30, timeoutMs: 200 },
        health: {
            timeoutSeconds: 3,
            connectTimeoutSeconds: 2,
            staleHours: 24,
            batchSize: 20,
            // 测试不启动定时器（startTestServer 只创建 HTTP 服务），此处仅提供设置默认值
            scanEnabled: true,
            scanHour: 12,
            scanMinute: 0,
            deadThreshold: 3,
        },
        auth: { username: 'admin', password: 'secret123', passwordHash: '', tokenTtlDays: 7 },
        logging: { path: join(tmpdir(), 'devr-test-logs') },
    }
}

/**
 * 启动一个隔离的测试服务。
 *
 * @param {{config?: object, deps?: object}} [options]
 */
export async function startTestServer(options = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'devr-test-'))
    const dbPath = join(dir, 'test.sqlite3')
    const distIndex = join(dir, 'index.html')
    const config = deepMerge(baseConfig(dbPath, distIndex), options.config ?? {})

    const app = createApp(config, options.deps ?? {})
    const server = createServer(app, config)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const base = `http://127.0.0.1:${port}`

    /**
     * @param {string} method
     * @param {string} path
     * @param {{body?: string|object, headers?: Record<string,string>, cookie?: string}} [init]
     */
    function request(method, path, init = {}) {
        const headers = {
            host: TEST_HOST,
            origin: `http://${TEST_HOST}`,
            ...(init.headers ?? {}),
        }
        // null 表示显式省略该头（模拟非浏览器客户端）
        for (const name of ['origin', 'referer']) {
            if (headers[name] === null || headers[name] === undefined) {
                delete headers[name]
            }
        }
        if (init.cookie) {
            headers.cookie = `admin_token=${init.cookie}`
        }

        let payload
        // GET/HEAD 不发送 body：浏览器不会这样发，Node 也不会为无实体方法补 framing。
        // 其他方法显式设置 Content-Length，避免依赖 chunked 编码。
        if (init.body !== undefined && method !== 'GET' && method !== 'HEAD') {
            payload = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
            if (!headers['content-type']) {
                headers['content-type'] = 'application/json'
            }
            headers['content-length'] = Buffer.byteLength(payload, 'utf8')
        }

        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path,
                    method,
                    headers,
                },
                (res) => {
                    const chunks = []
                    res.on('data', (chunk) => chunks.push(chunk))
                    res.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8')
                        let json = null
                        try {
                            json = text === '' ? null : JSON.parse(text)
                        } catch {
                            json = null
                        }
                        resolve({ status: res.statusCode, headers: res.headers, text, json })
                    })
                },
            )
            req.on('error', reject)
            if (payload !== undefined) {
                req.write(payload)
            }
            req.end()
        })
    }

    /**
     * @param {string} [username]
     * @param {string} [password]
     * @returns {Promise<string>} token
     */
    async function login(username = 'admin', password = 'secret123') {
        const res = await request('POST', '/api/auth/login', { body: { username, password } })
        const cookie = res.headers['set-cookie']?.[0] ?? ''
        const match = /admin_token=([^;]+)/.exec(cookie)

        return match ? match[1] : ''
    }

    return {
        app,
        config,
        dbPath,
        dir,
        base,
        request,
        login,
        writeDistIndex(html) {
            writeFileSync(distIndex, html, 'utf8')
        },
        async close() {
            await new Promise((resolve) => server.close(resolve))
            try {
                app.close()
            } catch {
                // 忽略
            }
            rmSync(dir, { recursive: true, force: true })
        },
    }
}
