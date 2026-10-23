/**
 * 安全中间件：
 * - CsrfGuard：写请求校验 Origin/Referer 同源（显式 API Key 头豁免）；
 * - RequestRateLimiter：创建接口按 IP 固定窗口限流。
 * 规则与 PHP 版逐条一致。
 */
import { csrfError, throttleError } from '../support/errors.js'

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

export class CsrfGuard {
    /**
     * @param {string[]} allowedOrigins
     * @param {boolean} allowMissingOrigin
     */
    constructor(allowedOrigins = [], allowMissingOrigin = false) {
        this.allowedOrigins = allowedOrigins
        this.allowMissingOrigin = allowMissingOrigin
    }

    /**
     * @param {import('./request.js').Request} request
     */
    assertSafe(request) {
        if (SAFE_METHODS.includes(request.method)) {
            return
        }

        if (this.#hasExplicitCredential(request)) {
            return
        }

        const origin = this.#originFrom(request)
        if (origin === null) {
            if (this.allowMissingOrigin) {
                return
            }
            throw csrfError('Missing Origin or Referer header')
        }

        if (this.#isSameOrigin(origin, request) || this.#isAllowed(origin)) {
            return
        }

        throw csrfError('Cross-site request rejected')
    }

    #hasExplicitCredential(request) {
        const apiKey = request.header('x-api-key')
        if (typeof apiKey === 'string' && apiKey.trim() !== '') {
            return true
        }
        const authorization = request.header('authorization')

        return typeof authorization === 'string' && /^Bearer\s+\S+/i.test(authorization)
    }

    #originFrom(request) {
        const origin = request.header('origin')
        if (typeof origin === 'string' && origin.trim() !== '') {
            const trimmed = origin.trim().replace(/\/+$/, '')

            return trimmed.toLowerCase() === 'null' ? null : trimmed
        }

        const referer = request.header('referer')
        if (typeof referer !== 'string' || referer.trim() === '') {
            return null
        }

        let parsed
        try {
            parsed = new URL(referer.trim())
        } catch {
            return null
        }

        return `${parsed.protocol}//${parsed.host}`.toLowerCase()
    }

    #isSameOrigin(origin, request) {
        const host = request.header('host')
        if (typeof host !== 'string' || host.trim() === '') {
            return false
        }
        const normalizedHost = host.trim().toLowerCase()

        // 协议不参与比较：TLS 在反向代理终结时 Origin 为 https、回源为 http，属同站请求
        return origin === `https://${normalizedHost}` || origin === `http://${normalizedHost}`
    }

    #isAllowed(origin) {
        return this.allowedOrigins.some(
            (allowed) => String(allowed).toLowerCase().replace(/\/+$/, '') === origin,
        )
    }
}

export class RequestRateLimiter {
    static SCOPE_CREATE = 'create'

    /**
     * @param {object} repository
     * @param {import('../support/ipHasher.js').IpHasher} ipHasher
     * @param {number} max 0 = 关闭
     * @param {number} windowSeconds
     */
    constructor(repository, ipHasher, max, windowSeconds) {
        this.repository = repository
        this.ipHasher = ipHasher
        this.max = max
        this.windowSeconds = windowSeconds
    }

    /**
     * @param {import('./request.js').Request} request
     * @param {string} scope
     */
    assertAllowed(request, scope) {
        if (this.max <= 0 || this.windowSeconds <= 0) {
            return
        }

        const subject = this.ipHasher.hash(request.clientIp) ?? 'anonymous'
        const nowSeconds = Math.floor(Date.now() / 1000)
        const windowStart = Math.floor(nowSeconds / this.windowSeconds) * this.windowSeconds
        const hits = this.repository.increment(scope, subject, windowStart)

        if (hits > this.max) {
            throw throttleError()
        }
    }
}
