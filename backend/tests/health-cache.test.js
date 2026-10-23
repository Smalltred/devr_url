/**
 * 外链巡检与缓存测试：判定口径、跳过语义、筛选/清理、SSRF 防护、缓存失效与降级。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { Database } from '../src/db/database.js'
import { HttpLinkProbe } from '../src/services/httpLinkProbe.js'
import { startTestServer } from './helpers.js'

/**
 * 可控探测替身：按 URL 返回预设结果，并记录调用顺序。
 *
 * @param {Record<string, {reachable: boolean|null, http_code: number|null, error: string|null}>} responses
 */
function fakeProbe(responses = {}) {
    const probe = {
        probed: [],
        delayMs: 0,
        async probe(url) {
            probe.probed.push(url)
            if (probe.delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, probe.delayMs))
            }

            return responses[url] ?? { reachable: true, http_code: 200, error: null }
        },
    }

    return probe
}

describe('外链巡检', () => {
    /** @type {Awaited<ReturnType<typeof startTestServer>>} */
    let server
    /** @type {Database} */
    let db
    /** @type {ReturnType<typeof fakeProbe>} */
    let probe
    let token

    before(async () => {
        probe = fakeProbe({
            'https://ok.example.com/': { reachable: true, http_code: 200, error: null },
            'https://gone.example.com/': { reachable: false, http_code: 404, error: 'HTTP 404' },
            'https://forbidden.example.com/': { reachable: false, http_code: 403, error: 'HTTP 403' },
            'https://limited.example.com/': { reachable: null, http_code: 429, error: '目标站点限流（429），本次跳过' },
        })
        server = await startTestServer({ deps: { linkProbe: probe } })
        db = new Database(server.dbPath)
        token = await server.login()

        const rows = [
            ['ok1', 'https://ok.example.com/'],
            ['bad1', 'https://gone.example.com/'],
            ['bad2', 'https://forbidden.example.com/'],
            ['skip1', 'https://limited.example.com/'],
        ]
        for (const [code, url] of rows) {
            db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', code, url)
        }
    })

    after(async () => {
        db.close()
        await server.close()
    })

    it('扫描写入 ok/broken，限流记为跳过且不覆盖状态', async () => {
        const res = await server.request('POST', '/api/admin/links/scan', {
            cookie: token,
            body: { limit: 10 },
        })

        assert.equal(res.status, 200)
        assert.equal(res.json.scanned, 4)
        assert.equal(res.json.ok, 1)
        assert.equal(res.json.broken, 2)
        assert.equal(res.json.skipped, 1)
        assert.deepEqual(res.json.summary, { ok: 1, broken: 2, dead: 0, unknown: 1 })

        const broken = db.get("SELECT health_status, health_http_code FROM short_urls WHERE code = 'bad1'")
        assert.equal(broken.health_status, 'broken')
        assert.equal(Number(broken.health_http_code), 404)

        const skipped = db.get("SELECT health_status, health_checked_at FROM short_urls WHERE code = 'skip1'")
        assert.equal(skipped.health_status, 'unknown', '无法判定不修改状态')
        assert.ok(skipped.health_checked_at, '但会刷新检测时间，避免反复探测')
    })

    it('刚检测过的链接不会重复扫描', async () => {
        probe.probed.length = 0
        const res = await server.request('POST', '/api/admin/links/scan', { cookie: token, body: { limit: 10 } })
        assert.equal(res.json.scanned, 0)
        assert.deepEqual(probe.probed, [])
    })

    it('“无法判定”的条目过了重试窗口会被重新探测', async () => {
        // 模拟 11 分钟前检测过（超过 10 分钟重试窗口）
        db.run("UPDATE short_urls SET health_checked_at = datetime('now', '-11 minutes') WHERE health_status = 'unknown'")
        probe.probed.length = 0

        const res = await server.request('POST', '/api/admin/links/scan', { cookie: token, body: { limit: 10 } })
        assert.equal(res.json.scanned, 1, '无法判定的条目应可重试')
        assert.deepEqual(probe.probed, ['https://limited.example.com/'])
    })

    it('按状态筛选与汇总', async () => {
        const broken = await server.request('GET', '/api/admin/links?health=broken', { cookie: token })
        assert.equal(broken.json.total, 2)
        assert.deepEqual(
            broken.json.items.map((item) => item.code).sort(),
            ['bad1', 'bad2'],
        )
        assert.equal(broken.json.health.ok, 1)
        assert.equal(broken.json.health.broken, 2)
        assert.equal(broken.json.health.dead, 0)
        assert.equal(broken.json.health.unknown, 1)
        assert.equal(broken.json.health.pending, 0, '刚检测过的条目在重试窗口内不重复计入')

        const ok = await server.request('GET', '/api/admin/links?health=ok', { cookie: token })
        assert.equal(ok.json.total, 1)
        assert.equal(ok.json.items[0].code, 'ok1')
    })

    it('连续失败达到阈值（默认 3 次）才判定为死链', async () => {
        // 第一次失败已在上面的用例完成（fail_count=1），这里再模拟两次重试
        for (let attempt = 2; attempt <= 3; attempt += 1) {
            db.run("UPDATE short_urls SET health_checked_at = datetime('now', '-11 minutes') WHERE health_status = 'broken'")
            const res = await server.request('POST', '/api/admin/links/scan', { cookie: token, body: { limit: 10 } })

            if (attempt < 3) {
                assert.equal(res.json.broken, 2, `第 ${attempt} 次失败仍为待确认失效`)
                assert.equal(
                    Number(db.get("SELECT health_fail_count AS c FROM short_urls WHERE code = 'bad1'").c),
                    attempt,
                )
            } else {
                assert.equal(res.json.dead, 2, '第 3 次失败判定为死链')
                assert.equal(res.json.broken, 0)
                assert.equal(res.json.summary.dead, 2)
            }
        }

        const dead = db.get("SELECT health_status, health_fail_count FROM short_urls WHERE code = 'bad1'")
        assert.equal(dead.health_status, 'dead')
        assert.equal(Number(dead.health_fail_count), 3)

        // 死链可按状态筛选
        const deadList = await server.request('GET', '/api/admin/links?health=dead', { cookie: token })
        assert.equal(deadList.json.total, 2)
        assert.deepEqual(
            deadList.json.items.map((item) => item.code).sort(),
            ['bad1', 'bad2'],
        )
        assert.equal(deadList.json.items[0].health_fail_count, 3)

        // 死链不再进入 10 分钟重试队列（只按 24 小时复检）
        db.run("UPDATE short_urls SET health_checked_at = datetime('now', '-11 minutes') WHERE health_status = 'dead'")
        const rescan = await server.request('POST', '/api/admin/links/scan', { cookie: token, body: { limit: 10 } })
        assert.equal(rescan.json.scanned, 0)
    })

    it('一键清理删除全部失效链接（待确认与已判定不再区分），保留正常与无法判定', async () => {
        // 失效筛选应同时覆盖已判定失效的条目
        const before = await server.request('GET', '/api/admin/links?health=invalid', { cookie: token })
        assert.equal(before.json.total, 2, '失效筛选应包含已判定失效的条目')

        const res = await server.request('POST', '/api/admin/links/cleanup-invalid', { cookie: token })
        assert.equal(res.status, 200)
        assert.equal(res.json.deleted, 2)
        assert.equal(res.json.health.invalid, 0, '清理后失效计数归零')

        const remaining = db.all('SELECT code FROM short_urls ORDER BY code')
        assert.deepEqual(
            remaining.map((row) => row.code),
            ['ok1', 'skip1'],
        )
    })

    it('兼容别名 cleanup-dead 同样清理待确认失效', async () => {
        // 造一条待确认失效（未达阈值）与一条正常
        db.run("UPDATE short_urls SET health_status = 'broken', health_fail_count = 1 WHERE code = 'ok1'")

        const res = await server.request('POST', '/api/admin/links/cleanup-dead', { cookie: token })
        assert.equal(res.status, 200)
        assert.equal(res.json.deleted, 1, '别名接口同样清理待确认失效')
        assert.equal(res.json.health.invalid, 0)
    })

    it('时间预算内至少检测一条，剩余留待下一批', async () => {
        const slow = fakeProbe()
        // 每条 400ms，预算 1s：必须提前结束而不是跑满 5 条（总计约 2s）
        slow.delayMs = 400
        const budgetServer = await startTestServer({ deps: { linkProbe: slow } })
        try {
            const budgetDb = new Database(budgetServer.dbPath)
            for (let i = 1; i <= 5; i += 1) {
                budgetDb.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', `slow${i}`, `https://slow.example.com/${i}`)
            }
            budgetDb.close()

            const result = await budgetServer.app.services.health.scanBatch(5, 1)
            assert.ok(result.scanned >= 1)
            assert.ok(result.scanned < 5, '超预算应提前结束')
            assert.ok(result.remaining > 0)
        } finally {
            await budgetServer.close()
        }
    })
})

describe('SSRF 防护', () => {
    it('拒绝内网、环回、链路本地与保留地址', async () => {
        const blocked = [
            'http://127.0.0.1/admin',
            'http://localhost:6379/',
            'http://10.0.0.5/',
            'http://192.168.1.1/',
            'http://169.254.169.254/latest/meta-data/',
            'http://[::1]/',
            'http://172.16.0.1/',
        ]
        for (const url of blocked) {
            assert.equal(await HttpLinkProbe.assertSafeUrl(url), '目标指向内网或保留地址，已跳过', url)
        }
    })

    it('拒绝非 http(s) 与非法地址', async () => {
        assert.equal(await HttpLinkProbe.assertSafeUrl('file:///etc/passwd'), '仅支持 http/https 地址')
        assert.equal(await HttpLinkProbe.assertSafeUrl('gopher://example.com/'), '仅支持 http/https 地址')
        assert.equal(await HttpLinkProbe.assertSafeUrl('not-a-url'), '目标地址格式无效')
    })

    it('放行公网 IP 字面量', async () => {
        assert.equal(await HttpLinkProbe.assertSafeUrl('http://93.184.216.34/'), null)
        assert.equal(await HttpLinkProbe.assertSafeUrl('https://8.8.8.8/'), null)
    })

    it('跳转地址解析', () => {
        assert.equal(HttpLinkProbe.resolveLocation('https://example.com/a/c', '/a/b'), 'https://example.com/a/b')
        assert.equal(HttpLinkProbe.resolveLocation('https://example.com/x/y', 'b'), 'https://example.com/x/b')
        assert.equal(HttpLinkProbe.resolveLocation('https://example.com/x', '//cdn.example.com/z'), 'https://cdn.example.com/z')
        assert.equal(HttpLinkProbe.resolveLocation('https://example.com/x', 'http://other.com/p'), 'http://other.com/p')
        assert.equal(HttpLinkProbe.resolveLocation('https://example.com/x', ''), null)
    })

    it('状态码判定口径', () => {
        assert.deepEqual(HttpLinkProbe.classify(200), { reachable: true, http_code: 200, error: null })
        assert.deepEqual(HttpLinkProbe.classify(302), { reachable: true, http_code: 302, error: null })
        assert.deepEqual(HttpLinkProbe.classify(404), { reachable: false, http_code: 404, error: 'HTTP 404' })
        assert.equal(HttpLinkProbe.classify(429).reachable, null)
        assert.equal(HttpLinkProbe.classify(408).reachable, null)
        assert.equal(HttpLinkProbe.classify(500).reachable, false)
    })
})

describe('连接异常判定（本地服务）', () => {
    /** @type {import('node:http').Server[]} */
    const servers = []
    /** @type {HttpLinkProbe} */
    let probe

    before(async () => {
        probe = new HttpLinkProbe({ timeoutSeconds: 2, connectTimeoutSeconds: 1, allowPrivateTargets: true })
    })

    after(async () => {
        await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    })

    /**
     * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} handler
     */
    async function start(handler) {
        const server = createHttpServer(handler)
        servers.push(server)
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

        return `http://127.0.0.1:${server.address().port}/file.png`
    }

    it('200 判为正常', async () => {
        const url = await start((req, res) => {
            res.statusCode = 200
            res.end('ok')
        })

        assert.deepEqual(await probe.probe(url), { reachable: true, http_code: 200, error: null })
    })

    it('404 判为失效', async () => {
        const url = await start((req, res) => {
            res.statusCode = 404
            res.end()
        })

        assert.deepEqual(await probe.probe(url), { reachable: false, http_code: 404, error: 'HTTP 404' })
    })

    it('对端重置连接（浏览器 ERR_CONNECTION_CLOSED）判为失效，而不是无法判定', async () => {
        const url = await start((req) => {
            req.socket.destroy()
        })

        const result = await probe.probe(url)
        assert.equal(result.reachable, false, '连接被终止必须判为失效')
        assert.match(String(result.error), /连接被终止|网络错误/)
    })

    it('对端关闭连接且不返回响应，同样判为失效', async () => {
        const url = await start((req, res) => {
            res.destroy()
        })

        const result = await probe.probe(url)
        assert.equal(result.reachable, false)
    })

    it('迟迟不响应判为超时失效', async () => {
        const url = await start(() => {
            // 故意不响应，由探测器的超时终止
        })

        const result = await probe.probe(url)
        assert.equal(result.reachable, false)
        assert.equal(result.error, '请求超时')
    })

    it('域名不存在（NXDOMAIN）判为失效；内网地址仍保持无法判定', async () => {
        const missing = await probe.probe('https://definitely-not-exists-9f3a.invalid/x.png')
        assert.equal(missing.reachable, false, '域名不存在属于确定性失效')
        assert.match(String(missing.error), /域名不存在/)

        const unsafe = await HttpLinkProbe.inspectSafety('http://127.0.0.1/')
        assert.equal(unsafe.permanent, false, '内网地址只是跳过，不能据此删除')
        assert.equal(await HttpLinkProbe.assertSafeUrl('http://127.0.0.1/'), '目标指向内网或保留地址，已跳过')
    })
})

describe('短链缓存', () => {
    /**
     * 可观测的内存缓存替身。
     */
    function fakeStore(initial = {}) {
        const store = {
            data: new Map(Object.entries(initial)),
            ttls: [],
            calls: { get: 0, set: 0, delete: 0 },
            async get(key) {
                store.calls.get += 1

                return store.data.has(key) ? store.data.get(key) : null
            },
            async set(key, value, ttl) {
                store.calls.set += 1
                store.ttls.push(ttl)
                store.data.set(key, value)

                return true
            },
            async delete(key) {
                store.calls.delete += 1
                store.data.delete(key)

                return true
            },
            status() {
                return { driver: 'fake', enabled: true, available: true, servers: ['fake'], ttl: 300, negative_ttl: 30 }
            },
            async stats() {
                return { hits: 0, misses: 0, items: store.data.size }
            },
        }

        return store
    }

    it('命中缓存时不再查库', async () => {
        const store = fakeStore({ 'url:cached': 'https://from-cache.example.com' })
        const server = await startTestServer({ deps: { cache: store } })
        try {
            const res = await server.request('GET', '/cached')
            assert.equal(res.status, 302)
            assert.equal(res.headers.location, 'https://from-cache.example.com')
        } finally {
            await server.close()
        }
    })

    it('负缓存命中直接 404', async () => {
        const store = fakeStore({ 'url:ghost': '\0__devr_miss__' })
        const server = await startTestServer({ deps: { cache: store } })
        try {
            const res = await server.request('GET', '/ghost')
            assert.equal(res.status, 404)
            assert.deepEqual(res.json, { error: 'Unknown URL' })
        } finally {
            await server.close()
        }
    })

    it('首次跳转回填缓存，改 URL / 删除时主动失效', async () => {
        const store = fakeStore()
        const server = await startTestServer({ deps: { cache: store } })
        try {
            const token = await server.login()
            const created = await server.request('POST', '/url', { body: { url: 'https://example.com/v1' } })
            const code = created.json.code

            await server.request('GET', `/${code}`)
            assert.equal(store.data.get(`url:${code}`), 'https://example.com/v1', '回填缓存')

            await server.request('GET', `/${code}`)
            assert.equal(store.data.get(`url:${code}`), 'https://example.com/v1')

            await server.request('PUT', `/api/admin/links/${code}`, {
                cookie: token,
                body: { url: 'https://example.com/v2' },
            })
            assert.equal(store.data.has(`url:${code}`), false, '改 URL 后失效')

            const redirect = await server.request('GET', `/${code}`)
            assert.equal(redirect.headers.location, 'https://example.com/v2')

            await server.request('DELETE', `/api/admin/links/${code}`, { cookie: token })
            assert.equal(store.data.has(`url:${code}`), false, '删除后失效')
        } finally {
            await server.close()
        }
    })

    it('缓存整体故障时跳转与创建仍然可用', async () => {
        const broken = {
            async get() {
                throw new Error('cache down')
            },
            async set() {
                throw new Error('cache down')
            },
            async delete() {
                throw new Error('cache down')
            },
            status() {
                return { driver: 'fake', enabled: true, available: false, servers: ['fake'], ttl: 300, negative_ttl: 30 }
            },
            async stats() {
                return { hits: 0, misses: 0, items: 0 }
            },
        }
        const server = await startTestServer({ deps: { cache: broken } })
        try {
            const created = await server.request('POST', '/url', { body: { url: 'https://example.com/resilient' } })
            assert.equal(created.status, 200)

            const redirect = await server.request('GET', `/${created.json.code}`)
            assert.equal(redirect.status, 302)
            assert.equal(redirect.headers.location, 'https://example.com/resilient')

            const missing = await server.request('GET', '/ghost')
            assert.equal(missing.status, 404)
        } finally {
            await server.close()
        }
    })

    it('缓存 TTL 走向设置值，0 表示不写缓存', async () => {
        const store = fakeStore()
        const server = await startTestServer({ deps: { cache: store } })
        try {
            await server.request('POST', '/url', { body: { url: 'https://example.com/ttl' } })
            store.ttls.length = 0
            await server.request('GET', '/S')
            assert.deepEqual(store.ttls, [300])

            const token = await server.login()
            await server.request('PUT', '/api/admin/settings', { cookie: token, body: { cache_ttl: 0 } })
            store.data.clear()
            store.ttls.length = 0
            await server.request('GET', '/S')
            assert.deepEqual(store.ttls, [], 'cache_ttl=0 时不得写入')
        } finally {
            await server.close()
        }
    })
})
