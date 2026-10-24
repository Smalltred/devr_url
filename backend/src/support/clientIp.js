/**
 * 客户端 IP 解析：直连时用 socket 地址；反向代理（nginx/宝塔/Docker）场景读取代理头。
 *
 * 只有请求来自回环/私网地址时才信任 X-Real-IP / X-Forwarded-For ——
 * 应用在部署上只监听 127.0.0.1 或容器内网，代理是唯一入口；
 * 若直接暴露公网，攻击者可伪造代理头，因此公网来源一律以 socket 地址为准。
 */
import { isIP } from 'node:net'

/**
 * 规整 IP：去空白、剥掉 IPv4-mapped IPv6 前缀、校验合法性；非法返回 ''。
 *
 * @param {unknown} value
 */
function normalizeIp(value) {
    const text = String(value ?? '').trim()
    if (text === '') {
        return ''
    }
    // X-Forwarded-For 可能带端口（部分代理会这样写）
    const withoutPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text)
    const candidate = withoutPort ? withoutPort[1] : text
    const mapped = candidate.toLowerCase().startsWith('::ffff:') ? candidate.slice(7) : candidate
    if (!isIP(mapped)) {
        return ''
    }

    return mapped.toLowerCase()
}

/** @param {string} ip */
function isPrivateOrLoopback(ip) {
    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) {
        return true
    }
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) {
        return true
    }
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
        return true
    }
    // IPv6 唯一本地地址 / 链路本地
    return ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')
}

/**
 * @param {unknown} remoteAddress socket 地址
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {boolean} trustProxy 是否信任来自私网/回环的代理头
 */
export function resolveClientIp(remoteAddress, headers = {}, trustProxy = true) {
    const remote = normalizeIp(remoteAddress)
    if (!trustProxy || !isPrivateOrLoopback(remote)) {
        return remote
    }

    const real = normalizeIp(headerValue(headers['x-real-ip']))
    if (real !== '') {
        return real
    }

    // X-Forwarded-For 从右往左取：最右侧由最近的受信代理追加，最可信；
    // 左侧条目可被客户端伪造（nginx 的 $proxy_add_x_forwarded_for 是“追加”语义），
    // 若取首项，攻击者在代理之后即可轮换伪造 IP 绕过登录节流与创建限流。
    const forwarded = headerValue(headers['x-forwarded-for'])
    if (typeof forwarded === 'string' && forwarded !== '') {
        const parts = forwarded.split(',')
        for (let i = parts.length - 1; i >= 0; i -= 1) {
            const candidate = normalizeIp(parts[i])
            if (candidate !== '') {
                return candidate
            }
        }
    }

    return remote
}

/** @param {string|string[]|undefined} value */
function headerValue(value) {
    return Array.isArray(value) ? value[0] : value
}
