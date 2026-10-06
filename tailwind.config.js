/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{vue,js}',
    ],
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
