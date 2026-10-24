/**
 * 管理后台安全入口：默认 /admin，可改为单个路径段（如 /jHSvUeqq）。
 *
 * 只允许字母、数字、下划线、连字符，避免与静态资源、API、短码路由混淆。
 */
export const DEFAULT_ADMIN_PATH = '/admin'

const PATH_PATTERN = /^\/[A-Za-z0-9_-]{3,32}$/

/** 这些路径有专门用途，不能作为后台入口（大小写不敏感，保守处理） */
const RESERVED_PATHS = new Set([
    '/api',
    '/assets',
    '/healthz',
    '/url',
    '/index.html',
    '/admin',
])

/**
 * 补前导斜杠、去掉末尾斜杠；空值返回 ''。
 *
 * @param {unknown} raw
 */
export function normalizeAdminPath(raw) {
    let value = String(raw ?? '').trim()
    if (value === '') {
        return ''
    }
    if (!value.startsWith('/')) {
        value = `/${value}`
    }
    value = value.replace(/\/+$/, '')

    return value === '' ? '/' : value
}

/**
 * 校验并规范化入口路径。
 *
 * @param {unknown} raw
 * @returns {{valid: boolean, value: string, error: string|null}}
 */
export function validateAdminPath(raw) {
    const value = normalizeAdminPath(raw)
    if (value === '') {
        return { valid: false, value, error: '安全入口不能为空' }
    }
    if (!PATH_PATTERN.test(value)) {
        return { valid: false, value, error: '安全入口需为 3-32 位字母、数字、下划线或连字符（以 / 开头）' }
    }
    // /admin 是默认入口，允许用它恢复默认；其余保留路径一律拒绝
    if (value !== DEFAULT_ADMIN_PATH && RESERVED_PATHS.has(value.toLowerCase())) {
        return { valid: false, value, error: '该路径为系统保留，请换一个' }
    }

    return { valid: true, value, error: null }
}
