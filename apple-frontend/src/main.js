import { createApp } from 'vue'
import HomeApp from './home/HomeApp.vue'
import AdminApp from './admin/AdminApp.vue'

import './styles/index.css'

// /admin 为管理面板入口：后端对该路径返回同一份 index.html，前端按路径分发渲染。
// （与旧前端相同的挂载机制，未引入 vue-router —— 后端 /{code} 通配会吞掉单段路径，
//   改成 SPA 路由需要同时改后端与部署配置。）
const isAdmin = window.location.pathname === '/admin'
    || window.location.pathname.startsWith('/admin/')

createApp(isAdmin ? AdminApp : HomeApp).mount('#app')
