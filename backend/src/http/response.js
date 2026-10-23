/**
 * 轻量响应对象与统一安全响应头。
 */
import { createHash } from 'node:crypto'

/**
 * @param {number} status
 * @param {Record<string, string|string[]>} headers
 * @param {string|Buffer} body
 */
export class Response {
    constructor(status, headers = {}, body = '') {
        this.status = status
        this.headers = headers
        this.body = body
    }

    /**
     * @param {object} data
     * @param {number} [status]
     * @param {Record<string, string|string[]>} [headers]
     */
    static json(data, status = 200, headers = {}) {
        let body
        try {
            body = JSON.stringify(data)
        } catch {
            body = '{"error":"Internal Server Error"}'
        }

        return new Response(status, { 'content-type': 'application/json; charset=utf-8', ...headers }, body)
    }

    /**
     * @param {string} location
     * @param {number} [status]
     */
    static redirect(location, status = 302) {
        if (/[\r\n]/.test(location)) {
            throw new Error('Invalid redirect location')
        }

        return new Response(status, { location }, '')
    }

    /**
     * @param {string} body
     * @param {number} [status]
     */
    static text(body, status = 200) {
        return new Response(status, { 'content-type': 'text/plain; charset=utf-8' }, body)
    }

    /**
     * @param {string} body
     * @param {number} [status]
     */
    static html(body, status = 200) {
        return new Response(status, { 'content-type': 'text/html; charset=utf-8' }, body)
    }

    /** @param {string} name */
    header(name) {
        const value = this.headers[name.toLowerCase()]

        return Array.isArray(value) ? value[0] : value
    }
}

/**
 * 全站统一安全响应头（与 PHP 版取值一致）。
 */
export class SecurityHeaders {
    /**
     * @param {Response} response
     * @param {{scriptExtra: string[], connectExtra: string[], hstsMaxAge: number}} options
     * @param {boolean} secureRequest
     */
    static apply(response, options, secureRequest) {
        const contentType = response.header('content-type') ?? ''
        const hashes = contentType.startsWith('text/html')
            ? SecurityHeaders.inlineScriptHashes(String(response.body))
            : []

        const script = Array.from(new Set(["'self'", ...hashes, ...options.scriptExtra]))
        const connect = Array.from(new Set(["'self'", ...options.connectExtra]))

        const headers = {
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
            'content-security-policy': [
                "default-src 'self'",
                `script-src ${script.join(' ')}`,
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self' data:",
                `connect-src ${connect.join(' ')}`,
                "form-action 'self'",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "object-src 'none'",
            ].join('; '),
        }

        if (options.hstsMaxAge > 0 && secureRequest) {
            headers['strict-transport-security'] = `max-age=${options.hstsMaxAge}; includeSubDomains`
        }

        const merged = { ...response.headers }
        for (const [name, value] of Object.entries(headers)) {
            if (!(name in merged)) {
                merged[name] = value
            }
        }

        return new Response(response.status, merged, response.body)
    }

    /**
     * 提取 HTML 中内联脚本（无 src）的 sha256，供 CSP 放行。
     *
     * @param {string} html
     * @returns {string[]}
     */
    static inlineScriptHashes(html) {
        const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
        const hashes = []
        let match
        while ((match = pattern.exec(html)) !== null) {
            const digest = createHash('sha256').update(match[1], 'utf8').digest('base64')
            hashes.push(`'sha256-${digest}'`)
        }

        return hashes
    }
}
