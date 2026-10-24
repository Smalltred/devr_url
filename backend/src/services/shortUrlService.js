/**
 * 短链业务：校验 URL → 自增 ID → 生成短码 → 落库。
 * 不做 URL 去重（同一 URL 多次提交产生多个短码），与原版一致。
 */
import { notFoundCode, storageError } from '../support/errors.js'

const RANDOM_MAX_ATTEMPTS = 20

export class ShortUrlService {
    /**
     * @param {object} urls 仓储（可能是缓存装饰器）
     * @param {import('./shortCode.js').ShortCodeService} shortCode
     * @param {import('./urlValidator.js').UrlValidator} validator
     * @param {import('./settingsService.js').SettingsService} settings
     */
    constructor(urls, shortCode, validator, settings) {
        this.urls = urls
        this.shortCode = shortCode
        this.validator = validator
        this.settings = settings
    }

    /**
     * @param {unknown} rawUrl
     * @param {?{type: string, name: ?string, ip: ?string, userAgent: ?string}} creator
     * @returns {Promise<{url: string, code: string}>}
     */
    async create(rawUrl, creator = null) {
        const url = this.validator.validate(rawUrl)
        const id = this.urls.nextId()
        const code = await this.#generateCode(id)
        await this.urls.save(code, url, creator)

        return { url, code }
    }

    /**
     * @param {string} code
     * @returns {Promise<string>} 原始 URL
     */
    async resolve(code) {
        if (!code) {
            throw notFoundCode()
        }

        const url = await this.urls.findByCode(code)
        if (url === null || url === undefined) {
            throw notFoundCode()
        }

        return url
    }

    async #generateCode(id) {
        const natural = this.shortCode.encode(id)
        const targetLength = Math.max(this.settings.codeMinLength(), natural.length)

        if (!this.settings.codeRandom()) {
            const deterministic = this.shortCode.padTo(natural, targetLength)
            if (!this.urls.exists(deterministic) && !this.#collidesWithAdminPath(deterministic)) {
                return deterministic
            }
        }

        for (let attempt = 0; attempt < RANDOM_MAX_ATTEMPTS; attempt += 1) {
            const candidate = this.shortCode.randomCode(targetLength)
            if (!this.urls.exists(candidate) && !this.#collidesWithAdminPath(candidate)) {
                return candidate
            }
        }

        throw storageError('Unable to generate a unique short code')
    }

    /**
     * 短码与后台安全入口同路径时会被入口页遮蔽，必须避开。
     *
     * @param {string} code
     */
    #collidesWithAdminPath(code) {
        return `/${code}` === this.settings.adminPath()
    }
}
