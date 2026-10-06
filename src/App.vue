<script setup>
import { onMounted } from 'vue'
import Header from './components/Header.vue'
import Search from './components/Search.vue'
import Result from './components/Result.vue'
import api from './services/entity'

// 站点开启“创建短链需要登录”时，未登录访问首页直接跳转管理面板登录
onMounted(async () => {
    try {
        const state = await api.me()
        if (state.require_login && !state.authenticated) {
            window.location.href = '/admin'
        }
    } catch {
        // 会话查询失败不阻断首页
    }
})
</script>

<template>
    <div class="container mx-auto px-12">
        <div class="min-h-screen">
            <Header />
            <div>
                <Search />
                <Result />
            </div>
        </div>
        <footer class="pb-8 text-center font-mono text-sm">
            <a href="/admin" class="text-black/40 hover:text-black">管理后台</a>
        </footer>
    </div>
</template>
