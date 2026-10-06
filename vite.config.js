import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发模式：Vue 前端跑在 3000，API 请求代理到 PHP 后端 3001
export default defineConfig({
    plugins: [vue()],
    server: {
        port: 3000,
        proxy: {
            '/url': 'http://127.0.0.1:3001',
            // 覆盖 /api/url、/api/auth/*、/api/admin/* 全部规范化接口
            '/api': 'http://127.0.0.1:3001',
        },
    },
})
