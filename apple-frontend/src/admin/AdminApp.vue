<script setup>
/**
 * 后台根组件：登录态、选项卡、概览、短链列表。
 *
 * 相比旧实现的结构性变化：
 *   1. 选项卡是 role=tablist/tab/tabpanel 的完整语义（旧实现只有 class）
 *   2. 两个面板都常驻（v-show），切换不重新挂载、不重发请求
 *   3. 选项卡的选中指示块由弹簧驱动（见 AppSegmented）
 *   4. toast 挂在根层级，不受状态切换影响
 */
import { computed, onMounted, ref } from 'vue'
import api, { errorMessage } from '../services/entity.js'
import AppButton from '../components/AppButton.vue'
import AppSegmented from '../components/AppSegmented.vue'
import AppPeriodSwitch from '../components/AppPeriodSwitch.vue'
import AppThemeToggle from '../components/AppThemeToggle.vue'
import AppToast from '../components/AppToast.vue'
import AppStatBars from '../components/AppStatBars.vue'
import AdminLogin from './AdminLogin.vue'
import AdminSettings from './AdminSettings.vue'
import LinkStatsSheet from './LinkStatsSheet.vue'
import EditLinkSheet from './EditLinkSheet.vue'
import ConfirmSheet from './ConfirmSheet.vue'

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
const loggingOut = ref(false)
const homeAccessible = ref(true)

const editing = ref(null)
const statsCode = ref('')
const pendingDelete = ref(null)
// 趋势粒度：day / week / month / year
const period = ref('day')
// 粒度切换只重拉概览，避免整页进入 loading 闪动
const periodLoading = ref(false)

const tabItems = [
    { value: 'links', label: '短链管理', controls: 'panel-links' },
    { value: 'settings', label: '设置', controls: 'panel-settings' },
]

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))

onMounted(async () => {
    try {
        const state = await api.me()
        authState.value = state.authenticated ? 'ready' : 'login'
        homeAccessible.value = !state.require_login
    } catch {
        authState.value = 'login'
    }
    if (authState.value === 'ready') {
        await refresh()
    }
})

async function refresh() {
    loading.value = true
    try {
        const [ov, list] = await Promise.all([
            api.fetchOverview(period.value),
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
        showNotice(errorMessage(err, '加载失败'))
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

/**
 * 切换趋势粒度：只重拉概览，不动列表 —— 列表不变就没必要整页 loading。
 * 失败时保留原图表，仅提示。
 */
async function onPeriodChange(value) {
    period.value = value
    periodLoading.value = true
    try {
        overview.value = await api.fetchOverview(value)
    } catch (err) {
        if (err.isAuthError) {
            authState.value = 'login'

            return
        }
        showNotice(errorMessage(err, '趋势加载失败'))
    } finally {
        periodLoading.value = false
    }
}

function search() {
    page.value = 1
    appliedKeyword.value = keyword.value.trim()
    refresh()
}

function goPage(target) {
    if (target < 1 || target > totalPages.value || target === page.value) return
    page.value = target
    refresh()
}

function shortUrlOf(code) {
    return `${window.location.origin}/${code}`
}

function formatTime(value) {
    return typeof value === 'string' ? value.replace('T', ' ').slice(0, 16) : ''
}

async function onLoggedIn() {
    authState.value = 'ready'
    await refresh()
}

async function onLoggedOut() {
    if (loggingOut.value) return

    loggingOut.value = true
    try {
        await api.logout()
    } finally {
        loggingOut.value = false
        authState.value = 'login'
        overview.value = null
        // 列表数据一并清空，避免重新登录后短暂显示上一会话的数据
        items.value = []
        total.value = 0
        try {
            const state = await api.me()
            homeAccessible.value = !state.require_login
        } catch {
            // 会话查询失败时保留原值
        }
    }
}

function onPasswordChanged() {
    // 服务端已撤销全部登录态，切回登录视图
    authState.value = 'login'
}

async function confirmRemove() {
    const item = pendingDelete.value
    pendingDelete.value = null
    if (!item) return

    try {
        await api.deleteLink(item.code)
        showNotice(`已删除 ${item.code}`)
        await refresh()
    } catch (err) {
        showNotice(errorMessage(err, '删除失败'))
    }
}

function showNotice(message) {
    notice.value = message
}
</script>

<template>
    <div class="mx-auto min-h-screen max-w-6xl px-5 sm:px-8">
        <AdminLogin
            v-if="authState === 'login'"
            :home-accessible="homeAccessible"
            @logged-in="onLoggedIn"
        />

        <div
            v-else-if="authState === 'checking'"
            class="flex min-h-screen items-center justify-center"
        >
            <div class="material-regular card flex items-center gap-2 type-sm text-ink-2" role="status">
                <span class="spinner" aria-hidden="true" />
                正在验证登录态…
            </div>
        </div>

        <div v-else class="py-6 pb-20">
            <header class="mb-8 flex flex-wrap items-center justify-between gap-4">
                <h1 class="type-2xl">Devr · 管理后台</h1>
                <div class="flex items-center gap-2">
                    <AppThemeToggle />
                    <a href="/" class="btn btn-ghost btn-sm">← 返回首页</a>
                    <AppButton
                        variant="secondary"
                        size="sm"
                        :loading="loggingOut"
                        @click="onLoggedOut"
                    >
                        {{ loggingOut ? '退出中…' : '退出登录' }}
                    </AppButton>
                </div>
            </header>

            <div class="material-regular mb-6 inline-flex rounded-[14px]">
                <AppSegmented v-model="tab" :items="tabItems" label="后台功能切换" />
            </div>

            <!-- 面板常驻：切换只切显示，不重新挂载、不重发请求 -->
            <div v-show="tab === 'links'" id="panel-links" role="tabpanel" aria-labelledby="tab-links">
                <!-- 登录后首次拉取：概览未就绪时给出加载反馈 -->
                <div
                    v-if="loading && !overview"
                    class="material-regular card mb-6 flex items-center gap-2 type-sm text-ink-2"
                    role="status"
                >
                    <span class="spinner" aria-hidden="true" />
                    正在加载后台数据…
                </div>

                <div v-if="overview" class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div class="material-regular card">
                        <div class="tnum type-3xl">{{ overview.links }}</div>
                        <div class="type-sm mt-1 text-ink-2">短链总数</div>
                    </div>
                    <div class="material-regular card">
                        <div class="tnum type-3xl">{{ overview.total_clicks }}</div>
                        <div class="type-sm mt-1 text-ink-2">累计点击</div>
                    </div>
                    <div class="material-regular card">
                        <div class="tnum type-3xl">{{ overview.clicks_today }}</div>
                        <div class="type-sm mt-1 text-ink-2">今日点击</div>
                    </div>
                </div>

                <div v-if="overview" class="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div class="material-regular card lg:col-span-2">
                        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h2 class="type-base font-semibold">
                                全站点击趋势
                                <span class="type-xs ml-1 font-normal text-ink-3">UTC 口径</span>
                            </h2>
                            <AppPeriodSwitch :model-value="period" @update:model-value="onPeriodChange" />
                        </div>
                        <!-- 切换粒度时降低不透明度而不是显示骨架：旧图表仍是有效信息 -->
                        <div :class="periodLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'">
                            <AppStatBars :series="overview.daily" :period="overview.period || period" />
                        </div>
                    </div>
                    <div class="material-regular card">
                        <h2 class="type-base mb-4 font-semibold">点击 Top 10</h2>
                        <p v-if="overview.top_links.length === 0" class="type-sm text-ink-3">暂无点击数据</p>
                        <ul v-else class="type-sm space-y-2">
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
                                    class="link truncate font-medium"
                                    :title="top.url"
                                >{{ top.code }}</a>
                                <span class="tnum ml-auto shrink-0 text-ink-2">{{ top.clicks }}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <!-- 数据密集区用不透明表面，保证表格可读性 -->
                <div class="material-solid card">
                    <form class="mb-5 flex flex-col gap-3 sm:flex-row" @submit.prevent="search">
                        <input
                            v-model="keyword"
                            type="text"
                            class="input flex-1"
                            placeholder="搜索短码或目标链接…"
                            aria-label="搜索短码或目标链接"
                        />
                        <div class="flex gap-3">
                            <AppButton type="submit" class="flex-1 sm:flex-none">搜索</AppButton>
                            <AppButton variant="secondary" @click="refresh">刷新</AppButton>
                        </div>
                    </form>

                    <div class="table-bleed overflow-x-auto">
                        <table class="data-table type-sm w-full min-w-[720px] text-left">
                            <thead>
                                <tr>
                                    <th class="type-caps py-3 pr-3 text-ink-3">短链接</th>
                                    <th class="type-caps py-3 pr-3 text-ink-3">目标链接</th>
                                    <th class="type-caps py-3 pr-3 text-ink-3">创建时间</th>
                                    <th class="type-caps py-3 pr-3 text-right text-ink-3">今日</th>
                                    <th class="type-caps py-3 pr-3 text-right text-ink-3">总点击</th>
                                    <th class="type-caps py-3 text-right text-ink-3">操作</th>
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
                                    class="row-hover align-middle"
                                >
                                    <td class="py-3 pr-3">
                                        <a
                                            :href="shortUrlOf(item.code)"
                                            target="_blank"
                                            rel="noopener"
                                            class="link font-medium"
                                        >{{ item.code }}</a>
                                    </td>
                                    <td class="max-w-[280px] py-3 pr-3">
                                        <a
                                            :href="item.url"
                                            target="_blank"
                                            rel="noopener"
                                            class="block truncate text-ink-2"
                                            style="text-decoration: none"
                                            :title="item.url"
                                        >{{ item.url }}</a>
                                    </td>
                                    <td class="tnum whitespace-nowrap py-3 pr-3 text-ink-3">
                                        {{ formatTime(item.created_at) }}
                                    </td>
                                    <td class="tnum py-3 pr-3 text-right text-ink-2">{{ item.clicks_today }}</td>
                                    <td class="tnum py-3 pr-3 text-right font-semibold">{{ item.clicks }}</td>
                                    <td class="whitespace-nowrap py-3 text-right">
                                        <button
                                            type="button"
                                            class="action-btn"
                                            @click="statsCode = item.code"
                                        >统计</button>
                                        <button
                                            type="button"
                                            class="action-btn"
                                            @click="editing = item"
                                        >编辑</button>
                                        <button
                                            type="button"
                                            class="action-btn action-danger"
                                            @click="pendingDelete = item"
                                        >删除</button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="type-sm mt-5 flex items-center justify-between">
                        <span class="tnum text-ink-3">
                            共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页
                        </span>
                        <div class="flex gap-2">
                            <AppButton
                                variant="secondary"
                                size="sm"
                                :disabled="page <= 1"
                                @click="goPage(page - 1)"
                            >上一页</AppButton>
                            <AppButton
                                variant="secondary"
                                size="sm"
                                :disabled="page >= totalPages"
                                @click="goPage(page + 1)"
                            >下一页</AppButton>
                        </div>
                    </div>
                </div>
            </div>

            <div v-show="tab === 'settings'" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
                <AdminSettings @password-changed="onPasswordChanged" @notice="showNotice" />
            </div>
        </div>

        <!-- 弹窗与提示挂在根层级，不受登录态切换影响 -->
        <ConfirmSheet
            v-if="pendingDelete"
            title="删除短链"
            :message="`确定删除短链 ${pendingDelete.code} ？删除后立即失效，点击记录一并清除。`"
            confirm-text="删除"
            danger
            @confirm="confirmRemove"
            @close="pendingDelete = null"
        />

        <EditLinkSheet
            v-if="editing"
            :link="editing"
            @close="editing = null"
            @saved="editing = null; showNotice('已保存'); refresh()"
        />

        <LinkStatsSheet v-if="statsCode" :code="statsCode" @close="statsCode = ''" />
        <AppToast :message="notice" @expire="notice = ''" />
    </div>
</template>
