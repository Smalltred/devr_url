/**
 * 极简 .env 加载器：KEY=VALUE，支持引号与注释行。
 *
 * 优先级：真实环境变量 > 先加载的 .env > 后加载的 .env。
 * 空字符串一律视为“未设置”，与旧 PHP 实现保持一致（.env 中留空 = 用默认值）。
 */
import { existsSync, readFileSync } from 'node:fs'

/** @type {Map<string, string>} */
const loaded = new Map()

/**
 * 按顺序加载 .env 文件；文件不存在时静默跳过。
 *
 * @param {...string} paths
 */
export function loadEnv(...paths) {
    for (const path of paths) {
        if (!path || !existsSync(path)) {
            continue
        }

        let content = ''
        try {
            content = readFileSync(path, 'utf8')
        } catch {
            continue
        }

        for (const rawLine of content.split(/\r?\n/)) {
            const line = rawLine.trim()
            if (line === '' || line.startsWith('#')) {
                continue
            }

            const separator = line.indexOf('=')
            if (separator <= 0) {
                continue
            }

            const key = line.slice(0, separator).trim()
            let value = line.slice(separator + 1).trim()
            if (
                value.length >= 2
                && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
            ) {
                value = value.slice(1, -1)
            }

            if (key === '' || process.env[key] !== undefined || loaded.has(key)) {
                continue
            }
            loaded.set(key, value)
        }
    }
}

/**
 * 读取环境变量：真实环境变量 → 已加载 .env → 默认值。
 *
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string|undefined}
 */
export function env(key, fallback) {
    const fromProcess = process.env[key]
    if (typeof fromProcess === 'string' && fromProcess !== '') {
        return fromProcess
    }

    const fromFile = loaded.get(key)
    if (typeof fromFile === 'string' && fromFile !== '') {
        return fromFile
    }

    return fallback
}

/**
 * 布尔解析：仅 1/true/on/yes（大小写不敏感）为 true。
 *
 * @param {string} key
 * @param {boolean} fallback
 */
export function envBool(key, fallback = false) {
    const value = env(key)
    if (value === undefined) {
        return fallback
    }

    return ['1', 'true', 'on', 'yes'].includes(value.toLowerCase())
}

/**
 * 整数解析：仅纯数字（不含负号）才生效，否则用默认值。
 *
 * @param {string} key
 * @param {number} fallback
 */
export function envInt(key, fallback) {
    const value = env(key)
    if (value === undefined || !/^\d+$/.test(value)) {
        return fallback
    }

    return Number.parseInt(value, 10)
}

/**
 * 逗号分隔列表：去空白、丢弃空项。
 *
 * @param {string} key
 * @returns {string[]}
 */
export function envList(key) {
    const value = env(key)
    if (value === undefined) {
        return []
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
}
