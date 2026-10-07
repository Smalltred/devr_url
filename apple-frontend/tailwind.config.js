/** @type {import('tailwindcss').Config} */
export default {
    // relative: true —— 让下面的 glob 相对「本配置文件所在目录」解析。
    // 默认是相对 cwd 解析，而构建时 cwd 是项目根目录，会误扫旧前端的 src/，
    // 导致新前端用到的类被当成未使用而 tree-shake 掉。
    content: {
        relative: true,
        files: [
            './index.html',
            './src/**/*.{vue,js}',
        ],
    },
    theme: {
        extend: {
            // 令牌映射到 Tailwind 色板，组件内用 text-ink-2 / text-accent / border-line 等
            colors: {
                ink: {
                    DEFAULT: 'var(--color-text)',
                    2: 'var(--color-text-secondary)',
                    3: 'var(--color-text-tertiary)',
                },
                accent: {
                    DEFAULT: 'var(--color-accent)',
                    hover: 'var(--color-accent-hover)',
                },
                danger: 'var(--color-danger)',
                success: 'var(--color-success)',
                line: 'var(--glass-border-soft)',
            },
            fontFamily: {
                sans: 'var(--font-sans)',
            },
        },
    },
    plugins: [],
}
