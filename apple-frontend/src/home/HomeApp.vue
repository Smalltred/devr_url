<script setup>
/**
 * 首页根组件。
 *
 * 站点开启「创建短链需要登录」且当前未登录时，跳转管理后台登录页
 * （与旧前端行为一致）。
 */
import { onMounted, ref } from 'vue'
import HomeHeader from './HomeHeader.vue'
import HomeSearch from './HomeSearch.vue'
import HomeResult from './HomeResult.vue'
import api from '../services/entity.js'

// 默认隐藏后台入口：只有确认已登录后才显示
const authenticated = ref(false)
// 已登录时后端返回当前安全入口；未登录时不下发，避免泄露
const adminPath = ref('/admin')
// 自定义安全入口 + 关闭游客访问：首页不再跳转 /admin（那会泄露或 404），改为提示
const privateAccess = ref(false)

onMounted(async () => {
    try {
        const state = await api.me()
        authenticated.value = Boolean(state.authenticated)
        adminPath.value = typeof state.admin_path === 'string' ? state.admin_path : '/admin'
        if (state.require_login && !state.authenticated) {
            if (state.admin_entry_custom) {
                privateAccess.value = true
            } else {
                window.location.href = '/admin'
            }
        }
    } catch {
        // 会话查询失败不阻断首页
    }
})
</script>

<template>
    <div class="mx-auto flex min-h-screen max-w-3xl flex-col px-5 sm:px-8">
        <HomeHeader :admin-href="authenticated ? adminPath : ''" />
        <main class="flex-1">
            <div v-if="privateAccess" class="material-regular card mt-16 px-6 py-12 text-center">
                <p class="type-lg font-medium">本站未对游客开放</p>
                <p class="type-sm mt-2 text-ink-3">请使用管理员提供的安全入口访问后台。</p>
            </div>
            <template v-else>
                <HomeSearch />
                <HomeResult />
            </template>
        </main>
        <footer class="type-xs pb-6 pt-10 text-center text-ink-3">
            Devr 提供免费短链接生成、自定义短码、二维码下载。
        </footer>
    </div>
</template>
