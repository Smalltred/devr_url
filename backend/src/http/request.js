/**
 * 请求上下文：封装原始 http.IncomingMessage，业务代码不直接触碰 req。
 */
export class Request {
    /**
     * @param {object} init
     * @param {string} init.method
     * @param {string} init.path
     * @param {URLSearchParams} init.query
     * @param {Record<string, string|string[]|undefined>} init.headers
     * @param {string} init.rawBody
     * @param {string} init.clientIp
     * @param {Record<string, string>} [init.params]
     */
    constructor({ method, path, query, headers, rawBody, clientIp, params = {} }) {
        this.method = method
        this.path = path
        this.query = query
        this.headers = headers
        this.rawBody = rawBody
        this.clientIp = clientIp
        this.params = params
        this.decodedBody = rawBody === '' ? null : Request.#tryParseJson(rawBody)
    }

    /** 解析后的 JSON 请求体；缺失或非法返回 null */
    json() {
        return this.decodedBody
    }

    /**
     * @param {string} name 大小写不敏感
     * @returns {string|undefined}
     */
    header(name) {
        const value = this.headers[name.toLowerCase()]
        if (Array.isArray(value)) {
            return value[0]
        }

        return value
    }

    /**
     * @param {string} key
     * @returns {string|null}
     */
    queryParam(key) {
        const value = this.query.get(key)

        return value === null ? null : value
    }

    /** @param {string} name */
    routeParam(name) {
        return this.params[name] ?? ''
    }

    /**
     * 按名称读取 Cookie；不存在或空值返回 null。
     *
     * @param {string} name
     */
    cookie(name) {
        const header = this.header('cookie')
        if (!header) {
            return null
        }

        for (const pair of header.split(';')) {
            const separator = pair.indexOf('=')
            if (separator === -1) {
                continue
            }
            if (pair.slice(0, separator).trim() !== name) {
                continue
            }
            const raw = pair.slice(separator + 1).trim()
            let decoded = raw
            try {
                decoded = decodeURIComponent(raw)
            } catch {
                // 非法转义保留原值
            }

            return decoded === '' ? null : decoded
        }

        return null
    }

    /** 请求是否经 HTTPS（部署层 TLS 终结时由 X-Forwarded-Proto 传递） */
    isSecure() {
        const proto = this.header('x-forwarded-proto')

        return typeof proto === 'string' && proto.trim().toLowerCase() === 'https'
    }

    /** @param {Record<string, string>} params */
    withParams(params) {
        const clone = Object.create(Request.prototype)
        Object.assign(clone, this)
        clone.params = params

        return clone
    }

    static #tryParseJson(raw) {
        try {
            return JSON.parse(raw)
        } catch {
            return null
        }
    }
}
