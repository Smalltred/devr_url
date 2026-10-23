/**
 * 安全行为测试：CSRF、创建限流、请求体上限、安全响应头、静态资源边界、CRLF 注入。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from '../src/db/database.js'
import { startTestServer } from './helpers.js'

describe('CSRF 来源校验', () => {
    let server
    before(async () => {
        server = await startTestServer()
    })
    after(async () => {
        await server.close()
    })

    it('写请求缺少 Origin/Referer 时 403', async () => {
        const res = await server.request('POST', '/url', {
            headers: { origin: null, referer: null },
            body: { url: 'https://example.com' },
        })
        assert.equal(res.status, 403)
        assert.deepEqual(res.json, { error: 'Cross-site request rejected' })
    })

    it('跨站来源 403，同源通过', async () => {
        const cross = await server.request('POST', '/url', {
            headers: { origin: 'https://evil.example.com' },
            body: { url: 'https://example.com' },
        })
        assert.equal(cross.status, 403)
        assert.deepEqual(cross.json, { error: 'Cross-site request rejected' })

        const sameOrigin = await server.request('POST', '/url', { body: { url: 'https://example.com' } })
        assert.equal(sameOrigin.status, 200)
    })

    it('携带 API Key 头的请求豁免来源校验', async () => {
        const token = await server.login()
        const key = await server.request('POST', '/api/admin/keys', { cookie: token, body: { name: 'csrf' } })

        const res = await server.request('POST', '/api/open/shorten', {
            headers: { origin: 'https://evil.example.com', authorization: `Bearer ${key.json.key}` },
            body: { url: 'https://example.com/key' },
        })
        assert.equal(res.status, 200)
    })

    it('GET/HEAD 不校验来源', async () => {
        const res = await server.request('GET', '/api/auth/me', { headers: { origin: 'https://evil.example.com' } })
        assert.equal(res.status, 200)
    })
})

describe('写请求缺失来源', () => {
    let server
    before(async () => {
        server = await startTestServer({ config: { security: { csrfAllowMissingOrigin: false } } })
    })
    after(async () => {
        await server.close()
    })

    it('既无 Origin 也无 Referer 时 403', async () => {
        const res = await server.request('POST', '/url', {
            headers: { origin: null, referer: null },
            body: { url: 'https://example.com' },
        })
        assert.equal(res.status, 403)
    })

    it('配置允许缺失来源时放行（模拟纯脚本客户端）', async () => {
        const permissive = await startTestServer({ config: { security: { csrfAllowMissingOrigin: true } } })
        try {
            const res = await permissive.request('POST', '/url', {
                headers: { origin: null, referer: null },
                body: { url: 'https://example.com/script' },
            })
            assert.equal(res.status, 200)
        } finally {
            await permissive.close()
        }
    })
})

describe('创建限流与请求体上限', () => {
    let server
    before(async () => {
        server = await startTestServer({
            config: {
                ratelimit: { createMax: 2, createWindowSeconds: 60 },
                app: { maxBodyBytes: 64 },
            },
        })
    })
    after(async () => {
        await server.close()
    })

    it('窗口内超过上限返回 429', async () => {
        const first = await server.request('POST', '/url', { body: { url: 'https://example.com/1' } })
        const second = await server.request('POST', '/url', { body: { url: 'https://example.com/2' } })
        const third = await server.request('POST', '/url', { body: { url: 'https://example.com/3' } })

        assert.equal(first.status, 200)
        assert.equal(second.status, 200)
        assert.equal(third.status, 429)
        assert.deepEqual(third.json, { error: 'Too Many Attempts' })
    })

    it('请求体超过上限返回 413', async () => {
        const res = await server.request('POST', '/api/admin/settings', {
            body: { code_min_length: 4, padding: 'x'.repeat(100) },
        })
        assert.equal(res.status, 413)
        assert.deepEqual(res.json, { error: 'Payload Too Large' })
    })
})

describe('安全响应头与静态资源', () => {
    let server
    before(async () => {
        server = await startTestServer()
    })
    after(async () => {
        await server.close()
    })

    it('所有响应都带安全头（含 404 与 302）', async () => {
        for (const [method, path] of [['GET', '/api/auth/me'], ['GET', '/nope'], ['GET', '/S']]) {
            const res = await server.request(method, path)
            assert.equal(res.headers['x-content-type-options'], 'nosniff')
            assert.equal(res.headers['x-frame-options'], 'DENY')
            assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin')
            assert.match(res.headers['content-security-policy'], /default-src 'self'/)
            assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/)
        }
    })

    it('HSTS 仅在配置且 HTTPS 请求时下发', async () => {
        const off = await startTestServer()
        const without = await off.request('GET', '/api/auth/me')
        assert.equal(without.headers['strict-transport-security'], undefined)
        await off.close()

        const on = await startTestServer({ config: { security: { hstsMaxAge: 31536000 } } })
        try {
            const viaHttps = await on.request('GET', '/api/auth/me', { headers: { 'x-forwarded-proto': 'https' } })
            assert.equal(viaHttps.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains')

            const viaHttp = await on.request('GET', '/api/auth/me')
            assert.equal(viaHttp.headers['strict-transport-security'], undefined)
        } finally {
            await on.close()
        }
    })

    it('静态资源只从 dist 提供，拒绝路径穿越与非静态扩展名', async () => {
        mkdirSync(join(server.config.app.distDir, 'assets'), { recursive: true })
        writeFileSync(join(server.config.app.distDir, 'index.html'), '<!doctype html><html><body>home</body></html>')
        writeFileSync(join(server.config.app.distDir, 'assets', 'app.js'), 'console.log(1)')

        const home = await server.request('GET', '/')
        assert.equal(home.status, 200)
        assert.match(home.headers['content-type'], /text\/html/)

        const asset = await server.request('GET', '/assets/app.js')
        assert.equal(asset.status, 200)
        assert.match(asset.headers['content-type'], /text\/javascript/)

        const traversal = await server.request('GET', '/../package.json')
        assert.notEqual(traversal.status, 200, '不得读到 dist 之外的文件')
    })

    it('短码指向含 CR/LF 的 URL 时返回 500 而不是注入头', async () => {
        const db = new Database(server.dbPath)
        try {
            db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', 'crlf', 'https://evil.example.com/\r\nX-Injected: 1')
        } finally {
            db.close()
        }

        const res = await server.request('GET', '/crlf')
        assert.equal(res.status, 500)
        assert.equal(res.headers['x-injected'], undefined)
    })

    it('登录 Cookie 在 HTTPS 请求下附带 Secure', async () => {
        const res = await server.request('POST', '/api/auth/login', {
            headers: { 'x-forwarded-proto': 'https' },
            body: { username: 'admin', password: 'secret123' },
        })
        assert.match(res.headers['set-cookie'][0], /; Secure/)
    })
})
