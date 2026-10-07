import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发模式：Vue 前端跑在 3000，API 与短码跳转请求代理到 PHP 后端 3001
export default defineConfig({
    plugins: [vue()],
    server: {
        port: 3000,
        proxy: {
            // changeOrigin:false 保留浏览器原始 Host 头（localhost:3000）：
            // 后端 CSRF 以 Host 头为同源基准（见 backend/app/Security/CsrfGuard.php），
            // Vite 6 默认改写 Host 为代理目标，会导致开发环境所有写请求 403
            '/url': { target: 'http://127.0.0.1:3001', changeOrigin: false },
            // 覆盖 /api/url、/api/auth/*、/api/admin/* 全部规范化接口
            '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
            // /admin 由后端返回 SPA（含 dist_index 解析），需代理而非前端 dev 直出
            '/admin': { target: 'http://127.0.0.1:3001', changeOrigin: false },
            // 短码跳转 GET /{code}：不代理的话本地点击只会命中前端 404，
            // 既跳不到目标地址，也不会记录点击统计
            '^/[0-9A-Za-z]{1,32}$': { target: 'http://127.0.0.1:3001', changeOrigin: false },
        },
    },
})
