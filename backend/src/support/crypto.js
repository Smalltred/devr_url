/**
 * 加密相关：token、哈希、密码校验。
 *
 * 密码哈希使用 bcrypt（与 PHP `password_hash(PASSWORD_DEFAULT)` 兼容）：
 * 存量库中由 PHP 写入的 `$2y$` 哈希仍可验证，改密后写出的哈希同样可被两种运行时识别。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'

/**
 * 生成 256 位随机 token（64 位小写十六进制）。
 */
export function generateToken() {
    return randomBytes(32).toString('hex')
}

/**
 * SHA-256 十六进制摘要。
 *
 * @param {string} value
 */
export function sha256Hex(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * 常量时间字符串比较（长度不同直接返回 false）。
 *
 * @param {string} expected
 * @param {string} actual
 */
export function safeEqual(expected, actual) {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(actual, 'utf8')
    if (a.length !== b.length) {
        return false
    }

    return timingSafeEqual(a, b)
}

/**
 * 校验密码：支持 bcrypt（$2a$/$2b$/$2y$）与明文回退。
 *
 * @param {string} password
 * @param {string} stored 配置或数据库中的哈希/明文
 * @param {boolean} [isHash] 是否按哈希处理
 */
export function verifyPassword(password, stored, isHash = true) {
    if (!isHash) {
        return safeEqual(stored, password)
    }

    try {
        return bcrypt.compareSync(password, stored)
    } catch {
        return false
    }
}

/**
 * 生成 bcrypt 哈希（cost 10，接近 PHP PASSWORD_DEFAULT 默认强度）。
 *
 * @param {string} password
 */
export function hashPassword(password) {
    return bcrypt.hashSync(password, 10)
}
