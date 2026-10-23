/**
 * User-Agent 粗解析：只用于后台展示「创建者设备」，不做指纹或精确版本识别。
 * 输出 type 用于二分类之外的展示（桌面/移动/平板），os/browser 用于人类可读标签。
 */

const TYPE_LABELS = {
    desktop: '桌面',
    mobile: '移动',
    tablet: '平板',
    unknown: '未知设备',
}

/**
 * @param {unknown} rawUserAgent
 * @returns {{type: 'desktop'|'mobile'|'tablet'|'unknown', os: string|null, browser: string|null, label: string}}
 */
export function describeUserAgent(rawUserAgent) {
    const ua = String(rawUserAgent ?? '').trim()
    if (ua === '') {
        return { type: 'unknown', os: null, browser: null, label: TYPE_LABELS.unknown }
    }

    const lower = ua.toLowerCase()

    let type = 'desktop'
    if (/ipad|tablet|kindle|silk|playbook/.test(lower)) {
        type = 'tablet'
    } else if (/mobile|iphone|ipod|windows phone|android.*mobile/.test(lower)) {
        type = 'mobile'
    }

    const os = detectOs(lower)
    const browser = detectBrowser(ua, lower)
    const parts = [TYPE_LABELS[type]]
    if (os) parts.push(os)
    if (browser) parts.push(browser)

    return { type, os, browser, label: parts.join(' · ') }
}

/** @param {string} lower */
function detectOs(lower) {
    if (/iphone|ipad|ipod/.test(lower)) return 'iOS'
    if (lower.includes('android')) return 'Android'
    if (lower.includes('windows')) return 'Windows'
    if (/mac os x|macintosh/.test(lower)) return 'macOS'
    if (/cros/.test(lower)) return 'ChromeOS'
    if (/linux|x11/.test(lower)) return 'Linux'
    if (/harmonyos/.test(lower)) return 'HarmonyOS'

    return null
}

/**
 * @param {string} ua 原始 UA（大小写敏感，用于 Chrome/ Safari 区分）
 * @param {string} lower
 */
function detectBrowser(ua, lower) {
    // 顺序有依赖：Edge/Opera/微信/QQ 的 UA 都含 Chrome 或 Safari 标记
    if (lower.includes('micromessenger')) return '微信'
    if (lower.includes('qqbrowser') || /\bqq\/[\d.]+/.test(lower)) return 'QQ浏览器'
    if (lower.includes('edg/') || lower.includes('edge/')) return 'Edge'
    if (lower.includes('opr/') || lower.includes('opera')) return 'Opera'
    if (lower.includes('firefox/') || lower.includes('fxios/')) return 'Firefox'
    if (lower.includes('headlesschrome')) return 'Headless Chrome'
    if (lower.includes('chrome/') || lower.includes('crios/') || lower.includes('crmo/')) return 'Chrome'
    if (lower.includes('safari/') && ua.includes('Version/')) return 'Safari'
    if (lower.includes('curl/')) return 'curl'
    if (lower.includes('wget/')) return 'Wget'
    if (lower.includes('headlesschrome')) return 'Headless Chrome'

    return null
}
