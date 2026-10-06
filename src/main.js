import { createApp } from 'vue'
import App from './App.vue'
import AdminPage from './views/AdminPage.vue'
import './index.css'

// /admin 为管理面板入口：后端对该路径返回同一份 dist/index.html，前端按路径分发渲染
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')

createApp(isAdmin ? AdminPage : App).mount('#app')
