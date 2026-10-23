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
 * 设备判定：UA 为空记 unknown，含 mobile 记 mobile，其余 desktop。
 *
 * @param {string} userAgent
 */
function deviceOf(userAgent) {
    if (!userAgent) {
        return 'unknown'
    }

    return userAgent.toLowerCase().includes('mobile') ? 'mobile' : 'desktop'
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
        const refererHeader = request.header('referer') ?? null
        const userAgent = request.header('user-agent') ?? ''

        this.clicks.record(code, {
            referer: this.storeFullReferer ? truncate(refererHeader, MAX_REFERER_LENGTH) : null,
            referer_host: truncate(hostOf(refererHeader), MAX_REFERER_HOST_LENGTH),
            device: deviceOf(userAgent),
            ip_hash: this.ipHasher.hash(request.clientIp),
        })
    }
}
