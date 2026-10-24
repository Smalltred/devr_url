/**
 * 缓存与代理头安全回归测试。
 *
 * 覆盖 2026-10 审计确认的问题：
 * 1. memcached 文本协议注入（SEC-N01，High）——恶意“短码”绝不能进入缓存键；
 * 2. X-Forwarded-For 解析方向（SEC-N02）——必须取最右侧（受信代理追加的）条目；
 * 3. 外链探测的 IPv6 绕过前缀（SEC-N03）——6to4 / Teredo / NAT64 / IPv4 兼容地址。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemcachedStore } from '../src/cache/memcachedStore.js'
import { CachedUrlRepository } from '../src/cache/cachedUrlRepository.js'
import { resolveClientIp } from '../src/support/clientIp.js'
import { HttpLinkProbe } from '../src/services/httpLinkProbe.js'
import { SqliteUrlRepository } from '../src/db/urlRepository.js'
import { Database } from '../src/db/database.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestServer } from './helpers.js'

/** 记录所有收到键的缓存替身：断言“恶意键从未抵达缓存层”。 */
class RecordingStore {
    constructor() {
        this.keys = []
        this.values = new Map()
    }
    async get(key) {
        this.keys.push(key)
        return this.values.get(key) ?? null
    }
    async set(key, value) {
        this.keys.push(key)
        this.values.set(key, value)
        return true
    }
    async delete(key) {
        this.keys.push(key)
        this.values.delete(key)
        return true
    }
    status() {
        return { driver: 'recording', enabled: true, available: true, servers: [], ttl: 0, negative_ttl: 0 }
    }
    async stats() {
        return { hits: 0, misses: 0, items: this.values.size }
    }
}

const SILENT_LOGGER = { info() {}, error() {} }

describe('SEC-N01 memcached 键注入防护', () => {
    /** 含 CRLF/空格/NUL 的“短码”载荷（对应真实攻击中注入 set 命令的路径） */
    const MALICIOUS_CODES = [
        '\r\nset devr:url:VICTIM 0 300 21\r\nhttps://evil.example/\r\n',
        '\r\nset devr:url:S 0 86400 14\r\n\0__devr_miss__\r\n',
        'code with spaces',
        'tab\there',
        'nul\0byte',
    ]

    it('MemcachedStore.isSafeKey 拒绝含空白/控制字符/超长的键', () => {
        assert.equal(MemcachedStore.isSafeKey('devr:url:abc123'), true)
        assert.equal(MemcachedStore.isSafeKey('devr:url:' + 'a'.repeat(240)), true)
        for (const bad of ['devr:url:a b', 'devr:url:a\r\nb', 'devr:url:\0x', 'devr:url:a\tb', '', null, 42,
            'x'.repeat(251)]) {
            assert.equal(MemcachedStore.isSafeKey(bad), false, `应拒绝: ${JSON.stringify(bad)}`)
        }
    })

    it('MemcachedStore 对不安全键直接判 miss，不发起任何网络命令', async () => {
        // servers 指向一个必然无服务的端口：若实现漏掉校验，这里会因连接失败而进入降级，
        // 但绝不能把命令发出去；若校验存在则连 socket 都不建。
        const store = new MemcachedStore(
            { servers: ['127.0.0.1:1'], ttl: 60, negativeTtl: 30, timeoutMs: 50 },
            SILENT_LOGGER,
        )
        assert.equal(await store.get('\r\nset x 0 1 1\r\na\r\n'), null)
        assert.equal(await store.set('\r\nset x 0 1 1\r\na\r\n', 'v', 60), false)
        // 未触发降级冷却（说明根本没尝试连接）
        assert.equal(await store.get('normal-key-but-unknown'), null)
    })

    it('CachedUrlRepository：恶意短码不读不写缓存，直查数据库', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'devr-cache-'))
        const database = new Database(join(dir, 't.sqlite3'))
        const inner = new SqliteUrlRepository(database)
        inner.save('S', 'https://example.com/legit', null)

        const store = new RecordingStore()
        const settings = { cacheTtl: () => 300, cacheNegativeTtl: () => 30 }
        const repo = new CachedUrlRepository(inner, store, settings)

        for (const code of MALICIOUS_CODES) {
            const url = await repo.findByCode(code)
            assert.equal(url, null, `恶意码应按数据库结果返回 null: ${JSON.stringify(code.slice(0, 20))}`)
        }
        // 正常码仍走缓存
        assert.equal(await repo.findByCode('S'), 'https://example.com/legit')
        const unsafeKeys = store.keys.filter((k) => /[\s\0]/.test(k))
        assert.deepEqual(unsafeKeys, [], '含空白/控制字符的键绝不能抵达缓存层')
        assert.ok(store.keys.every((k) => /^url:[0-9A-Za-z]{1,64}$/.test(k)), `缓存键形态异常: ${store.keys}`)

        database.close()
    })

    it('端到端：注入路径请求不污染缓存、不影响既有短链', async () => {
        const store = new RecordingStore()
        const server = await startTestServer({ deps: { cache: store } })
        try {
            const created = await server.request('POST', '/url', { body: { url: 'https://example.com/victim' } })
            assert.equal(created.status, 200)
            const code = created.json.code

            const first = await server.request('GET', `/${code}`)
            assert.equal(first.status, 302)

            // 三类注入原语（劫持 / 404 标记 / 凭空造码）
            const payloads = [
                `/%0d%0Aset%20devr%3Aurl%3A${code}%200%20300%2019%0d%0Ahttps%3A%5C%5Cevil.example`,
                `/%0d%0Aset%20devr%3Aurl%3A${code}%200%2086400%2014%0d%0A%00__devr_miss__`,
                '/%0d%0Aset%20devr%3Aurl%3AT%200%20300%201%0d%0Ax',
            ]
            for (const path of payloads) {
                const res = await server.request('GET', path)
                assert.equal(res.status, 404, `注入请求应 404: ${path.slice(0, 40)}…`)
            }

            // 既有短链不受影响
            const after = await server.request('GET', `/${code}`)
            assert.equal(after.status, 302)
            assert.equal(after.headers.location, 'https://example.com/victim')

            // 缓存层从未见过任何含空白/控制字符的键
            assert.ok(store.keys.every((k) => /^url:[0-9A-Za-z]{1,64}$/.test(k)), `缓存被污染: ${store.keys}`)
        } finally {
            await server.close()
        }
    })
})

describe('SEC-N02 X-Forwarded-For 解析方向', () => {
    it('取最右侧条目（受信代理追加的真实 IP）', () => {
        const headers = { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }
        assert.equal(resolveClientIp('127.0.0.1', headers, true), '5.6.7.8')
    })

    it('客户端伪造的首项不再被采纳', () => {
        // nginx 追加语义：客户端发 "9.9.9.9"，代理追加真实 IP → "9.9.9.9, 203.0.113.10"
        const headers = { 'x-forwarded-for': '9.9.9.9, 203.0.113.10' }
        assert.equal(resolveClientIp('127.0.0.1', headers, true), '203.0.113.10')
    })

    it('X-Real-IP 优先于 XFF（随附 nginx 配置总是设置它）', () => {
        const headers = { 'x-real-ip': '203.0.113.99', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }
        assert.equal(resolveClientIp('127.0.0.1', headers, true), '203.0.113.99')
    })

    it('非受信来源（公网直连）一律用 socket 地址', () => {
        const headers = { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }
        assert.equal(resolveClientIp('203.0.113.1', headers, true), '203.0.113.1')
    })

    it('XFF 全部条目非法时回落 socket 地址', () => {
        const headers = { 'x-forwarded-for': 'garbage, , !!!' }
        assert.equal(resolveClientIp('10.0.0.5', headers, true), '10.0.0.5')
    })

    it('trustProxy=false 时不读代理头', () => {
        const headers = { 'x-real-ip': '1.2.3.4' }
        assert.equal(resolveClientIp('127.0.0.1', headers, false), '127.0.0.1')
    })
})

describe('SEC-N03 外链探测 IPv6 内网绕过', () => {
    it('6to4 / Teredo / NAT64 / IPv4 兼容前缀全部拒绝', () => {
        const blocked = [
            '2002:7f00:1::',        // 6to4 编码 127.0.0.1
            '2002:0a00:0001::',     // 6to4 编码 10.0.0.1
            '2001:0:4136:e378:8000:57f3:ae45:3b1c', // Teredo
            '64:ff9b::7f00:1',      // NAT64 编码 127.0.0.1
            '64:ff9b:1::ac1f:1:1',  // 本地 NAT64
            '::127.0.0.1',          // IPv4 兼容（点分）
            '::10.0.0.1',           // IPv4 兼容（点分，内网）
            '::a00:1',              // IPv4 兼容（十六进制，10.0.0.1）
            '::ffff:127.0.0.1',     // 映射环回
            '::ffff:192.168.1.1',   // 映射内网
            'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1',
        ]
        for (const address of blocked) {
            assert.equal(
                HttpLinkProbe.isPrivateOrReserved(address), true,
                `应拒绝: ${address}`,
            )
        }
    })

    it('公网地址仍可探测（不误伤）', () => {
        const allowed = [
            '2606:4700:4700::1111',   // Cloudflare DNS
            '2001:4860:4860::8888',   // Google DNS
            '::ffff:8.8.8.8',         // 公网 IPv4 的映射形式
            '2a00:1450:4001:81b::200e',
        ]
        for (const address of allowed) {
            assert.equal(
                HttpLinkProbe.isPrivateOrReserved(address), false,
                `不应拒绝公网地址: ${address}`,
            )
        }
    })
})
