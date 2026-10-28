/**
 * 管理后台行为测试：鉴权、短链 CRUD、统计粒度、设置、API Key、面板入口。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Database } from '../src/db/database.js'
import { chinaDateString } from '../src/support/chinaTime.js'
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
        assert.deepEqual(authed.json, {
            authenticated: true,
            require_login: false,
            admin_entry_custom: false,
            admin_path: '/admin',
        })

        // 匿名响应不泄露自定义入口
        const anonymous = await server.request('GET', '/api/auth/me')
        assert.deepEqual(anonymous.json, {
            authenticated: false,
            require_login: false,
            admin_entry_custom: false,
        })
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

    it('列表按目标域名精确筛选，并返回域名汇总', async () => {
        const rows = [
            ['domA', 'https://dom-test.example/a'],
            ['domB', 'https://DOM-TEST.example/b'],
            ['domC', 'https://sub.dom-test.example/c'],
            ['domD', 'https://other-test.example/d'],
            ['domE', 'https://dom-test.example:8443/e'],
        ]

        try {
            for (const [code, url] of rows) {
                db.run('INSERT INTO short_urls (code, url) VALUES (?, ?)', code, url)
            }

            // 大小写不敏感；只匹配精确主机名，不包含子域名或带端口的变体
            const filtered = await server.request(
                'GET',
                '/api/admin/links?per_page=100&domain=DOM-TEST.EXAMPLE',
                { cookie: token },
            )
            assert.equal(filtered.status, 200)
            assert.equal(filtered.json.total, 2)
            assert.deepEqual(filtered.json.items.map((item) => item.code).sort(), ['domA', 'domB'])

            const domains = Object.fromEntries(filtered.json.domains.map((item) => [item.domain, item.count]))
            assert.equal(domains['dom-test.example'], 2)
            assert.equal(domains['sub.dom-test.example'], 1)
            assert.equal(domains['other-test.example'], 1)
            assert.equal(domains['dom-test.example:8443'], 1)
        } finally {
            db.run("DELETE FROM short_urls WHERE code IN ('domA', 'domB', 'domC', 'domD', 'domE')")
        }
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
            if (period === 'day') {
                assert.equal(stats.json.daily.at(-1).date, chinaDateString(), '日桶末位应为北京时间当天')
            }
            assert.equal(stats.json.visitors, 2)
            assert.equal(stats.json.referers[0].referer_host, 'google.com')
            assert.equal(stats.json.referers[0].clicks, 2)
            assert.deepEqual(stats.json.devices, { mobile: 1, desktop: 2 })
            // 直接写库的存量短链没有创建者信息
            assert.equal(stats.json.creator.type, 'unknown')
            assert.equal(stats.json.creator.label, '历史数据')
            assert.equal(stats.json.creator.ip, null)
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

    it('统计记录创建者身份、真实 IP 与设备', async () => {
        const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        const mobileUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

        // 游客：代理头里的 X-Real-IP 应作为真实 IP（请求来自回环地址，代理头可信）
        const guest = await server.request('POST', '/url', {
            headers: { 'user-agent': desktopUa, 'x-real-ip': '203.0.113.10' },
            body: { url: 'https://example.com/creator-guest' },
        })
        assert.equal(guest.status, 200)
        const guestStats = await server.request('GET', `/api/admin/links/${guest.json.code}/stats`, { cookie: token })
        assert.equal(guestStats.status, 200)
        assert.deepEqual(
            {
                type: guestStats.json.creator.type,
                label: guestStats.json.creator.label,
                ip: guestStats.json.creator.ip,
                device: guestStats.json.creator.device,
            },
            { type: 'guest', label: '游客', ip: '203.0.113.10', device: '桌面 · Windows · Chrome' },
        )
        assert.match(guestStats.json.creator.user_agent, /Chrome\/120/)
        assert.match(guestStats.json.creator.created_at, /^\d{4}-\d{2}-\d{2} /)

        // 管理员登录后创建
        const admin = await server.request('POST', '/url', {
            cookie: token,
            body: { url: 'https://example.com/creator-admin' },
        })
        const adminStats = await server.request('GET', `/api/admin/links/${admin.json.code}/stats`, { cookie: token })
        assert.equal(adminStats.json.creator.type, 'admin')
        assert.equal(adminStats.json.creator.label, '管理员（admin）')
        assert.equal(adminStats.json.creator.name, 'admin')

        // 开放 API：记录 API Key 名称与移动设备
        const key = await server.request('POST', '/api/admin/keys', { cookie: token, body: { name: 'CI 机器人' } })
        const open = await server.request('POST', '/api/open/shorten', {
            headers: {
                authorization: `Bearer ${key.json.key}`,
                'user-agent': mobileUa,
                'x-real-ip': '203.0.113.11',
            },
            body: { url: 'https://example.com/creator-key' },
        })
        assert.equal(open.status, 200)
        const openStats = await server.request('GET', `/api/admin/links/${open.json.code}/stats`, { cookie: token })
        assert.equal(openStats.json.creator.type, 'api_key')
        assert.equal(openStats.json.creator.label, 'API Key：CI 机器人')
        assert.equal(openStats.json.creator.ip, '203.0.113.11')
        assert.equal(openStats.json.creator.device, '移动 · iOS · Safari')

        // 清理本用例创建的 Key，避免影响后续「Key 列表只有 1 个」的断言
        assert.equal((await server.request('DELETE', `/api/admin/keys/${key.json.id}`, { cookie: token })).status, 200)
    })

    it('设置读取与更新校验', async () => {
        const view = await server.request('GET', '/api/admin/settings', { cookie: token })
        assert.equal(view.status, 200)
        assert.equal(view.json.code_min_length, 1)
        assert.equal(view.json.cache_ttl, 300)
        assert.equal(view.json.password_source, 'env')
        assert.equal(view.json.cache.driver, 'null')
        // 游客访问默认开启（与旧 require_login 互斥）
        assert.equal(view.json.guest_access_enabled, true)
        assert.equal(view.json.require_login, false)
        // 后台入口默认 /admin
        assert.equal(view.json.admin_path, '/admin')
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

        // 安全入口校验：长度/字符/保留路径/与现有短码冲突
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { admin_path: 'ab' } })).status, 400)
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { admin_path: '/bad path' } })).status, 400)
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { admin_path: '/api' } })).status, 400)
        assert.equal((await server.request('PUT', '/api/admin/settings', { cookie: token, body: { admin_path: '/stats1' } })).status, 400)

        // 省略前导斜杠、末尾斜杠都会归一
        const customPath = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { admin_path: 'my-panel/' },
        })
        assert.equal(customPath.status, 200)
        assert.equal(customPath.json.admin_path, '/my-panel')
        const restoredPath = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { admin_path: '/admin' },
        })
        assert.equal(restoredPath.json.admin_path, '/admin')

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
        // 前端按该标记挂载 AdminApp
        assert.match(page.text, /<meta name="devr-app" content="admin">/)
    })

    it('自定义安全入口：新路径可用、旧路径消失、匿名响应不泄露入口', async () => {
        const entry = '/Secure-Entry_9'
        const saved = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { admin_path: entry },
        })
        assert.equal(saved.status, 200)
        assert.equal(saved.json.admin_path, entry)

        // 默认入口彻底消失
        const oldPath = await server.request('GET', '/admin')
        assert.equal(oldPath.status, 404)

        // 新入口返回后台页面（含末尾斜杠与 noindex）
        const page = await server.request('GET', entry)
        assert.equal(page.status, 200)
        assert.match(page.text, /<meta name="devr-app" content="admin">/)
        assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow')
        assert.equal((await server.request('GET', `${entry}/`)).status, 200)
        assert.equal((await server.request('POST', entry, { body: '{}' })).status, 405)

        // 匿名只知道「是自定义入口」，拿不到具体路径；登录后才下发
        const anonymous = await server.request('GET', '/api/auth/me')
        assert.equal(anonymous.json.admin_entry_custom, true)
        assert.equal(Object.prototype.hasOwnProperty.call(anonymous.json, 'admin_path'), false)
        const authed = await server.request('GET', '/api/auth/me', { cookie: token })
        assert.equal(authed.json.admin_path, entry)

        // 短链跳转不受影响
        const created = await server.request('POST', '/url', { body: { url: 'https://example.com/entry' } })
        assert.equal((await server.request('GET', `/${created.json.code}`)).status, 302)

        // 恢复默认入口
        const reset = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { admin_path: '/admin' },
        })
        assert.equal(reset.json.admin_path, '/admin')
        assert.equal((await server.request('GET', '/admin')).status, 200)
        assert.equal((await server.request('GET', entry)).status, 404)
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

    it('关闭游客访问后未登录创建被拒，开放 API 不受影响', async () => {
        const token = await server.login()

        // 旧键 require_login 仍兼容：true 等价于关闭游客访问
        const enabled = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { require_login: true },
        })
        assert.equal(enabled.json.require_login, true)
        assert.equal(enabled.json.guest_access_enabled, false)

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

        // 规范键 guest_access_enabled 重新开启，两个键保持互斥
        const reopened = await server.request('PUT', '/api/admin/settings', {
            cookie: token,
            body: { guest_access_enabled: true },
        })
        assert.equal(reopened.json.guest_access_enabled, true)
        assert.equal(reopened.json.require_login, false)

        const guest = await server.request('POST', '/url', { body: { url: 'https://example.com/guest-back' } })
        assert.equal(guest.status, 200)
        assert.equal((await server.request('GET', '/api/auth/me')).json.require_login, false)
    })
})
