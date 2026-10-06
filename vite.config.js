import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发模式：Vue 前端跑在 3000，API 请求代理到 PHP 后端 3001
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
        },
    },
})
