import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// Vite 默认从「进程 cwd」（项目根目录）查找 postcss.config.js / tailwind.config.js，
// 会命中旧前端的配置。这里全部锁定到 apple-frontend/ 下的文件。
const postcssConfig = fileURLToPath(new URL('./postcss.config.js', import.meta.url))

// 独立前端：Vue 跑在 3100，API 请求代理到 PHP 后端 3001。
// 与旧前端可同时运行（旧前端 3000），两者共用同一后端与数据库。
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    css: {
        postcss: postcssConfig,
    },
    plugins: [vue()],
    server: {
        port: 3100,
        proxy: {
            // changeOrigin:false 保留浏览器原始 Host 头（localhost:3100）：
            // 后端 CSRF 以 Host 头为同源基准（backend/app/Security/CsrfGuard.php），
            // 改写 Host 会导致开发环境所有写请求 403
            '/url': { target: 'http://127.0.0.1:3001', changeOrigin: false },
            '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
        },
    },
})
