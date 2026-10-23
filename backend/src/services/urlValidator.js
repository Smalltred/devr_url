/**
 * URL 校验与归一化（逐条对齐 PHP 版 UrlValidator 的行为）：
 *
 * - 必须是字符串、非空、http/https 开头、存在 host；
 * - 拒绝 ASCII 空白字符；
 * - 归一化前后都按字节检查 2048 上限（超限 → 413）；
 * - 孤立的 %（未跟两位十六进制）转义为 %25；
 * - 已经是合法 %XX 的序列不二次编码；
 * - 非 ASCII 字符（中文路径/查询参数）按 UTF-8 逐字节百分号编码。
 */
import { Buffer } from 'node:buffer'
import { invalidUrl, payloadTooLarge } from '../support/errors.js'

const MAX_LENGTH = 2048
const SCHEME_PATTERN = /^https?:\/\//i
const ISOLATED_PERCENT_PATTERN = /%(?![0-9A-Fa-f]{2})/g
const ASCII_WHITESPACE = /[\t\n\v\f\r ]/

export class UrlValidator {
    static MAX_LENGTH = MAX_LENGTH

    /**
     * @param {unknown} value
     * @returns {string} 归一化后的 URL
     */
    validate(value) {
        if (typeof value !== 'string') {
            throw invalidUrl()
        }

        const url = value.trim()
        if (url === '') {
            throw invalidUrl()
        }

        if (Buffer.byteLength(url, 'utf8') > MAX_LENGTH) {
            throw payloadTooLarge(`URL exceeds ${MAX_LENGTH} bytes`)
        }

        if (ASCII_WHITESPACE.test(url)) {
            throw invalidUrl()
        }

        if (!SCHEME_PATTERN.test(url)) {
            throw invalidUrl()
        }

        let parsed
        try {
            parsed = new URL(url)
        } catch {
            throw invalidUrl()
        }

        if (parsed.hostname === '') {
            throw invalidUrl()
        }

        if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
            throw invalidUrl()
        }

        // URL 构造函数对非法端口直接抛错，这里再兜一层显式范围校验
        if (parsed.port !== '' && (Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
            throw invalidUrl()
        }

        const normalized = UrlValidator.normalize(url)
        if (Buffer.byteLength(normalized, 'utf8') > MAX_LENGTH) {
            throw payloadTooLarge(`URL exceeds ${MAX_LENGTH} bytes`)
        }

        return normalized
    }

    /**
     * @param {string} url
     */
    static normalize(url) {
        const withoutIsolatedPercent = url.replace(ISOLATED_PERCENT_PATTERN, '%25')

        // PHP 的 rawurlencode 按字节编码非 ASCII；这里用 Buffer 逐字节复刻，保证与存量数据一致
        const bytes = Buffer.from(withoutIsolatedPercent, 'utf8')
        let output = ''
        for (const byte of bytes) {
            output += byte >= 0x80
                ? `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
                : String.fromCharCode(byte)
        }

        return output
    }
}
