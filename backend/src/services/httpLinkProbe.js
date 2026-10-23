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
     * @param {{timeoutSeconds?: number, connectTimeoutSeconds?: number, allowPrivateTargets?: boolean}} [options]
     *   allowPrivateTargets 仅供测试指向本机服务；生产保持 false（SSRF 防护）。
     */
    constructor({ timeoutSeconds = 8, connectTimeoutSeconds = 5, allowPrivateTargets = false } = {}) {
        this.timeoutMs = Math.max(1, timeoutSeconds) * 1000
        this.connectTimeoutMs = Math.max(1, connectTimeoutSeconds) * 1000
        this.allowPrivateTargets = allowPrivateTargets
    }

    /**
     * @param {string} url
     * @returns {Promise<{reachable: boolean|null, http_code: number|null, error: string|null}>}
     */
    async probe(url) {
        let current = url

        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            const safety = await HttpLinkProbe.inspectSafety(current, this.allowPrivateTargets)
            if (safety.error !== null) {
                // 域名不存在属于确定性失效；临时解析故障/内网地址保持“无法判定”，避免误删
                return result(safety.permanent ? false : null, null, safety.error)
            }

            const response = await this.#requestWithFallback(current, 'HEAD', safety.addresses)
            if (response.error !== null) {
                return result(false, null, response.error)
            }

            let code = response.http_code
            let location = response.location

            if ([403, 405, 501].includes(code)) {
                const fallback = await this.#requestWithFallback(current, 'GET', safety.addresses)
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
     * 按解析出的地址逐个尝试（IPv4 优先），避免双栈主机只测通一个协议族时被误判：
     * - 连接级失败（拒绝/重置/不可达）换下一个地址再试；
     * - 超时不再重试（避免双倍等待），直接判失效。
     *
     * @param {string} rawUrl
     * @param {'HEAD'|'GET'} method
     * @param {Array<{address: string, family: number}>} addresses
     */
    async #requestWithFallback(rawUrl, method, addresses) {
        const attempts = addresses.slice(0, 2)
        let last = null

        for (let index = 0; index < attempts.length; index += 1) {
            const startedAt = Date.now()
            const response = await this.#request(rawUrl, method, attempts[index])
            if (response.error === null) {
                return response
            }
            last = response

            const timedOut = Date.now() - startedAt >= this.timeoutMs
            if (timedOut || !HttpLinkProbe.isRetryableError(response.errorCode)) {
                break
            }
        }

        return last ?? { http_code: 0, location: null, error: '域名解析失败', errorCode: 'ENOTFOUND' }
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
     * SSRF 防护 + 解析结果：仅 http/https，解析出的所有 IP 必须为公网地址。
     *
     * permanent=true 表示“确定性失效”（域名不存在），调用方应判为失效；
     * permanent=false 表示无法安全/稳定判定（临时解析故障、内网地址），保持“无法判定”。
     *
     * @param {string} rawUrl
     * @param {boolean} [allowPrivate] 仅测试使用
     * @returns {Promise<{error: string|null, permanent: boolean, addresses: Array<{address: string, family: number}>}>}
     */
    static async inspectSafety(rawUrl, allowPrivate = false) {
        const fail = (error, permanent = false) => ({ error, permanent, addresses: [] })

        let parsed
        try {
            parsed = new URL(rawUrl)
        } catch {
            return fail('目标地址格式无效')
        }

        const scheme = parsed.protocol.toLowerCase()
        if (scheme !== 'http:' && scheme !== 'https:') {
            return fail('仅支持 http/https 地址')
        }

        const host = parsed.hostname.replace(/^\[|\]$/g, '')
        if (host === '') {
            return fail('目标地址缺少主机名')
        }

        let addresses
        if (isIP(host) !== 0) {
            addresses = [{ address: host, family: isIP(host) }]
        } else {
            try {
                // verbatim:false → IPv4 优先，减少“首个地址是 IPv6 但不可达”造成的误判
                addresses = await dnsLookup(host, { all: true, verbatim: false })
            } catch (error) {
                // ENOTFOUND = 域名不存在（确定性失效）；EAI_AGAIN/SERVFAIL 等属临时故障
                if (error && error.code === 'ENOTFOUND') {
                    return fail('域名不存在（DNS 解析失败）', true)
                }

                return fail('域名解析暂时失败，本次跳过')
            }
        }

        if (!addresses || addresses.length === 0) {
            return fail('域名不存在（DNS 解析失败）', true)
        }

        if (!allowPrivate) {
            for (const entry of addresses) {
                if (HttpLinkProbe.isPrivateOrReserved(entry.address)) {
                    return fail('目标指向内网或保留地址，已跳过')
                }
            }
        }

        return { error: null, permanent: false, addresses }
    }

    /**
     * 兼容旧调用：只返回拒绝原因字符串。
     *
     * @param {string} rawUrl
     * @returns {Promise<string|null>}
     */
    static async assertSafeUrl(rawUrl) {
        return (await HttpLinkProbe.inspectSafety(rawUrl)).error
    }

    /**
     * 连接级错误可以换下一个解析地址重试。
     *
     * @param {string} code
     */
    static isRetryableError(code) {
        return ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE'].includes(code)
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
     * @param {{address: string, family: number}} pinned 已校验的解析结果（固定连接目标，防 DNS 重绑定）
     * @returns {Promise<{http_code: number, location: string|null, error: string|null, errorCode: string|null}>}
     */
    async #request(rawUrl, method, pinned) {
        let parsed
        try {
            parsed = new URL(rawUrl)
        } catch {
            return { http_code: 0, location: null, error: '目标地址格式无效', errorCode: null }
        }

        const host = parsed.hostname.replace(/^\[|\]$/g, '')

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
                finish({ http_code: code, location, error: null, errorCode: null })
            })

            request.on('error', (error) => {
                clearTimeout(totalTimer)
                finish({
                    http_code: 0,
                    location: null,
                    error: HttpLinkProbe.humanizeError(error),
                    errorCode: String(error?.code ?? '') || null,
                })
            })

            request.on('timeout', () => {
                request.destroy(new Error('ETIMEDOUT'))
            })

            // 兜底：连接被对端关闭且未触发 error/response 时，也必须结束等待
            request.on('close', () => {
                clearTimeout(totalTimer)
                finish({
                    http_code: 0,
                    location: null,
                    error: '连接被终止（目标未返回响应）',
                    errorCode: 'ECONNRESET',
                })
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
        // 连接被对端关闭（浏览器表现为 ERR_CONNECTION_CLOSED）属于确定性失效
        if (lower.includes('econnreset') || lower.includes('socket hang up') || lower.includes('econnclosed')) {
            return '连接被终止（目标主动断开）'
        }
        if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('getaddrinfo')) {
            return '域名解析失败'
        }
        if (lower.includes('econnrefused')) {
            return '连接被拒绝'
        }
        if (lower.includes('enetunreach') || lower.includes('ehostunreach')) {
            return '网络不可达'
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
