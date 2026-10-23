/**
 * 外链可达性探测（Node 版）：HEAD 优先，403/405/501 回退 GET + Range。
 *
 * 安全边界（服务端主动发起请求，必须防 SSRF）：
 * - 只允许 http/https；
 * - 解析主机名后逐个校验 IP，拒绝内网/环回/链路本地/保留地址；
 * - 连接时把已验证的 IP 通过自定义 lookup 固定下来，避免 DNS 重绑定（TOCTOU）；
 * - 不自动跟随跳转，手工逐跳校验；
 * - 只读取响应头（HEAD；GET 时 Range: bytes=0-0），不下载响应体。
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_REDIRECTS = 3
const USER_AGENT = 'Devr-LinkChecker/1.0 (+https://github.com/onee-io/short-url)'

/**
 * @param {boolean|null} reachable
 * @param {number|null} httpCode
 * @param {string|null} error
 */
function result(reachable, httpCode, error) {
    return { reachable, http_code: httpCode, error }
}

export class HttpLinkProbe {
    /**
     * @param {{timeoutSeconds?: number, connectTimeoutSeconds?: number}} [options]
     */
    constructor({ timeoutSeconds = 8, connectTimeoutSeconds = 5 } = {}) {
        this.timeoutMs = Math.max(1, timeoutSeconds) * 1000
        this.connectTimeoutMs = Math.max(1, connectTimeoutSeconds) * 1000
    }

    /**
     * @param {string} url
     * @returns {Promise<{reachable: boolean|null, http_code: number|null, error: string|null}>}
     */
    async probe(url) {
        let current = url

        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            const safety = await HttpLinkProbe.assertSafeUrl(current)
            if (safety !== null) {
                return result(null, null, safety)
            }

            const response = await this.#request(current, 'HEAD')
            if (response.error !== null) {
                return result(false, null, response.error)
            }

            let code = response.http_code
            let location = response.location

            if ([403, 405, 501].includes(code)) {
                const fallback = await this.#request(current, 'GET')
                if (fallback.error !== null) {
                    return result(false, null, fallback.error)
                }
                code = fallback.http_code
                location = fallback.location
            }

            if (code >= 300 && code < 400 && location) {
                const next = HttpLinkProbe.resolveLocation(current, location)
                if (next === null) {
                    return result(false, code, '跳转地址无效')
                }
                current = next
                continue
            }

            return HttpLinkProbe.classify(code)
        }

        return result(null, null, '跳转次数过多，已停止检测')
    }

    /**
     * @param {number} code
     */
    static classify(code) {
        if (code >= 200 && code < 400) {
            return result(true, code, null)
        }
        if (code === 429) {
            return result(null, code, '目标站点限流（429），本次跳过')
        }
        if (code === 408) {
            return result(null, code, '目标站点请求超时（408），本次跳过')
        }
        if (code >= 400) {
            return result(false, code, `HTTP ${code}`)
        }

        return result(null, code, `未知状态码 ${code}`)
    }

    /**
     * 解析 Location（绝对/协议相对/根相对/相对路径）。
     *
     * @param {string} base
     * @param {string} location
     * @returns {string|null}
     */
    static resolveLocation(base, location) {
        const target = (location ?? '').trim()
        if (target === '') {
            return null
        }
        if (/^https?:\/\//i.test(target)) {
            return target
        }

        let baseUrl
        try {
            baseUrl = new URL(base)
        } catch {
            return null
        }

        const origin = `${baseUrl.protocol}//${baseUrl.host}`
        if (target.startsWith('//')) {
            return `${baseUrl.protocol}${target}`
        }
        if (target.startsWith('/')) {
            return origin + target
        }

        const path = baseUrl.pathname || '/'
        const directory = path.endsWith('/') ? path : path.slice(0, path.lastIndexOf('/') + 1)

        return origin + directory + target
    }

    /**
     * SSRF 防护：仅 http/https，解析出的所有 IP 必须为公网地址。
     *
     * @param {string} rawUrl
     * @returns {Promise<string|null>} null 表示通过，否则为拒绝原因
     */
    static async assertSafeUrl(rawUrl) {
        let parsed
        try {
            parsed = new URL(rawUrl)
        } catch {
            return '目标地址格式无效'
        }

        const scheme = parsed.protocol.toLowerCase()
        if (scheme !== 'http:' && scheme !== 'https:') {
            return '仅支持 http/https 地址'
        }

        const host = parsed.hostname.replace(/^\[|\]$/g, '')
        if (host === '') {
            return '目标地址缺少主机名'
        }

        let addresses
        if (isIP(host) !== 0) {
            addresses = [{ address: host, family: isIP(host) }]
        } else {
            try {
                addresses = await dnsLookup(host, { all: true, verbatim: true })
            } catch {
                return '域名解析失败'
            }
        }

        if (!addresses || addresses.length === 0) {
            return '域名解析失败'
        }

        for (const entry of addresses) {
            if (HttpLinkProbe.isPrivateOrReserved(entry.address)) {
                return '目标指向内网或保留地址，已跳过'
            }
        }

        return null
    }

    /**
     * @param {string} address
     */
    static isPrivateOrReserved(address) {
        const family = isIP(address)
        if (family === 4) {
            return HttpLinkProbe.#isPrivateV4(address)
        }
        if (family === 6) {
            return HttpLinkProbe.#isPrivateV6(address)
        }

        return true
    }

    static #isPrivateV4(address) {
        const parts = address.split('.').map(Number)
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return true
        }
        const [a, b] = parts

        // 与 PHP FILTER_FLAG_NO_PRIV_RANGE | NO_RES_RANGE 对齐，并额外覆盖 CGNAT 与文档网段。
        // 注意：不拦截 198.18.0.0/15（部分代理/VPN 的 fake-IP 网段，真实站点常被解析到这里）。
        if (a === 0 || a === 10 || a === 127) return true
        if (a === 100 && b >= 64 && b <= 127) return true
        if (a === 169 && b === 254) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 192 && b === 168) return true
        if (a === 192 && b === 0) return true
        if (a === 192 && b === 0 && parts[2] === 2) return true
        if (a === 198 && b === 51 && parts[2] === 100) return true
        if (a === 203 && b === 0 && parts[2] === 113) return true
        if (a >= 224) return true

        return false
    }

    static #isPrivateV6(address) {
        const normalized = address.toLowerCase()

        if (normalized === '::' || normalized === '::1') return true
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // fc00::/7
        if (/^fe[89ab]/.test(normalized)) return true // fe80::/10
        if (normalized.startsWith('ff')) return true // 组播 ff00::/8
        if (normalized.startsWith('2001:db8')) return true // 文档网段

        // IPv4 映射地址 ::ffff:a.b.c.d
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
        if (mapped) {
            return HttpLinkProbe.#isPrivateV4(mapped[1])
        }

        return false
    }

    /**
     * 发起一次请求，只取状态码与 Location，不读响应体。
     *
     * @param {string} rawUrl
     * @param {'HEAD'|'GET'} method
     * @returns {Promise<{http_code: number, location: string|null, error: string|null}>}
     */
    async #request(rawUrl, method) {
        let parsed
        try {
            parsed = new URL(rawUrl)
        } catch {
            return { http_code: 0, location: null, error: '目标地址格式无效' }
        }

        const host = parsed.hostname.replace(/^\[|\]$/g, '')
        // 复用已校验的解析结果并固定到本次连接，防止 DNS 重绑定
        let pinned
        try {
            const entries = isIP(host) !== 0
                ? [{ address: host, family: isIP(host) }]
                : await dnsLookup(host, { all: true, verbatim: true })
            pinned = entries[0]
        } catch {
            return { http_code: 0, location: null, error: '域名解析失败' }
        }

        const headers = {
            'user-agent': USER_AGENT,
            accept: '*/*',
            host: parsed.host,
        }
        if (method === 'GET') {
            headers.range = 'bytes=0-0'
        }

        const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest

        return await new Promise((resolve) => {
            let settled = false
            const finish = (value) => {
                if (settled) return
                settled = true
                resolve(value)
            }

            const request = client({
                hostname: host,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                method,
                headers,
                servername: parsed.protocol === 'https:' ? host : undefined,
                rejectUnauthorized: true,
                agent: false,
                lookup: (hostname, options, callback) => {
                    if (options && options.all) {
                        callback(null, [pinned])

                        return
                    }
                    callback(null, pinned.address, pinned.family)
                },
            })

            // 总超时
            const totalTimer = setTimeout(() => {
                request.destroy(new Error('ETIMEDOUT'))
            }, this.timeoutMs)
            totalTimer.unref?.()

            request.on('socket', (socket) => {
                if (!socket.connecting) {
                    return
                }
                const connectTimer = setTimeout(() => {
                    socket.destroy(new Error('ETIMEDOUT'))
                }, this.connectTimeoutMs)
                connectTimer.unref?.()
                socket.once('connect', () => clearTimeout(connectTimer))
            })

            request.on('response', (response) => {
                clearTimeout(totalTimer)
                const code = Number(response.statusCode ?? 0)
                const location = response.headers.location ?? null
                response.destroy()
                finish({ http_code: code, location, error: null })
            })

            request.on('error', (error) => {
                clearTimeout(totalTimer)
                finish({ http_code: 0, location: null, error: HttpLinkProbe.humanizeError(error) })
            })

            request.on('timeout', () => {
                request.destroy(new Error('ETIMEDOUT'))
            })

            request.end()
        })
    }

    /**
     * 把网络错误转成简短、可展示的中文原因。
     *
     * @param {Error} error
     */
    static humanizeError(error) {
        const message = String(error?.message ?? '')
        const code = String(error?.code ?? '')
        const lower = `${message} ${code}`.toLowerCase()

        if (lower.includes('etimedout') || lower.includes('timed out') || lower.includes('timeout')) {
            return '请求超时'
        }
        if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('getaddrinfo')) {
            return '域名解析失败'
        }
        if (lower.includes('econnrefused')) {
            return '连接被拒绝'
        }
        if (lower.includes('certificate') || lower.includes('ssl') || lower.includes('tls')) {
            return 'SSL/证书校验失败'
        }
        if (lower.includes('too many redirects')) {
            return '跳转次数过多'
        }

        return `网络错误：${message.slice(0, 80)}`
    }
}
