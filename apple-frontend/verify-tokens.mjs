// 令牌保真断言：逐值比对旧前端 src/index.css 与新前端 tokens.css 的配色令牌。
// 配色必须完全相等；字号允许 px → rem（16px 基准，为支持用户字号缩放），但数值必须等价。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const OLD = join(here, '..', 'src', 'index.css')
const NEW = join(here, 'src', 'styles', 'tokens.css')

/** 从一个 CSS 文本中提取某个选择器块里的自定义属性 */
function parseBlock(css, selector) {
    const idx = css.indexOf(selector)
    if (idx === -1) throw new Error(`找不到选择器块: ${selector}`)
    const start = css.indexOf('{', idx)
    const end = css.indexOf('}', start)
    const body = css.slice(start + 1, end)
    const out = {}
    for (const line of body.split('\n')) {
        // 先剥离行尾块注释，避免 `--x: 1; /* 说明 */` 解析失败
        const cleaned = line.replace(/\/\*.*?\*\//g, '')
        const m = cleaned.match(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/)
        if (m) out[m[1]] = m[2].trim()
    }
    return out
}

const oldCss = readFileSync(OLD, 'utf8')
const newCss = readFileSync(NEW, 'utf8')

const oldLight = parseBlock(oldCss, ':root {')
const newLight = parseBlock(newCss, ':root {')
const oldDark = parseBlock(oldCss, '[data-theme="dark"] {')
const newDark = parseBlock(newCss, '[data-theme="dark"] {')

// 需要逐值严格相等的令牌（配色、材质、阴影、圆角、间距、动效曲线）
const STRICT = [
    '--color-bg', '--color-bg-elevated', '--color-surface', '--color-surface-solid',
    '--color-surface-hover', '--color-text', '--color-text-secondary',
    '--color-text-tertiary', '--color-text-disabled',
    '--color-accent', '--color-accent-hover', '--color-accent-soft',
    '--color-success', '--color-success-soft', '--color-warning',
    '--color-danger', '--color-danger-soft',
    '--glass-bg', '--glass-strong-bg', '--glass-ctl-bg',
    '--glass-border', '--glass-border-soft', '--glass-blur', '--glass-blur-strong',
    '--shadow-sm', '--shadow-md', '--shadow-lg',
    '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg',
    '--radius-xl', '--radius-2xl', '--radius-pill',
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
    '--space-7', '--space-8', '--space-10', '--space-12', '--space-16',
    '--font-sans',
    '--duration-fast', '--duration-normal', '--duration-slow', '--ease',
    '--content-max-width', '--page-padding', '--control-height', '--glow',
]

// 字号：允许 px → rem 转换，数值需等价（16px 基准）
const FONT_SIZES = ['--text-xs', '--text-sm', '--text-md', '--text-base',
    '--text-lg', '--text-xl', '--text-2xl', '--text-3xl']

const fails = []
let checked = 0

/**
 * 比对一组令牌。
 * @param {string} label 报告用标签
 * @param {object} oldVars 旧系统该主题块中显式定义的令牌
 * @param {object} newVars 新系统该主题块中显式定义的令牌
 * @param {boolean} onlyDefined 仅比对旧块中确实定义过的令牌
 *        （深色块只覆盖部分令牌，其余按 CSS 层叠继承 :root，无需重复比对）
 */
function compare(label, oldVars, newVars, onlyDefined = false) {
    for (const token of STRICT) {
        const o = oldVars[token]
        const n = newVars[token]
        if (o === undefined) {
            if (onlyDefined) continue
            continue
        }
        checked++
        if (n === undefined) {
            fails.push(`${label} ${token}: 新系统中缺失（旧值 ${o}）`)
            continue
        }
        if (o !== n) {
            fails.push(`${label} ${token}: 值不一致\n    旧: ${o}\n    新: ${n}`)
        }
    }
}

function compareFontSizes(label, oldVars, newVars) {
    for (const token of FONT_SIZES) {
        const o = oldVars[token]
        const n = newVars[token]
        if (o === undefined) continue
        checked++
        if (n === undefined) {
            fails.push(`${label} ${token}: 新系统中缺失（旧值 ${o}）`)
            continue
        }
        // px → rem 换算：1rem = 16px
        const oldPx = parseFloat(o)
        let newPx = parseFloat(n)
        if (n.endsWith('rem')) newPx = newPx * 16
        if (Math.abs(oldPx - newPx) > 0.001) {
            fails.push(`${label} ${token}: 字号数值不等价\n    旧: ${o}\n    新: ${n} (=${newPx}px)`)
        }
    }
}

compare('亮色', oldLight, newLight)
// 深色块只覆盖部分令牌，其余按 CSS 层叠继承 :root —— 只比对它显式定义的那些
compare('深色', oldDark, newDark, true)
compareFontSizes('亮色', oldLight, newLight)

// 深色主题的“生效值”比对：深色块显式定义则用之，否则按 CSS 层叠继承 :root。
// 这能捕捉到两类错误：深色少覆盖了某令牌，或错误地覆盖了不该覆盖的令牌。
for (const token of STRICT) {
    const oldEffective = oldDark[token] !== undefined ? oldDark[token] : oldLight[token]
    const newEffective = newDark[token] !== undefined ? newDark[token] : newLight[token]
    if (oldEffective === undefined) continue
    checked++
    if (oldEffective !== newEffective) {
        fails.push(`深色生效值 ${token}: 不一致\n    旧: ${oldEffective}\n    新: ${newEffective}`)
    }
}

// 新增令牌的存在性检查（新设计语言依赖）
const REQUIRED_NEW = [
    '--glass-highlight', '--accent-rgb', '--danger-hover', '--overlay-bg',
    '--overlay-blur', '--switch-track', '--switch-knob', '--color-on-accent',
    '--tracking-3xl', '--tracking-base', '--leading-3xl', '--leading-base',
    '--spring-response-default', '--spring-damping-default', '--duration-fade',
    '--ease-out',
]
for (const token of REQUIRED_NEW) {
    checked++
    if (newLight[token] === undefined) {
        fails.push(`新增令牌 ${token}: 未定义`)
    }
}

console.log(`=== 令牌保真断言 ===`)
console.log(`共比对 ${checked} 项`)

if (fails.length === 0) {
    console.log('配色令牌逐值一致，零差异 ✓')
    console.log(`  亮色令牌 ${Object.keys(newLight).length} 个，深色覆盖 ${Object.keys(newDark).length} 个`)
    process.exit(0)
}

console.log(`\n发现 ${fails.length} 处差异：`)
for (const f of fails) console.log('  · ' + f)
process.exit(1)
