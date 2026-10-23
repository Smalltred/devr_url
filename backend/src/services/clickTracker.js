/**
 * 点击采集：最小化采集来源域名、设备二分类与 IP 匿名哈希。
 * 不存原始 UA、不存原始 IP；采集失败不影响跳转。
 */

const MAX_REFERER_LENGTH = 500
const MAX_REFERER_HOST_LENGTH = 120

/**
 * 按字符（码点）截断，对齐 PHP mb_substr 语义。
 *
 * @param {?string} value
 * @param {number} length
 */
function truncate(value, length) {
    if (!value) {
        return null
    }
    const chars = Array.from(value)

    return chars.length > length ? chars.slice(0, length).join('') : value
}

/**
 * 来源域名：解析失败返回 null，成功则小写。
 *
 * @param {?string} referer
 */
function hostOf(referer) {
    if (!referer) {
        return null
    }
    try {
        const host = new URL(referer).hostname

        return host ? host.toLowerCase() : null
    } catch {
        return null
    }
}

/**
 * 设备判定：优先使用浏览器客户端提示（Sec-CH-UA-Mobile），
 * 其次按 UA 判断；iPad / Android 平板同样计入移动端。
 *
 * @param {string} userAgent
 * @param {string} mobileHint `?1` 表示移动端（Chromium 系浏览器会发送）
 */
function deviceOf(userAgent, mobileHint) {
    if (mobileHint === '?1') {
        return 'mobile'
    }
    if (!userAgent) {
        return 'unknown'
    }

    return /mobile|ipad|tablet/.test(userAgent.toLowerCase()) ? 'mobile' : 'desktop'
}

export class ClickTracker {
    /**
     * @param {{record: (code: string, ctx: object) => void}} clicks
     * @param {import('../support/ipHasher.js').IpHasher} ipHasher
     * @param {boolean} storeFullReferer
     */
    constructor(clicks, ipHasher, storeFullReferer = false) {
        this.clicks = clicks
        this.ipHasher = ipHasher
        this.storeFullReferer = storeFullReferer
    }

    /**
     * @param {object} request 请求上下文（headers/clientIp）
     * @param {string} code
     */
    track(request, code) {
        // 聊天软件（微信/QQ）打开链接时常不发送 Referer；此时退回 Origin，
        // 仍拿不到就记为 null —— 统计页会把它归入「直接访问」。
        const refererHeader = request.header('referer') ?? request.header('origin') ?? null
        const userAgent = request.header('user-agent') ?? ''
        const mobileHint = request.header('sec-ch-ua-mobile') ?? ''

        this.clicks.record(code, {
            referer: this.storeFullReferer ? truncate(refererHeader, MAX_REFERER_LENGTH) : null,
            referer_host: truncate(hostOf(refererHeader), MAX_REFERER_HOST_LENGTH),
            device: deviceOf(userAgent, mobileHint),
            ip_hash: this.ipHasher.hash(request.clientIp),
        })
    }
}
