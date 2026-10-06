<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../services/entity'
import AdminLogin from '../components/admin/AdminLogin.vue'
import AdminSettings from '../components/admin/AdminSettings.vue'
import EditLinkModal from '../components/admin/EditLinkModal.vue'
import LinkStatsModal from '../components/admin/LinkStatsModal.vue'
import StatBars from '../components/admin/StatBars.vue'

// checking → login | ready
const authState = ref('checking')

// links | settings
const tab = ref('links')

const overview = ref(null)
const items = ref([])
const total = ref(0)
const page = ref(1)
const perPage = ref(20)
const keyword = ref('')
const appliedKeyword = ref('')
const loading = ref(false)
const notice = ref('')

const editing = ref(null)
const statsCode = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))

onMounted(async () => {
    try {
        const state = await api.me()
        authState.value = state.authenticated ? 'ready' : 'login'
    } catch {
        authState.value = 'login'
    }
    if (authState.value === 'ready') {
        await refresh()
    }
})

function onPasswordChanged() {
    // 服务端已撤销全部登录态，切回登录视图
    authState.value = 'login'
}

async function onLoggedIn() {
    authState.value = 'ready'
    await refresh()
}

async function onLoggedOut() {
    try {
        await api.logout()
    } finally {
        authState.value = 'login'
        overview.value = null
    }
}

async function refresh() {
    loading.value = true
    try {
        const [ov, list] = await Promise.all([
            api.fetchOverview(),
            api.fetchLinks({ page: page.value, per_page: perPage.value, q: appliedKeyword.value }),
        ])
        overview.value = ov
        items.value = list.items
        total.value = list.total
        page.value = list.page
        totalPagesMaxGuard()
    } catch (err) {
        if (err.isAuthError) {
            authState.value = 'login'
            return
        }
        showNotice(err.response?.data?.error || err.message || '加载失败')
    } finally {
        loading.value = false
    }
}

function totalPagesMaxGuard() {
    // 删除/搜索后页码可能越界，回退到最后一页重新拉取
    if (page.value > totalPages.value && totalPages.value > 0) {
        page.value = totalPages.value
        refresh()
    }
}

function search() {
    page.value = 1
    appliedKeyword.value = keyword.value.trim()
    refresh()
}

function goPage(target) {
    if (target < 1 || target > totalPages.value || target === page.value) {
        return
    }
    page.value = target
    refresh()
}

function shortUrlOf(code) {
    return `${window.location.origin}/${code}`
}

function formatTime(value) {
    return typeof value === 'string' ? value.replace('T', ' ').slice(0, 16) : ''
}

async function removeLink(item) {
    if (!window.confirm(`确定删除短链 /${item.code} ？删除后立即失效，点击记录一并清除。`)) {
        return
    }
    try {
        await api.deleteLink(item.code)
        showNotice(`已删除 /${item.code}`)
        await refresh()
    } catch (err) {
        showNotice(err.response?.data?.error || err.message || '删除失败')
    }
}

function openStats(item) {
    statsCode.value = item.code
}

function showNotice(message) {
    notice.value = message
    window.setTimeout(() => {
        notice.value = ''
    }, 3000)
}
</script>

<template>
    <div class="container mx-auto px-6 font-mono">
        <AdminLogin v-if="authState === 'login'" @logged-in="onLoggedIn" />

        <p v-else-if="authState === 'checking'" class="pt-40 text-center text-lg text-black/50">正在验证登录态…</p>

        <div v-else class="py-10">
            <!-- 顶栏 -->
            <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
                <h1 class="text-3xl font-bold">devr · 管理后台</h1>
                <div class="flex items-center gap-4 text-sm">
                    <a href="/" class="text-black/60 hover:text-black">← 返回首页</a>
                    <button
                        type="button"
                        class="rounded-lg border-2 border-black px-3 py-1 font-bold hover:bg-black/5"
                        @click="onLoggedOut"
                    >
                        退出登录
                    </button>
                </div>
            </div>

            <!-- 选项卡 -->
            <div class="mb-6 flex gap-2 font-bold">
                <button
                    type="button"
                    class="rounded-lg px-4 py-2"
                    :class="tab === 'links' ? 'bg-black text-yellow-100 border-r-4 border-b-4 border-yellow-500' : 'border-2 border-black hover:bg-black/5'"
                    @click="tab = 'links'"
                >
                    短链管理
                </button>
                <button
                    type="button"
                    class="rounded-lg px-4 py-2"
                    :class="tab === 'settings' ? 'bg-black text-yellow-100 border-r-4 border-b-4 border-yellow-500' : 'border-2 border-black hover:bg-black/5'"
                    @click="tab = 'settings'"
                >
                    设置
                </button>
            </div>

            <AdminSettings v-if="tab === 'settings'" @password-changed="onPasswordChanged" @notice="showNotice" />

            <template v-if="tab === 'links'">
            <!-- 概览卡片 -->
            <div v-if="overview" class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="rounded-xl border-4 border-black bg-white p-5 shadow-[6px_6px_0_0_rgba(0,0,0,1)]">
                    <div class="text-3xl font-bold">{{ overview.links }}</div>
                    <div class="mt-1 text-sm text-black/50">短链总数</div>
                </div>
                <div class="rounded-xl border-4 border-black bg-white p-5 shadow-[6px_6px_0_0_rgba(0,0,0,1)]">
                    <div class="text-3xl font-bold">{{ overview.total_clicks }}</div>
                    <div class="mt-1 text-sm text-black/50">累计点击</div>
                </div>
                <div class="rounded-xl border-4 border-black bg-white p-5 shadow-[6px_6px_0_0_rgba(0,0,0,1)]">
                    <div class="text-3xl font-bold">{{ overview.clicks_today }}</div>
                    <div class="mt-1 text-sm text-black/50">今日点击</div>
                </div>
            </div>

            <!-- 全站趋势 + Top10 -->
            <div v-if="overview" class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div class="rounded-xl border-4 border-black bg-white p-5 lg:col-span-2">
                    <h2 class="mb-4 font-bold">全站近 14 天点击趋势（UTC 日切）</h2>
                    <StatBars :series="overview.daily" />
                </div>
                <div class="rounded-xl border-4 border-black bg-white p-5">
                    <h2 class="mb-4 font-bold">点击 Top 10</h2>
                    <p v-if="overview.top_links.length === 0" class="text-sm text-black/40">暂无点击数据</p>
                    <ul v-else class="space-y-1 text-sm">
                        <li
                            v-for="(top, index) in overview.top_links"
                            :key="top.code"
                            class="flex items-center gap-2 border-b border-black/10 pb-1"
                        >
                            <span class="w-5 text-black/40">{{ index + 1 }}.</span>
                            <a
                                :href="shortUrlOf(top.code)"
                                target="_blank"
                                rel="noopener"
                                class="truncate font-bold hover:underline"
                                :title="top.url"
                            >/{{ top.code }}</a>
                            <span class="ml-auto shrink-0">{{ top.clicks }}</span>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- 搜索与列表 -->
            <div class="rounded-xl border-4 border-black bg-white p-5">
                <form class="mb-4 flex flex-wrap gap-3" @submit.prevent="search">
                    <input
                        v-model="keyword"
                        type="text"
                        placeholder="搜索短码或目标链接…"
                        class="min-w-0 flex-1 rounded-lg border-2 border-black bg-yellow-100/60 px-3 py-2 outline-none focus:bg-yellow-100"
                    />
                    <button
                        type="submit"
                        class="rounded-lg bg-black px-4 py-2 font-bold text-yellow-100 border-r-4 border-b-4 border-yellow-500"
                    >
                        搜索
                    </button>
                    <button
                        type="button"
                        class="rounded-lg border-2 border-black px-4 py-2 font-bold hover:bg-black/5"
                        @click="refresh"
                    >
                        刷新
                    </button>
                </form>

                <div class="overflow-x-auto">
                    <table class="w-full min-w-[720px] text-left text-sm">
                        <thead>
                            <tr class="border-b-2 border-black text-black/60">
                                <th class="py-2 pr-3">短链接</th>
                                <th class="py-2 pr-3">目标链接</th>
                                <th class="py-2 pr-3">创建时间</th>
                                <th class="py-2 pr-3 text-right">今日</th>
                                <th class="py-2 pr-3 text-right">总点击</th>
                                <th class="py-2 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="items.length === 0">
                                <td colspan="6" class="py-8 text-center text-black/40">
                                    {{ loading ? '加载中…' : '没有匹配的短链' }}
                                </td>
                            </tr>
                            <tr v-for="item in items" :key="item.code" class="border-b border-black/10 align-top">
                                <td class="py-3 pr-3">
                                    <a
                                        :href="shortUrlOf(item.code)"
                                        target="_blank"
                                        rel="noopener"
                                        class="font-bold hover:underline"
                                    >/{{ item.code }}</a>
                                </td>
                                <td class="max-w-[280px] py-3 pr-3">
                                    <a
                                        :href="item.url"
                                        target="_blank"
                                        rel="noopener"
                                        class="block truncate text-black/70 hover:underline"
                                        :title="item.url"
                                    >{{ item.url }}</a>
                                </td>
                                <td class="whitespace-nowrap py-3 pr-3 text-black/50">{{ formatTime(item.created_at) }}</td>
                                <td class="py-3 pr-3 text-right">{{ item.clicks_today }}</td>
                                <td class="py-3 pr-3 text-right font-bold">{{ item.clicks }}</td>
                                <td class="whitespace-nowrap py-3 text-right">
                                    <button type="button" class="hover:underline" @click="openStats(item)">统计</button>
                                    <span class="px-1 text-black/30">|</span>
                                    <button type="button" class="hover:underline" @click="editing = item">编辑</button>
                                    <span class="px-1 text-black/30">|</span>
                                    <button type="button" class="text-red-600 hover:underline" @click="removeLink(item)">删除</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- 分页 -->
                <div class="mt-4 flex items-center justify-between text-sm">
                    <span class="text-black/50">共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
                    <div class="flex gap-2">
                        <button
                            type="button"
                            class="rounded-lg border-2 border-black px-3 py-1 font-bold disabled:opacity-30"
                            :disabled="page <= 1"
                            @click="goPage(page - 1)"
                        >
                            上一页
                        </button>
                        <button
                            type="button"
                            class="rounded-lg border-2 border-black px-3 py-1 font-bold disabled:opacity-30"
                            :disabled="page >= totalPages"
                            @click="goPage(page + 1)"
                        >
                            下一页
                        </button>
                    </div>
                </div>
            </div>
            </template>

            <!-- 弹窗 -->
            <EditLinkModal
                v-if="editing"
                :link="editing"
                @close="editing = null"
                @saved="editing = null; showNotice('已保存'); refresh()"
            />
            <LinkStatsModal v-if="statsCode" :code="statsCode" @close="statsCode = ''" />

            <!-- 轻提示 -->
            <transition name="fade">
                <div
                    v-if="notice"
                    class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border-2 border-black bg-black px-4 py-2 text-sm font-bold text-yellow-100"
                >
                    {{ notice }}
                </div>
            </transition>
        </div>
    </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
