/**
 * IP 匿名哈希：取 sha256(ip + 安装级随机盐) 或 HMAC(ip, IP_HASH_SECRET) 的前 24 位。
 *
 * - 配置 IP_HASH_SECRET 后改用 HMAC，密钥不随数据库存储，库泄露也无法反推 IP；
 * - 未配置时使用持久化在 app_meta 的随机盐，首次使用时生成。
 * 仅用于独立访客估算与限流键，原始 IP 不落库。
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'

const SALT_KEY = 'ip_hash_salt'

export class IpHasher {
    /**
     * @param {import('../db/repositories.js').MetaRepository} meta
     * @param {string} secret
     */
    constructor(meta, secret = '') {
        this.meta = meta
        this.secret = secret
        this.salt = null
    }

    /**
     * @param {string} ip
     * @returns {string|null} 空 IP 返回 null
     */
    hash(ip) {
        if (!ip) {
            return null
        }
        if (this.secret !== '') {
            return createHmac('sha256', this.secret).update(ip, 'utf8').digest('hex').slice(0, 24)
        }

        return createHash('sha256').update(ip + this.#salt(), 'utf8').digest('hex').slice(0, 24)
    }

    #salt() {
        if (this.salt !== null) {
            return this.salt
        }

        const stored = this.meta.get(SALT_KEY)
        if (stored) {
            this.salt = stored

            return this.salt
        }

        const generated = randomBytes(16).toString('hex')
        this.meta.set(SALT_KEY, generated)

        // 并发下可能已被其他进程写入，回读一次以保持全站一致
        const readBack = this.meta.get(SALT_KEY)
        this.salt = readBack || generated

        return this.salt
    }
}
