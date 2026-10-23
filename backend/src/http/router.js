/**
 * 轻量路由：精确路径 + 单段参数（{code}），末尾可选斜杠。
 * 路径命中但方法不符返回 405（带 Allow）；完全未命中返回 404。
 */
import { Response } from './response.js'

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} pattern
 * @returns {{regex: RegExp, params: string[]}}
 */
function compile(pattern) {
    const params = []
    let source = ''
    let lastIndex = 0
    const patternRegex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
    let match

    while ((match = patternRegex.exec(pattern)) !== null) {
        source += escapeRegex(pattern.slice(lastIndex, match.index)) + '([^/]+)'
        params.push(match[1])
        lastIndex = patternRegex.lastIndex
    }
    source += escapeRegex(pattern.slice(lastIndex))

    return { regex: new RegExp(`^${source}/?$`), params }
}

export class Router {
    constructor() {
        /** @type {{method: string, regex: RegExp, params: string[], handler: Function}[]} */
        this.routes = []
    }

    get(pattern, handler) {
        this.#add('GET', pattern, handler)
    }

    post(pattern, handler) {
        this.#add('POST', pattern, handler)
    }

    put(pattern, handler) {
        this.#add('PUT', pattern, handler)
    }

    delete(pattern, handler) {
        this.#add('DELETE', pattern, handler)
    }

    /**
     * @param {import('./request.js').Request} request
     */
    async dispatch(request) {
        const method = request.method === 'HEAD' ? 'GET' : request.method
        const allowed = []

        for (const route of this.routes) {
            const match = route.regex.exec(request.path)
            if (!match) {
                continue
            }

            if (route.method !== method) {
                if (!allowed.includes(route.method)) {
                    allowed.push(route.method)
                }
                continue
            }

            const params = {}
            route.params.forEach((name, index) => {
                params[name] = match[index + 1] ?? ''
            })

            return await route.handler(request.withParams(params))
        }

        if (allowed.length > 0) {
            return Response.json({ error: 'Method Not Allowed' }, 405, { allow: allowed.join(', ') })
        }

        return Response.json({ error: 'Not Found' }, 404)
    }

    #add(method, pattern, handler) {
        const { regex, params } = compile(pattern)
        this.routes.push({ method, regex, params, handler })
    }
}
