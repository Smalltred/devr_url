/**
 * HTTP 传输层：读取请求体 → 构造 Request → 交给应用 → 写回响应。
 * 与 server.js 分离，便于测试用同一套真实链路（而不是 mock）。
 */
import { createServer as createHttpServer } from 'node:http'
import { Request } from './request.js'

/**
 * @param {{handleRequest: (request: Request) => Promise<import('./response.js').Response>}} app
 * @param {object} config
 */
export function createServer(app, config) {
    /**
     * 读取请求体；超过上限时只保留“已超限”标记，避免恶意大包占满内存。
     *
     * @param {import('node:http').IncomingMessage} req
     * @param {number} limit 0 = 不限
     */
    function readBody(req, limit) {
        return new Promise((resolveBody, reject) => {
            const chunks = []
            let size = 0
            let exceeded = false

            req.on('data', (chunk) => {
                if (exceeded) {
                    return
                }
                size += chunk.length
                if (limit > 0 && size > limit) {
                    exceeded = true
                    req.resume()

                    return
                }
                chunks.push(chunk)
            })
            req.on('end', () => resolveBody({ body: Buffer.concat(chunks).toString('utf8'), exceeded }))
            req.on('error', reject)
        })
    }

    return createHttpServer(async (req, res) => {
        try {
            const rawUrl = req.url ?? '/'
            const queryIndex = rawUrl.indexOf('?')
            const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex)
            const rawQuery = queryIndex === -1 ? '' : rawUrl.slice(queryIndex + 1)

            let path = rawPath
            try {
                path = decodeURIComponent(rawPath)
            } catch {
                // 非法转义保留原路径，交给路由判定
            }
            if (path === '') {
                path = '/'
            }

            const { body, exceeded } = await readBody(req, config.app.maxBodyBytes)

            // 超限时用一个“超过上限”的占位体交给应用层判定：保持与旧实现相同的 413 出口与安全头
            const rawBody = exceeded ? 'x'.repeat(config.app.maxBodyBytes + 1) : body

            const request = new Request({
                method: String(req.method ?? 'GET').toUpperCase(),
                path,
                query: new URLSearchParams(rawQuery),
                headers: req.headers,
                rawBody,
                clientIp: req.socket?.remoteAddress ?? '',
            })

            const response = await app.handleRequest(request)

            res.statusCode = response.status
            for (const [name, value] of Object.entries(response.headers)) {
                res.setHeader(name, value)
            }

            // HEAD 只回响应头
            if (request.method === 'HEAD') {
                res.end()

                return
            }

            res.end(response.body)
        } catch (error) {
            // 兜底：不向客户端泄露内部信息
            console.error('short-url request failure:', error?.message ?? error)
            if (!res.headersSent) {
                res.statusCode = 500
                res.setHeader('content-type', 'application/json; charset=utf-8')
            }
            res.end(JSON.stringify({ error: 'Internal Server Error' }))
        }
    })
}
