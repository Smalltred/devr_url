/**
 * 配置定义：全项目唯一读取环境变量的地方。
 * 键名与默认值沿用 PHP 版本，保证 .env / docker-compose / 部署文档无需改动。
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, envBool, envInt, envList } from './support/env.js'

const here = dirname(fileURLToPath(import.meta.url))
export const backendRoot = resolve(here, '..')
export const projectRoot = resolve(backendRoot, '..')

/**
 * `/admin` 返回的 SPA 入口：优先 DIST_INDEX，其次项目根 dist/（仓库布局），
 * 再试项目根 public/（宝塔部署包布局），最后 backend/public/。
 */
function resolveDistIndex() {
    const configured = env('DIST_INDEX')
    if (configured) {
        return configured
    }

    const built = join(projectRoot, 'dist', 'index.html')
    if (existsSync(built)) {
        return built
    }

    // 部署包布局：解压后前端位于 <包根>/public/
    const packaged = join(projectRoot, 'public', 'index.html')
    if (existsSync(packaged)) {
        return packaged
    }

    return join(backendRoot, 'public', 'index.html')
}

/**
 * @returns {object} 配置对象（与 PHP config.php 结构一致）
 */
export function loadConfig() {
    return {
        app: {
            env: env('APP_ENV', 'production'),
            debug: envBool('APP_DEBUG', false),
            url: env('APP_URL', ''),
            port: envInt('APP_PORT', 3001),
            distIndex: resolveDistIndex(),
            distDir: dirname(resolveDistIndex()),
            maxBodyBytes: envInt('MAX_BODY_BYTES', 16384),
        },
        security: {
            allowedOrigins: envList('ALLOWED_ORIGINS'),
            csrfAllowMissingOrigin: envBool('CSRF_ALLOW_MISSING_ORIGIN', false),
            ipHashSecret: env('IP_HASH_SECRET', ''),
            // 默认信任来自回环/私网的反向代理头（X-Real-IP / X-Forwarded-For），
            // 用于限流与「创建者真实 IP」；直连公网来源不受影响。
            trustProxy: envBool('TRUST_PROXY', true),
            cspScriptExtra: envList('CSP_SCRIPT_EXTRA').length > 0
                ? envList('CSP_SCRIPT_EXTRA')
                : ['https://www.googletagmanager.com'],
            cspConnectExtra: envList('CSP_CONNECT_EXTRA'),
            hstsMaxAge: envInt('HSTS_MAX_AGE', 0),
        },
        ratelimit: {
            createMax: envInt('CREATE_RATE_LIMIT_MAX', 60),
            createWindowSeconds: envInt('CREATE_RATE_LIMIT_WINDOW', 60),
        },
        privacy: {
            storeFullReferer: envBool('PRIVACY_STORE_REFERER', false),
        },
        database: {
            path: env('DATABASE_PATH', join(backendRoot, 'storage', 'short-url.sqlite3')),
        },
        cache: {
            driver: env('CACHE_DRIVER', 'memcached'),
            servers: envList('MEMCACHED_SERVERS').length > 0
                ? envList('MEMCACHED_SERVERS')
                : ['127.0.0.1:11211'],
            ttl: envInt('CACHE_TTL', 300),
            negativeTtl: envInt('CACHE_NEGATIVE_TTL', 30),
            timeoutMs: envInt('MEMCACHED_TIMEOUT_MS', 200),
        },
        health: {
            timeoutSeconds: envInt('HEALTH_TIMEOUT_SECONDS', 8),
            connectTimeoutSeconds: envInt('HEALTH_CONNECT_TIMEOUT_SECONDS', 5),
            staleHours: envInt('HEALTH_STALE_HOURS', 24),
            batchSize: envInt('HEALTH_BATCH_SIZE', 20),
            // 每日定时巡检（进程内调度，无需外部 cron）；时刻与阈值可在后台「设置」页覆盖
            scanEnabled: envBool('HEALTH_SCAN_ENABLED', true),
            scanHour: envInt('HEALTH_SCAN_HOUR', 12),
            scanMinute: envInt('HEALTH_SCAN_MINUTE', 0),
            // 连续失败达到该次数判定为失效
            deadThreshold: envInt('HEALTH_DEAD_THRESHOLD', 3),
        },
        auth: {
            username: env('ADMIN_USERNAME', 'admin'),
            password: env('ADMIN_PASSWORD', 'admin123'),
            passwordHash: env('ADMIN_PASSWORD_HASH', ''),
            tokenTtlDays: envInt('ADMIN_TOKEN_TTL_DAYS', 7),
        },
        logging: {
            path: join(backendRoot, 'storage', 'logs'),
        },
    }
}
