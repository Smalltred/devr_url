<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../services/entity'
import ThemeToggle from '../components/ThemeToggle.vue'
import AdminLogin from '../components/admin/AdminLogin.vue'
import AdminSettings from '../components/admin/AdminSettings.vue'
import ConfirmDialog from '../components/admin/ConfirmDialog.vue'
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
// 待确认删除的短链，非空时显示主题确认弹窗
const pendingDelete = ref(null)

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

function removeLink(item) {
    pendingDelete.value = item
}

async function confirmRemove() {
    const item = pendingDelete.value
    pendingDelete.value = null
    if (!item) {
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
    <div class="mx-auto min-h-screen max-w-6xl px-5 sm:px-8">
        <AdminLogin v-if="authState === 'login'" @logged-in="onLoggedIn" />

        <div v-else-if="authState === 'checking'" class="flex min-h-screen items-center justify-center">
            <div class="glass card animate-pulse text-sm text-ink-2">正在验证登录态…</div>
        </div>

        <div v-else class="py-6 pb-20">
            <!-- 顶栏 -->
            <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
                <h1 class="text-2xl font-semibold tracking-tight">devr · 管理后台</h1>
                <div class="flex items-center gap-2">
                    <ThemeToggle />
                    <a href="/" class="btn btn-ghost btn-sm">← 返回首页</a>
                    <button type="button" class="btn btn-secondary btn-sm" @click="onLoggedOut">退出登录</button>
                </div>
            </div>

            <!-- 选项卡 -->
            <div class="segmented glass-ctl mb-6">
                <button type="button" :class="{ active: tab === 'links' }" @click="tab = 'links'">短链管理</button>
                <button type="button" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button>
            </div>

            <transition name="fade-slide" mode="out-in">
                <AdminSettings
                    v-if="tab === 'settings'"
                    key="settings"
                    @password-changed="onPasswordChanged"
                    @notice="showNotice"
                />

                <div v-else key="links">
                <!-- 概览卡片 -->
                <div v-if="overview" class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="glass card">
                    <div class="tnum text-3xl font-semibold">{{ overview.links }}</div>
                    <div class="mt-1 text-sm text-ink-2">短链总数</div>
                </div>
                <div class="glass card">
                    <div class="tnum text-3xl font-semibold">{{ overview.total_clicks }}</div>
                    <div class="mt-1 text-sm text-ink-2">累计点击</div>
                </div>
                <div class="glass card">
                    <div class="tnum text-3xl font-semibold">{{ overview.clicks_today }}</div>
                    <div class="mt-1 text-sm text-ink-2">今日点击</div>
                </div>
            </div>

            <!-- 全站趋势 + Top10 -->
            <div v-if="overview" class="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div class="glass card lg:col-span-2">
                    <h2 class="mb-4 text-base font-semibold">全站近 14 天点击趋势（UTC 日切）</h2>
                    <StatBars :series="overview.daily" />
                </div>
                <div class="glass card">
                    <h2 class="mb-4 text-base font-semibold">点击 Top 10</h2>
                    <p v-if="overview.top_links.length === 0" class="text-sm text-ink-3">暂无点击数据</p>
                    <ul v-else class="space-y-2 text-sm">
                        <li
                            v-for="(top, index) in overview.top_links"
                            :key="top.code"
                            class="flex items-center gap-2"
                        >
                            <span class="tnum w-5 shrink-0 text-ink-3">{{ index + 1 }}.</span>
                            <a
                                :href="shortUrlOf(top.code)"
                                target="_blank"
                                rel="noopener"
                                class="truncate font-medium text-accent transition-colors hover:text-accent-hover"
                                :title="top.url"
                            >/{{ top.code }}</a>
                            <span class="tnum ml-auto shrink-0 text-ink-2">{{ top.clicks }}</span>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- 搜索与列表：数据密集区域使用不透明表面保证可读性 -->
            <div class="surface-card card">
                <form class="mb-5 flex flex-col gap-3 sm:flex-row" @submit.prevent="search">
                    <input
                        v-model="keyword"
                        type="text"
                        placeholder="搜索短码或目标链接…"
                        aria-label="搜索短码或目标链接"
                        class="input flex-1"
                    />
                    <div class="flex gap-3">
                        <button type="submit" class="btn btn-primary flex-1 sm:flex-none">搜索</button>
                        <button type="button" class="btn btn-secondary" @click="refresh">刷新</button>
                    </div>
                </form>

                <div class="overflow-x-auto">
                    <table class="w-full min-w-[720px] text-left text-sm">
                        <thead>
                            <tr class="border-b border-line text-xs uppercase tracking-wider text-ink-3">
                                <th class="py-3 pr-3 font-medium">短链接</th>
                                <th class="py-3 pr-3 font-medium">目标链接</th>
                                <th class="py-3 pr-3 font-medium">创建时间</th>
                                <th class="py-3 pr-3 text-right font-medium">今日</th>
                                <th class="py-3 pr-3 text-right font-medium">总点击</th>
                                <th class="py-3 text-right font-medium">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="items.length === 0">
                                <td colspan="6" class="py-12 text-center text-ink-3">
                                    {{ loading ? '加载中…' : '没有匹配的短链' }}
                                </td>
                            </tr>
                            <tr
                                v-for="item in items"
                                :key="item.code"
                                class="row-hover border-b border-line align-middle last:border-0"
                            >
                                <td class="py-3 pr-3">
                                    <a
                                        :href="shortUrlOf(item.code)"
                                        target="_blank"
                                        rel="noopener"
                                        class="font-medium text-accent transition-colors hover:text-accent-hover"
                                    >/{{ item.code }}</a>
                                </td>
                                <td class="max-w-[280px] py-3 pr-3">
                                    <a
                                        :href="item.url"
                                        target="_blank"
                                        rel="noopener"
                                        class="block truncate text-ink-2 transition-colors hover:text-accent"
                                        :title="item.url"
                                    >{{ item.url }}</a>
                                </td>
                                <td class="tnum whitespace-nowrap py-3 pr-3 text-ink-3">{{ formatTime(item.created_at) }}</td>
                                <td class="tnum py-3 pr-3 text-right text-ink-2">{{ item.clicks_today }}</td>
                                <td class="tnum py-3 pr-3 text-right font-semibold">{{ item.clicks }}</td>
                                <td class="whitespace-nowrap py-3 text-right">
                                    <button type="button" class="action-btn" @click="openStats(item)">统计</button>
                                    <button type="button" class="action-btn" @click="editing = item">编辑</button>
                                    <button type="button" class="action-btn action-danger" @click="removeLink(item)">删除</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- 分页 -->
                <div class="mt-5 flex items-center justify-between text-sm">
                    <span class="tnum text-ink-3">共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
                    <div class="flex gap-2">
                        <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            :disabled="page <= 1"
                            @click="goPage(page - 1)"
                        >
                            上一页
                        </button>
                        <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            :disabled="page >= totalPages"
                            @click="goPage(page + 1)"
                        >
                            下一页
                        </button>
                    </div>
                </div>
                </div>
                </div>
            </transition>

            <!-- 弹窗 -->
            <transition name="modal">
                <ConfirmDialog
                    v-if="pendingDelete"
                    title="删除短链"
                    :message="`确定删除短链 /${pendingDelete.code} ？删除后立即失效，点击记录一并清除。`"
                    confirm-text="删除"
                    danger
                    @confirm="confirmRemove"
                    @close="pendingDelete = null"
                />
            </transition>
            <transition name="modal">
                <EditLinkModal
                    v-if="editing"
                    :link="editing"
                    @close="editing = null"
                    @saved="editing = null; showNotice('已保存'); refresh()"
                />
            </transition>
            <transition name="modal">
                <LinkStatsModal v-if="statsCode" :code="statsCode" @close="statsCode = ''" />
            </transition>

            <!-- 轻提示 -->
            <transition name="toast">
                <div v-if="notice" class="toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
                    {{ notice }}
                </div>
            </transition>
        </div>
    </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
    transition: opacity 0.22s var(--ease), transform 0.22s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translate(-50%, 8px);
}
</style>
