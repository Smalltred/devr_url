import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// Vite 默认从「进程 cwd」（项目根目录）查找 postcss.config.js / tailwind.config.js，
// 会命中旧前端的配置。这里全部锁定到 apple-frontend/ 下的文件。
const postcssConfig = fileURLToPath(new URL('./postcss.config.js', import.meta.url))

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const frontendRoot = fileURLToPath(new URL('.', import.meta.url))

/**
 * 站点对外地址（用于 canonical / Open Graph / sitemap 的绝对地址）。
 *
 * 只接受 https：微信、QQ 等抓取器要求分享图与页面使用绝对 HTTPS 地址。
 * 通过 VITE_SITE_URL 显式配置；未配置时若 .env 的 APP_URL 是 https 则沿用，
 * 否则回退到正式域名 https://devr.cn。
 */
function normalizeSiteUrl(raw) {
    if (!raw) return ''

    try {
        const url = new URL(raw)

        return url.protocol === 'https:' ? url.origin : ''
    } catch {
        return ''
    }
}

function seoPlugin(siteUrl) {
    let isBuild = true

    return {
        name: 'devr-seo',
        configResolved(config) {
            isBuild = config.command === 'build'
        },
        // 构建期写入正式域名；开发期用本地地址，避免出现未替换的占位符
        transformIndexHtml(html) {
            return html.replaceAll('%SITE_URL%', isBuild ? siteUrl : 'http://localhost:3000')
        },
        generateBundle() {
            const lastmod = new Date().toISOString().slice(0, 10)
            const robots = [
                'User-agent: *',
                'Allow: /',
                'Disallow: /admin',
                'Disallow: /api/',
                'Disallow: /healthz',
                '',
                `Sitemap: ${siteUrl}/sitemap.xml`,
                '',
            ].join('\n')
            const sitemap = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                '    <url>',
                `        <loc>${siteUrl}/</loc>`,
                `        <lastmod>${lastmod}</lastmod>`,
                '        <changefreq>weekly</changefreq>',
                '        <priority>1.0</priority>',
                '    </url>',
                '</urlset>',
                '',
            ].join('\n')

            this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
            this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
        },
    }
}

export default defineConfig(({ mode }) => {
    const env = {
        ...loadEnv(mode, projectRoot, ''),
        ...loadEnv(mode, frontendRoot, ''),
    }
    const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL)
        || normalizeSiteUrl(env.APP_URL)
        || 'https://devr.cn'

    // 默认前端：Vue 跑在 3000，API 与短码跳转代理到 Node 后端 3001。
    // 构建产物输出到项目根 dist/（后端与部署脚本都从那里读取）。
    return {
        root: frontendRoot,
        css: {
            postcss: postcssConfig,
        },
        plugins: [vue(), seoPlugin(siteUrl)],
        server: {
            port: 3000,
            proxy: {
                // changeOrigin:false 保留浏览器原始 Host 头（localhost:3000）：
                // 后端 CSRF 以 Host 头为同源基准（backend/app/Security/CsrfGuard.php），
                // Vite 6 默认改写 Host 为代理目标，会导致开发环境所有写请求 403
                '/url': { target: 'http://127.0.0.1:3001', changeOrigin: false },
                // 覆盖 /api/url、/api/auth/*、/api/admin/* 全部规范化接口
                '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
                // 短码跳转 GET /{code}：不代理的话本地点击只会命中前端 404，
                // 既跳不到目标地址，也不会记录点击统计。
                // 以 ^ 开头的字符串键会被 Vite 当作正则（见 doesProxyContextMatchUrl），
                // 因此这里用正则形式；显式排除 /admin —— 它同样匹配该模式
                //（"admin" 全为字母），但需由 dev server 直出以保留 HMR，
                // 生产环境则由后端返回 dist/index.html。
                '^/(?!admin$|admin/)[0-9A-Za-z]{1,32}$': {
                    target: 'http://127.0.0.1:3001',
                    changeOrigin: false,
                },
            },
        },
        build: {
            // 后端 dist_index 与部署脚本（Dockerfile / build-baota-package.php / nginx）
            // 都读取项目根的 dist/
            outDir: fileURLToPath(new URL('../dist', import.meta.url)),
            emptyOutDir: true,
        },
    }
})
