<script setup>
/**
 * 首页根组件。
 *
 * 站点开启「创建短链需要登录」且当前未登录时，跳转管理后台登录页
 * （与旧前端行为一致）。
 */
import { onMounted } from 'vue'
import HomeHeader from './HomeHeader.vue'
import HomeSearch from './HomeSearch.vue'
import HomeResult from './HomeResult.vue'
import api from '../services/entity.js'

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
    <div class="mx-auto flex min-h-screen max-w-3xl flex-col px-5 sm:px-8">
        <HomeHeader />
        <main class="flex-1">
            <HomeSearch />
            <HomeResult />
        </main>
    </div>
</template>
