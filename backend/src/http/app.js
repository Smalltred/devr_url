/**
 * 应用装配：仓储 → 服务 → 路由，以及全局中间件顺序。
 *
 * 中间件顺序与 PHP 版一致：请求体上限（413）→ CSRF（403）→ 路由/鉴权 → 安全响应头。
 * 所有依赖可注入（第二个参数），便于测试替换。
 */
import { existsSync, readFileSync } from 'node:fs'
import { Database } from '../db/database.js'
import { SqliteUrlRepository } from '../db/urlRepository.js'
import { SqliteClickRepository } from '../db/clickRepository.js'
import {
    SqliteAuthRepository,
    SqliteMetaRepository,
    SqliteThrottleRepository,
} from '../db/authRepository.js'
import { SqliteApiKeyRepository, SqliteSettingsRepository } from '../db/settingsRepository.js'
import { CachedUrlRepository } from '../cache/cachedUrlRepository.js'
import { createStore } from '../cache/storeFactory.js'
import { IpHasher } from '../support/ipHasher.js'
import { Logger } from '../support/logger.js'
import { AppError, payloadTooLarge, validationError } from '../support/errors.js'
import { ShortCodeService } from '../services/shortCode.js'
import { UrlValidator } from '../services/urlValidator.js'
import { SettingsService } from '../services/settingsService.js'
import { ShortUrlService } from '../services/shortUrlService.js'
import { ClickTracker } from '../services/clickTracker.js'
import { AuthService } from '../services/authService.js'
import { ApiKeyService } from '../services/apiKeyService.js'
import { LinkHealthService } from '../services/linkHealthService.js'
import { HttpLinkProbe } from '../services/httpLinkProbe.js'
import { AdminService } from '../services/adminService.js'
import { Request } from './request.js'
import { Response, SecurityHeaders } from './response.js'
import { Router } from './router.js'
import { CsrfGuard, RequestRateLimiter } from './security.js'
import { serveStatic } from './static.js'

/**
 * @param {object} config
 * @param {object} [overrides] 依赖注入（测试用）
 */
export function createApp(config, overrides = {}) {
    const logger = overrides.logger ?? new Logger(config.logging.path)
    const database = overrides.database ?? new Database(config.database.path)

    const urlStore = overrides.urlRepository ?? new SqliteUrlRepository(database)
    const clickStore = overrides.clickRepository ?? new SqliteClickRepository(database)
    const authStore = overrides.authRepository ?? new SqliteAuthRepository(database)
    const settingsStore = overrides.settingsRepository ?? new SqliteSettingsRepository(database)
    const apiKeyStore = overrides.apiKeyRepository ?? new SqliteApiKeyRepository(database)
    const metaStore = overrides.metaRepository ?? new SqliteMetaRepository(database)
    const throttleStore = overrides.throttleRepository ?? new SqliteThrottleRepository(database)

    const settings = new SettingsService(settingsStore, {
        cacheTtl: config.cache.ttl,
        cacheNegativeTtl: config.cache.negativeTtl,
        healthScanEnabled: config.health.scanEnabled,
        healthScanHour: config.health.scanHour,
        healthScanMinute: config.health.scanMinute,
        healthDeadThreshold: config.health.deadThreshold,
    })
    const cache = overrides.cache ?? createStore(config.cache, logger)
    const urls = new CachedUrlRepository(urlStore, cache, settings)

    const ipHasher = new IpHasher(metaStore, config.security.ipHashSecret)
    const shortCode = new ShortCodeService()
    const validator = new UrlValidator()
    const shortUrls = new ShortUrlService(urls, shortCode, validator, settings)
    const clicks = new ClickTracker(clickStore, ipHasher, config.privacy.storeFullReferer)
    const auth = new AuthService(authStore, config, logger, ipHasher, settings)
    const apiKeys = new ApiKeyService(apiKeyStore, logger)
    const probe = overrides.linkProbe ?? new HttpLinkProbe({
        timeoutSeconds: config.health.timeoutSeconds,
        connectTimeoutSeconds: config.health.connectTimeoutSeconds,
    })
    const health = new LinkHealthService(urls, probe, logger, config.health.staleHours, settings)
    const admin = new AdminService(urls, clickStore, validator, settings, cache, health)

    const csrf = new CsrfGuard(config.security.allowedOrigins, config.security.csrfAllowMissingOrigin)
    const rateLimiter = new RequestRateLimiter(
        throttleStore,
        ipHasher,
        config.ratelimit.createMax,
        config.ratelimit.createWindowSeconds,
    )

    const router = new Router()

    // ---------------------------------------------------------------- 路由

    const publicGuard = (handler) => async (request) => {
        const authenticated = auth.isAuthenticated(request)
        if (!authenticated && settings.requireLogin()) {
            auth.requireAuth(request)
        }
        rateLimiter.assertAllowed(request, RequestRateLimiter.SCOPE_CREATE)
        // 创建者身份：管理员（已登录）或游客；由 createShortUrl 写入短链元信息
        request.creatorType = authenticated ? 'admin' : 'guest'
        request.creatorName = authenticated ? config.auth.username : null

        return await handler(request)
    }

    const openGuard = (handler) => async (request) => {
        const keyInfo = apiKeys.requireValidKey(request)
        rateLimiter.assertAllowed(request, RequestRateLimiter.SCOPE_CREATE)
        request.apiKeyName = keyInfo.name

        return await handler(request)
    }

    const guard = (handler) => async (request) => {
        auth.requireAuth(request)

        return await handler(request)
    }

    // 创建短链（/url 为旧接口，必须永久保留）
    const createShortUrl = async (request) => {
        const body = request.json()
        const url = body && typeof body === 'object' && !Array.isArray(body) ? body.url : null
        const viaApiKey = Object.prototype.hasOwnProperty.call(request, 'apiKeyName')
        const result = await shortUrls.create(url, {
            type: viaApiKey ? 'api_key' : (request.creatorType ?? 'guest'),
            name: viaApiKey ? request.apiKeyName : (request.creatorName ?? null),
            ip: request.clientIp || null,
            userAgent: request.header('user-agent') ?? '',
        })

        return Response.json({ url: result.url, code: result.code })
    }
    router.post('/url', publicGuard(createShortUrl))
    router.post('/api/url', publicGuard(createShortUrl))

    // 开放 API
    router.post('/api/open/shorten', openGuard(createShortUrl))

    // 鉴权
    router.post('/api/auth/login', async (request) => {
        const body = request.json()
        const username = body && typeof body === 'object' ? body.username : null
        const password = body && typeof body === 'object' ? body.password : null
        const cookie = auth.login(username, password, request)

        return Response.json({ ok: true }, 200, { 'set-cookie': cookie })
    })

    router.post('/api/auth/logout', async (request) => {
        return Response.json({ ok: true }, 200, { 'set-cookie': auth.logout(request) })
    })

    router.get('/api/auth/me', async (request) => {
        const authenticated = auth.isAuthenticated(request)
        const adminPath = settings.adminPath()
        const payload = {
            authenticated,
            require_login: settings.requireLogin(),
            // 只暴露「是否为自定义入口」，不向匿名访客泄露具体路径
            admin_entry_custom: adminPath !== '/admin',
        }
        if (authenticated) {
            payload.admin_path = adminPath
        }

        return Response.json(payload)
    })

    // 管理端概览
    router.get('/api/admin/overview', guard(async (request) => {
        return Response.json(await admin.overview(request.queryParam('period') ?? 'day'))
    }))

    // 短链列表
    router.get('/api/admin/links', guard(async (request) => {
        const page = Number.parseInt(request.queryParam('page') ?? '1', 10)
        const perPage = Number.parseInt(request.queryParam('per_page') ?? '20', 10)
        const query = request.queryParam('q') ?? ''
        const healthStatus = request.queryParam('health') ?? ''

        return Response.json(admin.links(page, perPage, query, healthStatus))
    }))

    // 外链巡检（静态段必须先于 /links/{code}）
    router.post('/api/admin/links/scan', guard(async (request) => {
        const body = request.json()
        const limit = body && typeof body === 'object' && body.limit !== undefined
            ? Number.parseInt(String(body.limit), 10) || 20
            : 20

        return Response.json(await admin.scanLinks(limit))
    }))

    // 失效清理：目标不可访问的短链一律视为失效（待确认 + 已判定），一次清空。
    // cleanup-broken / cleanup-dead 保留为兼容别名。
    router.post('/api/admin/links/cleanup-invalid', guard(async () => {
        return Response.json(await admin.cleanupInvalidLinks())
    }))

    router.post('/api/admin/links/cleanup-broken', guard(async () => {
        return Response.json(await admin.cleanupBrokenLinks())
    }))

    router.post('/api/admin/links/cleanup-dead', guard(async () => {
        return Response.json(await admin.cleanupDeadLinks())
    }))

    router.put('/api/admin/links/{code}', guard(async (request) => {
        return Response.json(await admin.updateLink(request.routeParam('code'), request.json()))
    }))

    router.delete('/api/admin/links/{code}', guard(async (request) => {
        await admin.deleteLink(request.routeParam('code'))

        return Response.json({ ok: true })
    }))

    router.get('/api/admin/links/{code}/stats', guard(async (request) => {
        return Response.json(
            await admin.linkStats(request.routeParam('code'), request.queryParam('period') ?? 'day'),
        )
    }))

    // 设置
    router.get('/api/admin/settings', guard(async () => Response.json(await admin.settingsView())))
    router.put('/api/admin/settings', guard(async (request) => {
        return Response.json(await admin.updateSettings(request.json()))
    }))

    router.post('/api/admin/settings/password', guard(async (request) => {
        const body = request.json()
        const current = body && typeof body === 'object' && typeof body.current_password === 'string'
            ? body.current_password
            : ''
        const next = body && typeof body === 'object' && typeof body.new_password === 'string'
            ? body.new_password
            : ''

        if (current === '' || next === '') {
            throw validationError('请填写当前密码与新密码')
        }

        auth.changePassword(current, next)

        return Response.json({ ok: true })
    }))

    // API Key
    router.get('/api/admin/keys', guard(async () => Response.json({ items: apiKeys.list() })))

    router.post('/api/admin/keys', guard(async (request) => {
        const body = request.json()
        const name = body && typeof body === 'object' ? body.name : null

        return Response.json(apiKeys.create(name))
    }))

    router.post('/api/admin/keys/{id}/reset', guard(async (request) => {
        return Response.json(apiKeys.reset(Number.parseInt(request.routeParam('id'), 10) || 0))
    }))

    router.delete('/api/admin/keys/{id}', guard(async (request) => {
        apiKeys.delete(Number.parseInt(request.routeParam('id'), 10) || 0)

        return Response.json({ ok: true })
    }))

    // 健康检查（供容器/负载均衡/宝塔探活使用）
    router.get('/healthz', async () => {
        // 触发一次数据库查询，确认存储可用
        const links = urls.countAll()

        return Response.json({ ok: true, links })
    })

    // 短码跳转（单段兜底，必须最后注册）
    router.get('/{code}', async (request) => {
        const code = request.routeParam('code')
        const originUrl = await shortUrls.resolve(code)

        // HEAD 是预检请求不计入统计；采集失败只记日志，绝不阻塞跳转
        if (request.method !== 'HEAD') {
            try {
                clicks.track(request, code)
            } catch (error) {
                logger.error('click tracking failed', {
                    exception: error?.name ?? 'Error',
                    message: String(error?.message ?? ''),
                })
            }
        }

        // 短链只负责跳转，不应被搜索引擎当作独立页面收录（避免与目标页重复）
        const response = Response.redirect(originUrl)
        response.headers['x-robots-tag'] = 'noindex, nofollow'

        return response
    })

    // ---------------------------------------------------------------- 请求入口

    /**
     * 后台 SPA 入口页面：与首页共用 index.html，注入标记让前端挂载 AdminApp。
     * 自定义安全入口在请求时判定，改设置后无需重启。
     */
    function adminIndexResponse() {
        const path = config.app.distIndex
        if (!existsSync(path)) {
            return Response.text('Frontend build not found. Run "npm run build" first.', 404)
        }
        let html = ''
        try {
            html = readFileSync(path, 'utf8')
        } catch {
            return Response.text('Frontend build not found. Run "npm run build" first.', 404)
        }
        if (html === '') {
            return Response.text('Frontend build not found. Run "npm run build" first.', 404)
        }

        // 后台不参与搜索收录：静态 index.html 是给首页用的，
        // 这里在返回前换成 noindex，并同时下发响应头（爬虫优先看头部）
        html = html.replace(
            /<meta\s+name=["']robots["'][^>]*>/i,
            '<meta name="robots" content="noindex, nofollow">',
        )
        if (!html.includes('name="devr-app"')) {
            const marker = '<meta name="devr-app" content="admin">'
            html = /<\/head>/i.test(html)
                ? html.replace(/<\/head>/i, `${marker}</head>`)
                : marker + html
        }

        const response = Response.html(html)
        response.headers['x-robots-tag'] = 'noindex, nofollow'

        return response
    }

    /**
     * 路径末尾斜杠归一（根路径除外），用于安全入口比较。
     *
     * @param {string} path
     */
    function trimTrailingSlash(path) {
        return path.length > 1 ? path.replace(/\/+$/, '') : path
    }

    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    async function handleRequest(request) {
        let response
        try {
            if (config.app.maxBodyBytes > 0 && Buffer.byteLength(request.rawBody, 'utf8') > config.app.maxBodyBytes) {
                throw payloadTooLarge('Request body exceeds limit')
            }

            csrf.assertSafe(request)

            const staticResponse = serveStatic(request, config.app.distDir)
            if (staticResponse !== null) {
                response = staticResponse
            } else {
                const adminPath = settings.adminPath()
                const requestPath = trimTrailingSlash(request.path)
                if (requestPath === adminPath) {
                    // 后台入口只响应页面读取；写方法交给 405，避免被短码兜底吞掉
                    response = request.method === 'GET' || request.method === 'HEAD'
                        ? adminIndexResponse()
                        : Response.json({ error: 'Method Not Allowed' }, 405, { allow: 'GET, HEAD' })
                } else if (requestPath === '/admin' && adminPath !== '/admin') {
                    // 已启用自定义入口：默认路径彻底消失，不暴露入口在哪
                    response = Response.json({ error: 'Not Found' }, 404)
                } else {
                    response = await router.dispatch(request)
                }
            }
        } catch (error) {
            response = renderError(error)
        }

        return SecurityHeaders.apply(
            response,
            {
                scriptExtra: config.security.cspScriptExtra,
                connectExtra: config.security.cspConnectExtra,
                hstsMaxAge: config.security.hstsMaxAge,
            },
            request.isSecure(),
        )
    }

    /**
     * 统一异常出口：5xx 记 error，4xx 记 info；APP_DEBUG 回显真实消息。
     *
     * @param {unknown} error
     */
    function renderError(error) {
        const appError = error instanceof AppError
            ? error
            : new AppError(500, 'Internal Server Error', true, String(error?.message ?? ''))

        if (appError.serverError) {
            logger.error('request failed', {
                exception: error?.name ?? 'Error',
                message: String(appError.message ?? ''),
            })
        } else {
            logger.info('request rejected', {
                exception: error?.name ?? 'Error',
                message: String(appError.message ?? ''),
            })
        }

        const debug = config.app.debug === true
        const message = debug && appError.message ? appError.message : appError.publicMessage

        return Response.json({ error: message }, appError.status)
    }

    return {
        handleRequest,
        services: { settings, auth, admin, health, cache, shortUrls, apiKeys, probe, logger, meta: metaStore },
        router,
        close: () => database.close?.(),
    }
}
