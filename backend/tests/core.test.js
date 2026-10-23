/**
 * 核心契约测试：短码算法、URL 校验、创建/跳转/错误语义。
 * 这些行为必须与旧 PHP 实现逐字一致（存量短码与前端依赖它们）。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ShortCodeService } from '../src/services/shortCode.js'
import { UrlValidator } from '../src/services/urlValidator.js'
import { startTestServer } from './helpers.js'

describe('短码算法', () => {
    const service = new ShortCodeService()

    it('与存量短码逐位一致', () => {
        // 与 PHP 版 Compat/expected_codes.php 中的向量一致
        assert.equal(service.encode(1), 'S')
        assert.equal(service.encode(2), '2')
        assert.equal(service.encode(62), 'SG')
        assert.equal(service.encode(63), 'SS')
        assert.equal(service.encode(123456789), '8AGYs')
    })

    it('encode(0) 返回空串，负数抛错', () => {
        assert.equal(service.encode(0), '')
        assert.throws(() => service.encode(-1))
    })

    it('左补齐使用字母表首字符 G', () => {
        assert.equal(service.padTo('S', 4), 'GGGS')
        assert.equal(service.padTo('2', 4), 'GGG2')
        assert.equal(service.padTo('SG', 1), 'SG')
    })

    it('随机短码长度正确且落在字母表内', () => {
        const code = service.randomCode(8)
        assert.equal(code.length, 8)
        assert.match(code, /^[0-9A-Za-z]{8}$/)
    })
})

describe('URL 校验与归一化', () => {
    const validator = new UrlValidator()

    it('接受合法 http/https 并保留原样', () => {
        assert.equal(validator.validate('https://example.com/a?b=1'), 'https://example.com/a?b=1')
    })

    it('拒绝非字符串、空串、空白、非 http(s)、缺主机', () => {
        for (const bad of [null, 123, '', '   ', 'ftp://example.com', 'example.com', 'http://', 'https://a b.com']) {
            assert.throws(() => validator.validate(bad), (error) => error.status === 400, String(bad))
        }
    })

    it('中文路径按 UTF-8 百分号编码', () => {
        assert.equal(validator.validate('https://example.com/中文'), 'https://example.com/%E4%B8%AD%E6%96%87')
    })

    it('孤立百分号转义为 %25，合法 %XX 不二次编码', () => {
        assert.equal(validator.validate('https://example.com/100%'), 'https://example.com/100%25')
        assert.equal(validator.validate('https://example.com/a%20b'), 'https://example.com/a%20b')
    })

    it('超过 2048 字节返回 413', () => {
        const long = `https://example.com/${'a'.repeat(2100)}`
        assert.throws(() => validator.validate(long), (error) => error.status === 413)
    })
})

describe('创建与跳转 API', () => {
    /** @type {Awaited<ReturnType<typeof startTestServer>>} */
    let server

    before(async () => {
        server = await startTestServer()
    })
    after(async () => {
        await server.close()
    })

    it('POST /url 返回 {url, code}，首个短码为 S', async () => {
        const res = await server.request('POST', '/url', { body: { url: 'https://example.com' } })
        assert.equal(res.status, 200)
        assert.deepEqual(res.json, { url: 'https://example.com', code: 'S' })
    })

    it('POST /api/url 与 /url 等价', async () => {
        const res = await server.request('POST', '/api/url', { body: { url: 'https://example.com/alias' } })
        assert.equal(res.status, 200)
        assert.equal(res.json.code, '2')
    })

    it('非法 URL / 缺少字段 / 非法 JSON / 空 body 均 400', async () => {
        const cases = [
            { url: 'ftp://example.com' },
            {},
            '{bad json',
            undefined,
        ]
        for (const body of cases) {
            const res = await server.request('POST', '/url', body === undefined ? {} : { body })
            assert.equal(res.status, 400)
            assert.deepEqual(res.json, { error: 'Incorrect URL format' })
        }
    })

    it('GET /{code} 302 跳转；不存在返回 404 Unknown URL', async () => {
        const ok = await server.request('GET', '/S')
        assert.equal(ok.status, 302)
        assert.equal(ok.headers.location, 'https://example.com')

        const missing = await server.request('GET', '/missing')
        assert.equal(missing.status, 404)
        assert.deepEqual(missing.json, { error: 'Unknown URL' })
    })

    it('GET /url 落入短码查询（404 Unknown URL）', async () => {
        const res = await server.request('GET', '/url')
        assert.equal(res.status, 404)
        assert.deepEqual(res.json, { error: 'Unknown URL' })
    })

    it('方法不符返回 405 并带 Allow', async () => {
        const res = await server.request('POST', '/S')
        assert.equal(res.status, 405)
        assert.equal(res.headers.allow, 'GET')

        const apiUrl = await server.request('GET', '/api/url')
        assert.equal(apiUrl.status, 405)
    })

    it('多段路径返回 404 Not Found', async () => {
        const res = await server.request('GET', '/a/b')
        assert.equal(res.status, 404)
        assert.deepEqual(res.json, { error: 'Not Found' })
    })

    it('末尾斜杠等价', async () => {
        const res = await server.request('POST', '/url/', { body: { url: 'https://example.com/trailing' } })
        assert.equal(res.status, 200)
    })

    it('中文 URL 归一化后可跳转', async () => {
        const created = await server.request('POST', '/url', { body: { url: 'https://example.com/中文' } })
        assert.equal(created.json.url, 'https://example.com/%E4%B8%AD%E6%96%87')

        const redirect = await server.request('GET', `/${created.json.code}`)
        assert.equal(redirect.status, 302)
        assert.equal(redirect.headers.location, 'https://example.com/%E4%B8%AD%E6%96%87')
    })

    it('HEAD 跳转不记录点击，GET 记录', async () => {
        await server.request('POST', '/url', { body: { url: 'https://example.com/head' } })
        const loginToken = await server.login()

        const before = await server.request('GET', '/api/admin/overview', { cookie: loginToken })
        await server.request('HEAD', '/S')
        const afterHead = await server.request('GET', '/api/admin/overview', { cookie: loginToken })
        assert.equal(afterHead.json.total_clicks, before.json.total_clicks)

        await server.request('GET', '/S')
        const afterGet = await server.request('GET', '/api/admin/overview', { cookie: loginToken })
        assert.equal(afterGet.json.total_clicks, before.json.total_clicks + 1)
    })
})
