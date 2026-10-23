/**
 * 静态资源（仅本地开发/单进程直接运行时使用；生产由 Nginx 直出）。
 *
 * 只从 dist 根目录提供服务：
 * - 拒绝 NUL 与路径穿越（realpath 后必须仍在根目录内）；
 * - 只处理 GET/HEAD，且路径为 / 或带扩展名的文件（短码不含点，不会冲突）。
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { Response } from './response.js'

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.map': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
}

/**
 * @param {import('./request.js').Request} request
 * @param {string} rootDir
 * @returns {Response|null} 命中返回响应，未命中返回 null（继续走路由）
 */
export function serveStatic(request, rootDir) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return null
    }

    let path = request.path
    if (path === '/' || path === '') {
        path = '/index.html'
    }

    if (path.includes('\0')) {
        return null
    }

    // 只有带扩展名的路径才尝试静态文件：短码为纯字母数字，不会命中
    if (!extname(path)) {
        return null
    }

    const root = safeRealPath(rootDir)
    if (root === null) {
        return null
    }

    const candidate = safeRealPath(join(root, path.replace(/^\/+/, '')))
    if (candidate === null || !candidate.startsWith(root + sep) || !statExists(candidate)) {
        return null
    }

    let body
    try {
        body = readFileSync(candidate)
    } catch {
        return null
    }

    const type = MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream'

    return new Response(200, { 'content-type': type, 'x-content-type-options': 'nosniff' }, body)
}

/**
 * @param {string} path
 * @returns {string|null}
 */
function safeRealPath(path) {
    try {
        if (!existsSync(path)) {
            return null
        }

        return realpathSync(path)
    } catch {
        return null
    }
}

/**
 * @param {string} path
 */
function statExists(path) {
    try {
        return statSync(path).isFile()
    } catch {
        return false
    }
}
