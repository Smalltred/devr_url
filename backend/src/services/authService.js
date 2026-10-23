/**
 * 单管理员登录与鉴权。
 *
 * - 凭据：settings 中的后台改密哈希 > ADMIN_PASSWORD_HASH > ADMIN_PASSWORD；
 * - 登录成功签发 64 位十六进制 token，库存 sha256，Cookie 只存原文；
 * - 登录失败按 IP 匿名哈希节流：15 分钟内失败 5 次后锁定；
 * - 改密后撤销全部登录态。
 */
import { generateToken, hashPassword, safeEqual, sha256Hex, verifyPassword } from '../support/crypto.js'
import { throttleError, unauthorized, validationError } from '../support/errors.js'

const COOKIE_NAME = 'admin_token'
const THROTTLE_WINDOW_SECONDS = 900
const THROTTLE_MAX_FAILURES = 5
const MIN_PASSWORD_LENGTH = 8

export class AuthService {
    /**
     * @param {object} repository
     * @param {object} config
     * @param {import('../support/logger.js').Logger} logger
     * @param {import('../support/ipHasher.js').IpHasher} ipHasher
     * @param {import('../services/settingsService.js').SettingsService} settings
     */
    constructor(repository, config, logger, ipHasher, settings) {
        this.repository = repository
        this.config = config
        this.logger = logger
        this.ipHasher = ipHasher
        this.settings = settings
    }

    /**
     * 校验凭据并签发 token。
     *
     * @param {unknown} username
     * @param {unknown} password
     * @param {import('../http/request.js').Request} request
     * @returns {string} Set-Cookie 值
     */
    login(username, password, request) {
        const ipHash = this.ipHasher.hash(request.clientIp) ?? 'anonymous'
        this.#assertNotThrottled(ipHash)

        if (!this.#credentialsMatch(username, password)) {
            this.#recordFailure(ipHash)
            this.logger.info('admin login failed', { ip_hash: ipHash })
            throw unauthorized('用户名或密码错误')
        }

        this.repository.clearThrottle(ipHash)

        const token = generateToken()
        const now = Math.floor(Date.now() / 1000)
        const ttl = Math.max(1, Number(this.config.auth.tokenTtlDays) || 7) * 86400
        this.repository.createToken(sha256Hex(token), now, now + ttl)
        this.repository.purgeExpiredTokens(now)

        return this.#cookie(token, ttl, this.#cookieSecure(request, true))
    }

    /**
     * @param {import('../http/request.js').Request} request
     * @returns {string} 清除 Cookie 的 Set-Cookie 值
     */
    logout(request) {
        const token = request.cookie(COOKIE_NAME)
        if (token) {
            this.repository.deleteToken(sha256Hex(token))
        }

        return this.#cookie('', 0, this.#cookieSecure(request, false))
    }

    /** @param {import('../http/request.js').Request} request */
    isAuthenticated(request) {
        const token = request.cookie(COOKIE_NAME)
        if (!token) {
            return false
        }

        return this.repository.validExpiresAt(sha256Hex(token), Math.floor(Date.now() / 1000)) !== null
    }

    /** @param {import('../http/request.js').Request} request */
    requireAuth(request) {
        if (!this.isAuthenticated(request)) {
            throw unauthorized()
        }
    }

    /**
     * 校验当前密码（settings 哈希 → env 哈希 → env 明文）。
     *
     * @param {string} password
     */
    verifyPassword(password) {
        const customHash = this.settings.adminPasswordHash()
        if (customHash !== '') {
            return verifyPassword(password, customHash, true)
        }

        const envHash = this.config.auth.passwordHash
        if (typeof envHash === 'string' && envHash !== '') {
            return verifyPassword(password, envHash, true)
        }

        return safeEqual(String(this.config.auth.password), password)
    }

    /**
     * 修改密码：校验当前密码 → 落库新哈希 → 撤销全部登录态。
     *
     * @param {string} currentPassword
     * @param {string} newPassword
     */
    changePassword(currentPassword, newPassword) {
        if (!this.verifyPassword(currentPassword)) {
            throw unauthorized('当前密码不正确')
        }
        if (Array.from(newPassword).length < MIN_PASSWORD_LENGTH) {
            throw validationError(`新密码至少需要 ${MIN_PASSWORD_LENGTH} 位`)
        }

        this.settings.save({ admin_password_hash: hashPassword(newPassword) })
        this.repository.purgeAllTokens()
        this.logger.info('admin password changed')
    }

    #credentialsMatch(username, password) {
        if (typeof username !== 'string' || typeof password !== 'string' || username === '' || password === '') {
            return false
        }

        return safeEqual(String(this.config.auth.username), username) && this.verifyPassword(password)
    }

    #assertNotThrottled(ipHash) {
        const state = this.repository.throttleState(ipHash)
        if (!state) {
            return
        }

        const now = Math.floor(Date.now() / 1000)
        if (now - state.window_start < THROTTLE_WINDOW_SECONDS && state.fails >= THROTTLE_MAX_FAILURES) {
            throw throttleError('失败次数过多，请 15 分钟后再试')
        }
    }

    #recordFailure(ipHash) {
        const now = Math.floor(Date.now() / 1000)
        const state = this.repository.throttleState(ipHash)

        let fails = 1
        let windowStart = now
        if (state && now - state.window_start < THROTTLE_WINDOW_SECONDS) {
            fails = state.fails + 1
            windowStart = state.window_start
        }

        this.repository.saveThrottle(ipHash, fails, windowStart)
    }

    /**
     * @param {import('../http/request.js').Request} request
     * @param {boolean} considerAppUrl 登录时 APP_URL 为 https 也附 Secure；登出只看当前请求
     */
    #cookieSecure(request, considerAppUrl) {
        if (request.isSecure()) {
            return true
        }

        return considerAppUrl && String(this.config.app.url ?? '').toLowerCase().startsWith('https://')
    }

    #cookie(token, maxAge, secure) {
        return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${maxAge}`
    }
}

export { COOKIE_NAME }
