/**
 * 开放 API Key：明文仅在创建/重置时返回，库存 sha256；列表只暴露展示前缀。
 */
import { randomBytes } from 'node:crypto'
import { notFoundCode, unauthorized, validationError } from '../support/errors.js'
import { sha256Hex } from '../support/crypto.js'

const KEY_PREFIX = 'devr_'
const KEY_RANDOM_BYTES = 16
const DISPLAY_PREFIX_LENGTH = 12
const MAX_NAME_LENGTH = 64

export class ApiKeyService {
    /**
     * @param {object} repository
     * @param {import('../support/logger.js').Logger} logger
     */
    constructor(repository, logger) {
        this.repository = repository
        this.logger = logger
    }

    /**
     * @param {unknown} name
     * @returns {{id: number, name: string, prefix: string, key: string}}
     */
    create(name) {
        const normalizedName = this.#normalizeName(name)
        const key = this.#generateKey()
        const prefix = key.slice(0, DISPLAY_PREFIX_LENGTH)
        const id = this.repository.create(normalizedName, sha256Hex(key), prefix)
        this.logger.info('api key created', { id })

        return { id, name: normalizedName, prefix, key }
    }

    /**
     * @param {number} id
     */
    reset(id) {
        const row = this.repository.find(id)
        if (!row) {
            throw notFoundCode('API Key 不存在')
        }

        const key = this.#generateKey()
        const prefix = key.slice(0, DISPLAY_PREFIX_LENGTH)
        this.repository.updateKeyHash(id, sha256Hex(key), prefix)
        this.logger.info('api key reset', { id })

        return { id, name: row.name, prefix, key }
    }

    /** @param {number} id */
    delete(id) {
        if (!this.repository.delete(id)) {
            throw notFoundCode('API Key 不存在')
        }
        this.logger.info('api key deleted', { id })
    }

    list() {
        return this.repository.findAll()
    }

    /**
     * 鉴权门卫：无效或缺失 Key → 401 Invalid API Key。
     * 返回 Key 的标识信息，供创建短链时记录创建者。
     *
     * @param {import('../http/request.js').Request} request
     * @returns {{id: number, name: string}}
     */
    requireValidKey(request) {
        const key = this.keyFromRequest(request)
        const info = key ? this.resolve(key) : null
        if (info === null) {
            throw unauthorized('Invalid API Key')
        }

        return info
    }

    /**
     * 校验 Key 并返回其标识；无效返回 null。
     *
     * @param {string} key
     * @returns {?{id: number, name: string}}
     */
    resolve(key) {
        const id = this.repository.findIdByKeyHash(sha256Hex(key))
        if (id === null) {
            return null
        }

        try {
            this.repository.touchLastUsed(id)
        } catch (error) {
            this.logger.error('api key touch failed', { id, exception: error?.name ?? 'Error' })
        }

        const row = this.repository.find(id)

        return { id, name: row && typeof row.name === 'string' ? row.name : '' }
    }

    /**
     * @param {string} key
     */
    authenticate(key) {
        return this.resolve(key) !== null
    }

    /**
     * 从请求头提取 Key：Authorization: Bearer <key> 或 X-API-Key。
     *
     * @param {import('../http/request.js').Request} request
     * @returns {string|null}
     */
    keyFromRequest(request) {
        const authorization = request.header('authorization')
        if (typeof authorization === 'string') {
            const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
            if (match) {
                return match[1]
            }
        }

        const apiKey = request.header('x-api-key')
        if (typeof apiKey === 'string' && apiKey.trim() !== '') {
            return apiKey.trim()
        }

        return null
    }

    #generateKey() {
        return KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString('hex')
    }

    #normalizeName(name) {
        if (typeof name !== 'string') {
            throw validationError('Key 名称必须为字符串')
        }
        const trimmed = name.trim()
        if (trimmed === '' || Array.from(trimmed).length > MAX_NAME_LENGTH) {
            throw validationError(`Key 名称需为 1-${MAX_NAME_LENGTH} 个字符`)
        }

        return trimmed
    }
}
