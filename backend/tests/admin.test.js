/**
 * 管理后台行为测试：鉴权、短链 CRUD、统计粒度、设置、API Key、面板入口。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Database } from '../src/db/database.js'
import { startTestServer } from './helpers.js'

describe('管理后台 · 基础', () => {
    /** @type {Awaited<ReturnType<typeof startTestServer>>} */
    let server
    /** @type {Database} */
    let db
    /** @type {string} */
    let token

    before(async () => {
        server = await startTestServer()
        db = new Database(server.dbPath)
        token = await server.login()
    })

    after(async () => {
        db.close()
        await server.close()
    })

    it('未登录访问管理接口一律 401', async () => {
        const paths = [
            ['GET', '/api/admin/overview'],
            ['GET', '/api/admin/links'],
            ['GET', '/api/admin/settings'],
            ['PUT', '/api/admin/settings'],
            ['POST', '/api/admin/links/scan'],
            ['POST', '/api/admin/links/cleanup-broken'],
            ['GET', '/api/admin/keys'],
            ['POST', '/api/admin/keys'],
            ['PUT', '/api/admin/links/S'],
            ['DELETE', '/api/admin/links/S'],
            ['GET', '/api/admin/links/S/stats'],
        ]
        for (const [method, path] of paths) {
            const res = await server.request(method, path, { body: '{}' })
            assert.equal(res.status, 401, `${method} ${path}`)
        }
    })

    it('密码错误返回中文文案，非字符串凭据同样 401', async () => {
        const wrong = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'bad' } })
        assert.equal(wrong.status, 401)
        assert.equal(wrong.json.error, '用户名或密码错误')

        const weird = await server.request('POST', '/api/auth/login', { body: { username: 1, password: 2 } })
        assert.equal(weird.status, 401)
    })

    it('登录成功下发 HttpOnly + SameSite=Strict Cookie', async () => {
        const res = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'secret123' } })
        assert.equal(res.status, 200)
        assert.deepEqual(res.json, { ok: true })
        const cookie = res.headers['set-cookie'][0]
        assert.match(cookie, /admin_token=[0-9a-f]{64}/)
        assert.match(cookie, /HttpOnly/)
        assert.match(cookie, /SameSite=Strict/)
        assert.match(cookie, /Max-Age=604800/)
    })

    it('me 返回 authenticated 与 require_login', async () => {
        const authed = await server.request('GET', '/api/auth/me', { cookie: token })
        assert.deepEqual(authed.json, { authenticated: true, require_login: false })

        const anonymous = await server.request('GET', '/api/auth/me')
        assert.deepEqual(anonymous.json, { authenticated: false, require_login: false })
    })

    it('登出撤销 token', async () => {
        const tempToken = await server.login()
        const out = await server.request('POST', '/api/auth/logout', { cookie: tempToken })
        assert.equal(out.status, 200)
        assert.match(out.headers['set-cookie'][0], /Max-Age=0/)

        const me = await server.request('GET', '/api/auth/me', { cookie: tempToken })
        assert.equal(me.json.authenticated, false)
    })

    it('列表分页与搜索', async () => {
        for (let i = 1; i <= 25; i += 1) {
            db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', `code${i}`, `https://example.com/${i}`)
        }

        const page1 = await server.request('GET', '/api/admin/links?page=1&per_page=20', { cookie: token })
        assert.equal(page1.json.total, 25)
        assert.equal(page1.json.items.length, 20)
        assert.equal(page1.json.items[0].code, 'code25', '最新创建的排最前')

        const page2 = await server.request('GET', '/api/admin/links?page=2&per_page=20', { cookie: token })
        assert.equal(page2.json.items.length, 5)

        const search = await server.request('GET', '/api/admin/links?q=code25', { cookie: token })
        assert.equal(search.json.total, 1)
        assert.equal(search.json.items[0].code, 'code25')
    })

    it('列表按健康状态筛选', async () => {
        db.run("UPDATE short_urls SET health_status = 'broken', health_http_code = 404 WHERE code = 'code1'")
        const broken = await server.request('GET', '/api/admin/links?health=broken', { cookie: token })
        assert.equal(broken.json.total, 1)
        assert.equal(broken.json.items[0].code, 'code1')
        assert.equal(broken.json.items[0].health_http_code, 404)
        assert.equal(broken.json.health.broken, 1)
    })

    it('改 URL / 改短码 / 冲突 / 非法短码 / 保留字 / 不存在', async () => {
        db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', 'abc', 'https://old.example.com')
        db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', 'taken', 'https://taken.example.com')

        const urlOnly = await server.request('PUT', '/api/admin/links/abc', {
            cookie: token,
            body: { url: 'https://new.example.com' },
        })
        assert.equal(urlOnly.status, 200)
        assert.deepEqual(urlOnly.json, { code: 'abc', url: 'https://new.example.com' })

        const renamed = await server.request('PUT', '/api/admin/links/abc', {
            cookie: token,
            body: { code: 'xyz' },
        })
        assert.equal(renamed.status, 200)
        assert.equal(renamed.json.code, 'xyz')
        assert.equal(db.get("SELECT url FROM short_urls WHERE code = 'xyz'").url, 'https://new.example.com')
        assert.equal(db.get("SELECT 1 AS ok FROM short_urls WHERE code = 'abc'"), undefined)

        const conflict = await server.request('PUT', '/api/admin/links/xyz', {
            cookie: token,
            body: { code: 'taken' },
        })
        assert.equal(conflict.status, 409)
        assert.deepEqual(conflict.json, { error: 'Short Code Already Exists' })

        const invalid = await server.request('PUT', '/api/admin/links/xyz', {
            cookie: token,
            body: { code: '非 法!' },
        })
        assert.equal(invalid.status, 400)
        assert.equal(invalid.json.error, '短码只能包含 1-32 位英文字母或数字')

        const reserved = await server.request('PUT', '/api/admin/links/xyz', {
            cookie: token,
            body: { code: 'ADMIN' },
        })
        assert.equal(reserved.status, 400)
        assert.equal(reserved.json.error, '该短码为系统保留，请换一个')

        const missing = await server.request('PUT', '/api/admin/links/ghost', {
            cookie: token,
            body: { url: 'https://example.com' },
        })
        assert.equal(missing.status, 404)
    })

    it('删除短链后跳转变 404', async () => {
        db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', 'deleteme', 'https://example.com/gone')

        const deleted = await server.request('DELETE', '/api/admin/links/deleteme', { cookie: token })
        assert.equal(deleted.status, 200)
        assert.deepEqual(deleted.json, { ok: true })

        const redirect = await server.request('GET', '/deleteme')
        assert.equal(redirect.status, 404)

        const again = await server.request('DELETE', '/api/admin/links/deleteme', { cookie: token })
        assert.equal(again.status, 404)
    })

    it('概览与单链统计（含四种粒度桶数）', async () => {
        db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', 'stats1', 'https://example.com/stat')
        db.run("INSERT INTO short_url_clicks (code, clicked_at, referer_host, device, ip_hash) VALUES ('stats1', datetime('now'), 'google.com', 'desktop', 'ip-1')")
        db.run("INSERT INTO short_url_clicks (code, clicked_at, referer_host, device, ip_hash) VALUES ('stats1', datetime('now'), 'google.com', 'mobile', 'ip-2')")
        db.run("INSERT INTO short_url_clicks (code, clicked_at, referer_host, device, ip_hash) VALUES ('stats1', datetime('now'), 'bing.com', 'desktop', 'ip-1')")

        const expectedBuckets = { day: 14, week: 12, month: 12, year: 5 }
        for (const [period, buckets] of Object.entries(expectedBuckets)) {
            const overview = await server.request(`GET`, `/api/admin/overview?period=${period}`, { cookie: token })
            assert.equal(overview.json.period, period)
            assert.equal(overview.json.daily.length, buckets)
            assert.equal(overview.json.daily.at(-1).clicks, 3, `${period} 当前桶应包含今日 3 次点击`)

            const stats = await server.request('GET', `/api/admin/links/stats1/stats?period=${period}`, { cookie: token })
            assert.equal(stats.json.period, period)
            assert.equal(stats.json.daily.length, buckets)
            assert.equal(stats.json.total_clicks, 3)
            assert.equal(stats.json.visitors, 2)
            assert.equal(stats.json.referers[0].referer_host, 'google.com')
            assert.equal(stats.json.referers[0].clicks, 2)
            assert.deepEqual(stats.json.devices, { mobile: 1, desktop: 2 })
        }

        // 月/年桶起点必须是自然月/年边界
        const monthly = await server.request('GET', '/api/admin/overview?period=month', { cookie: token })
        for (const point of monthly.json.daily) {
            assert.match(point.date, /^\d{4}-\d{2}-01$/)
        }
        const yearly = await server.request('GET', '/api/admin/overview?period=year', { cookie: token })
        for (const point of yearly.json.daily) {
            assert.match(point.date, /^\d{4}-01-01$/)
        }
    })

    it('非法粒度回落为 day', async () => {
        const res = await server.request('GET', '/api/admin/overview?period=hourly', { cookie: token })
        assert.equal(res.json.period, 'day')
        assert.equal(res.json.daily.length, 14)
    })

    it('设置读取与更新校验', async () => {
        const view = await server.request('GET', '/api/admin/settings', { cookie: token })
        assert.equal(view.status, 200)
        assert.equal(view.json.code_min_length, 1)
        assert.equal(view.json.cache_ttl, 300)
        assert.equal(view.json.password_source, 'env')
        assert.equal(view.json.cache.driver, 'null')
        // 每日巡检默认 12:00、连续 3 次失败判定死链
        assert.equal(view.json.health_scan_enabled, true)
        assert.equal(view.json.health_scan_hour, 12)
        assert.equal(view.json.health_scan_minute, 0)
        assert.equal(view.json.health_dead_threshold, 3)

        const badLength = await server.request('PUT', '/api/admin/settings', { cookie: token, body: { code_min_length: 20 } })
        assert.equal(badLength.status, 400)

        const badTtl = await server.request('PUT', '/api/admin/settings', { cookie: token, body: { cache_ttl: 99999 } })
        assert.equal(badTtl.status, 400)

        const randomTooShort = await server.request('PUT', '/api/admin/settings', { cookie: token, body: { code_random: true } })
        assert.equal(randomTooShort.status, 400)

        // 巡检配置校验
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { health_scan_hour: 24 } })).status, 400)
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { health_scan_minute: 60 } })).status, 400)
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { health_dead_threshold: 0 } })).status, 400)
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { health_dead_threshold: 11 } })).status, 400)

        const saved = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: {
                code_min_length: 4,
                code_random: false,
                require_login: false,
                cache_ttl: 600,
                health_scan_enabled: true,
                health_scan_hour: 9,
                health_scan_minute: 30,
                health_dead_threshold: 5,
            },
        })
        assert.equal(saved.status, 200)
        assert.equal(saved.json.code_min_length, 4)
        assert.equal(saved.json.cache_ttl, 600)
        assert.equal(saved.json.health_scan_hour, 9)
        assert.equal(saved.json.health_scan_minute, 30)
        assert.equal(saved.json.health_dead_threshold, 5)

        // 长度补齐生效
        const created = await server.request('POST', '/url', { body: { url: 'https://example.com/padded' } })
        assert.equal(created.json.code.length, 4)
    })

    it('API Key 创建、列表、重置、删除与开放 API', async () => {
        const created = await server.request('POST', '/api/admin/keys', { cookie: token, body: { name: 'ci' } })
        assert.equal(created.status, 200)
        assert.match(created.json.key, /^devr_[0-9a-f]{32}$/)
        assert.equal(created.json.prefix, created.json.key.slice(0, 12))

        const list = await server.request('GET', '/api/admin/keys', { cookie: token })
        assert.equal(list.json.items.length, 1)
        assert.equal(list.json.items[0].name, 'ci')
        assert.equal(JSON.stringify(list.json).includes(created.json.key), false, '列表不得泄露明文')

        const open = await server.request('POST', '/api/open/shorten', {
            headers: { authorization: `Bearer ${created.json.key}` },
            body: { url: 'https://example.com/open' },
        })
        assert.equal(open.status, 200)
        assert.ok(open.json.code)

        const xApiKey = await server.request('POST', '/api/open/shorten', {
            headers: { 'x-api-key': created.json.key },
            body: { url: 'https://example.com/open2' },
        })
        assert.equal(xApiKey.status, 200)

        const reset = await server.request('POST', `/api/admin/keys/${created.json.id}/reset`, { cookie: token })
        assert.equal(reset.status, 200)
        assert.notEqual(reset.json.key, created.json.key)

        const oldKey = await server.request('POST', '/api/open/shorten', {
            headers: { authorization: `Bearer ${created.json.key}` },
            body: { url: 'https://example.com/old' },
        })
        assert.equal(oldKey.status, 401)
        assert.equal(oldKey.json.error, 'Invalid API Key')

        const removed = await server.request('DELETE', `/api/admin/keys/${created.json.id}`, { cookie: token })
        assert.equal(removed.status, 200)

        const afterDelete = await server.request('POST', '/api/open/shorten', {
            headers: { authorization: `Bearer ${reset.json.key}` },
            body: { url: 'https://example.com/gone' },
        })
        assert.equal(afterDelete.status, 401)
    })

    it('/admin 在未构建前端时返回 404 文案，构建后返回 HTML 并放行内联脚本', async () => {
        const missing = await server.request('GET', '/admin')
        assert.equal(missing.status, 404)
        assert.equal(missing.text, 'Frontend build not found. Run "npm run build" first.')

        server.writeDistIndex('<!doctype html><html><head><script>window.x=1</script></head><body>admin</body></html>')
        const page = await server.request('GET', '/admin')
        assert.equal(page.status, 200)
        assert.match(page.headers['content-type'], /text\/html/)
        assert.match(page.headers['content-security-policy'], /'sha256-[A-Za-z0-9+/=]+'/)
    })
})

describe('管理后台 · 登录节流', () => {
    let server
    before(async () => {
        server = await startTestServer()
    })
    after(async () => {
        await server.close()
    })

    it('同 IP 连续失败 5 次后锁定，正确密码也返回 429', async () => {
        for (let i = 0; i < 5; i += 1) {
            const res = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'bad' } })
            assert.equal(res.status, 401)
        }

        const locked = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'secret123' } })
        assert.equal(locked.status, 429)
        assert.deepEqual(locked.json, { error: 'Too Many Attempts' })
    })
})

describe('管理后台 · 改密', () => {
    let server
    before(async () => {
        server = await startTestServer()
    })
    after(async () => {
        await server.close()
    })

    it('改密：当前密码错误 401、新密码过短 400、成功后旧 token 失效且旧密码不可用', async () => {
        const token = await server.login()

        const wrong = await server.request('POST', '/api/admin/settings/password', {
            cookie: token,
            body: { current_password: 'bad', new_password: 'newpassword1' },
        })
        assert.equal(wrong.status, 401)
        assert.equal(wrong.json.error, '当前密码不正确')

        const short = await server.request('POST', '/api/admin/settings/password', {
            cookie: token,
            body: { current_password: 'secret123', new_password: 'short' },
        })
        assert.equal(short.status, 400)

        const changed = await server.request('POST', '/api/admin/settings/password', {
            cookie: token,
            body: { current_password: 'secret123', new_password: 'newpassword1' },
        })
        assert.equal(changed.status, 200)

        const me = await server.request('GET', '/api/auth/me', { cookie: token })
        assert.equal(me.json.authenticated, false, '改密后全部登录态失效')

        const oldLogin = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'secret123' } })
        assert.equal(oldLogin.status, 401)

        const newLogin = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'newpassword1' } })
        assert.equal(newLogin.status, 200)

        const newToken = /admin_token=([^;]+)/.exec(newLogin.headers['set-cookie'][0])[1]
        const settings = await server.request('GET', '/api/admin/settings', { cookie: newToken })
        assert.equal(settings.json.password_source, 'custom')
    })
})

describe('管理后台 · 登录门控', () => {
    let server
    before(async () => {
        server = await startTestServer()
    })
    after(async () => {
        await server.close()
    })

    it('开启 require_login 后未登录创建被拒，开放 API 不受影响', async () => {
        const token = await server.login()

        const enabled = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { require_login: true },
        })
        assert.equal(enabled.json.require_login, true)

        const anonymous = await server.request('POST', '/url', { body: { url: 'https://example.com/gated' } })
        assert.equal(anonymous.status, 401)

        const me = await server.request('GET', '/api/auth/me')
        assert.equal(me.json.require_login, true)

        const authed = await server.request('POST', '/url', { cookie: token, body: { url: 'https://example.com/ok' } })
        assert.equal(authed.status, 200)

        const key = await server.request('POST', '/api/admin/keys', { cookie: token, body: { name: 'open' } })
        const open = await server.request('POST', '/api/open/shorten', {
            headers: { authorization: `Bearer ${key.json.key}` },
            body: { url: 'https://example.com/open-gated' },
        })
        assert.equal(open.status, 200, '开放 API 用 Key 鉴权，不受 require_login 影响')
    })
})
