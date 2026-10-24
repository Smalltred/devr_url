import { createApp } from 'vue'
import HomeApp from './home/HomeApp.vue'
import AdminApp from './admin/AdminApp.vue'

import './styles/index.css'

// 管理面板入口由后端决定（默认 /admin，可在设置里改为自定义安全入口）。
// 后端在返回后台页面时注入 <meta name="devr-app" content="admin">，
// 前端据此挂载，避免把自定义入口硬编码到构建产物里。
// 兼容开发模式：Vite 直接返回 index.html（无注入标记）时仍按 /admin 判定。
const isAdmin = document.querySelector('meta[name="devr-app"]')?.content === 'admin'
    || window.location.pathname === '/admin'
    || window.location.pathname.startsWith('/admin/')

createApp(isAdmin ? AdminApp : HomeApp).mount('#app')
