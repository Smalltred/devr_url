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
import AppSelect from '../components/AppSelect.vue'
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
// 统计弹窗的入场锚点（触发按钮的矩形），用于「从按钮长出来」的入场动画
const statsOrigin = ref(null)
const pendingDelete = ref(null)
// 趋势粒度：day / week / month / year
const period = ref('day')
// 粒度切换只重拉概览，避免整页进入 loading 闪动
const periodLoading = ref(false)

// 外链巡检
// 健康状态筛选：'' = 全部，invalid / ok / unknown
const healthFilter = ref('')
// 目标域名筛选：'' = 全部域名；值为精确主机名（含端口）
const domainFilter = ref('')
const domains = ref([])
// 健康概览：{ok, invalid, unknown, pending, last_scan_at}
const health = ref(null)
const scanning = ref(false)
const cleaning = ref(false)
// 待确认清理失效链接
const pendingCleanup = ref(false)

const healthFilters = [
    { value: '', label: '全部' },
    // 「失效」即目标不可访问：待确认与已判定的失效在界面上不再区分
    { value: 'invalid', label: '失效' },
    { value: 'ok', label: '正常' },
    { value: 'unknown', label: '未知' },
]

const tabItems = [
    { value: 'links', label: '短链管理', controls: 'panel-links' },
    { value: 'settings', label: '设置', controls: 'panel-settings' },
]

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))

// 当前筛选域名若已没有任何短链，仍保留在选项中，避免下拉显示为空白
const domainOptions = computed(() => {
    const items = domains.value.map((item) => ({
        value: item.domain,
        label: item.domain,
        count: item.count,
    }))

    if (domainFilter.value && !domains.value.some((item) => item.domain === domainFilter.value)) {
        items.unshift({ value: domainFilter.value, label: domainFilter.value, count: 0 })
    }

    return [{ value: '', label: '全部域名' }, ...items]
})

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
            api.fetchLinks({
                page: page.value,
                per_page: perPage.value,
                q: appliedKeyword.value,
                health: healthFilter.value || undefined,
                domain: domainFilter.value || undefined,
            }),
        ])
        overview.value = ov
        items.value = list.items
        total.value = list.total
        page.value = list.page
        domains.value = Array.isArray(list.domains) ? list.domains : []
        health.value = list.health || null
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

/**
 * 打开统计弹窗，并记下触发按钮的位置。
 * 弹窗据此从按钮方向生长出来（空间一致性：从哪来、回哪去），
 * 而不是从屏幕中心凭空出现。
 */
function openStats(code, event) {
    const el = event?.currentTarget ?? event?.target
    statsOrigin.value = el?.getBoundingClientRect?.() ?? null
    statsCode.value = code
}

function formatTime(value) {
    return typeof value === 'string' ? value.replace('T', ' ').slice(0, 16) : ''
}

/**
 * 健康状态徽标的悬浮说明：给出检测结果与时间，便于判断是否需要更新。
 */
function healthTitle(item) {
    if (item.health_status === 'unknown') {
        return item.health_checked_at
            ? `无法判定可用性（内网地址或站点限流），检测于 ${formatTime(item.health_checked_at)}`
            : '尚未检测：点击「扫描外链」开始巡检'
    }

    if (item.health_status === 'ok') {
        const parts = ['目标可正常访问']
        if (item.health_checked_at) parts.push(`检测于 ${formatTime(item.health_checked_at)}`)

        return parts.join('，')
    }

    // 目标不可访问：无论连续失败几次都统一为「失效」，不区分待确认/已判定
    const parts = [`目标不可访问${item.health_error ? `（${item.health_error}）` : ''}`]
    if (item.health_fail_count > 0) {
        parts.push(`已连续失败 ${item.health_fail_count} 次`)
    }
    if (item.health_checked_at) {
        parts.push(`检测于 ${formatTime(item.health_checked_at)}`)
    }

    return parts.join('，')
}

/** 目标不可访问：待确认（broken）与已确认（dead）在产品上统一为「失效」 */
function isInvalidStatus(status) {
    return status === 'broken' || status === 'dead'
}

/**
 * 健康状态徽标文案：unknown 区分「从未检测」与「检测过但无法判定」，
 * 否则用户会以为扫描没生效。
 * 目标不可访问统一显示为「失效」，附 HTTP 状态码便于排查。
 */
function healthLabel(item) {
    if (item.health_status === 'ok') return '正常'
    if (isInvalidStatus(item.health_status)) {
        return item.health_http_code ? `失效 ${item.health_http_code}` : '失效'
    }

    return item.health_checked_at ? '无法判定' : '未检测'
}

/** 健康徽标底色：使用设计令牌，避免在模板里堆内联色值 */
function healthBadgeBackground(status) {
    if (status === 'ok') return 'var(--color-success-soft)'
    if (isInvalidStatus(status)) return 'var(--color-danger-soft)'

    return 'var(--color-bg-elevated)'
}

/** 切换健康状态筛选 */
function setHealthFilter(value) {
    if (healthFilter.value === value) return
    healthFilter.value = value
    page.value = 1
    refresh()
}

/** 切换目标域名筛选 */
function setDomainFilter(value) {
    const next = String(value || '').trim()
    if (domainFilter.value === next) return
    domainFilter.value = next
    page.value = 1
    refresh()
}

/**
 * 扫描一批外链。
 * 扫描分批进行（每批 20 条、单条最多 8s），一次点击只扫一批并返回剩余待检数，
 * 用户可继续点击，避免单请求超时。
 */
async function scanNow() {
    if (scanning.value) return

    scanning.value = true
    try {
        const result = await api.scanLinks(20)
        if (result.summary) {
            health.value = { ...(health.value || {}), ...result.summary, pending: result.remaining }
        }
        const parts = [`已检测 ${result.scanned} 条`]
        if (result.ok > 0) parts.push(`正常 ${result.ok}`)
        const invalidCount = (result.broken || 0) + (result.dead || 0)
        if (invalidCount > 0) parts.push(`失效 ${invalidCount}`)
        if (result.skipped > 0) parts.push(`跳过 ${result.skipped}`)
        if (result.remaining > 0) parts.push(`剩余 ${result.remaining} 条待检`)
        showNotice(parts.join('，'))
        await refresh()
    } catch (err) {
        if (err.isAuthError) {
            authState.value = 'login'

            return
        }
        showNotice(errorMessage(err, '扫描失败'))
    } finally {
        scanning.value = false
    }
}

/** 一键清理全部失效链接（目标不可访问，含点击记录） */
async function confirmCleanupInvalid() {
    if (cleaning.value) return

    cleaning.value = true
    try {
        const result = await api.cleanupInvalidLinks()
        health.value = result.health || health.value
        showNotice(`已清理 ${result.deleted} 条失效链接`)
        page.value = 1
        await refresh()
    } catch (err) {
        if (err.isAuthError) {
            authState.value = 'login'

            return
        }
        showNotice(errorMessage(err, '清理失败'))
    } finally {
        cleaning.value = false
        pendingCleanup.value = false
    }
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
                    <!-- 与右侧 Top 10 并排：网格会让两张卡片等高。
                         这里用纵向 flex + 图表填充模式，让柱状图吃掉剩余高度，
                         避免图表下方留出一大片空白。卡片内边距保持不变（.card）。 -->
                    <div class="material-regular card flex flex-col lg:col-span-2">
                        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h2 class="type-base font-semibold">
                                全站点击趋势
                                <span class="type-xs ml-1 font-normal text-ink-3">北京时间</span>
                            </h2>
                            <AppPeriodSwitch :model-value="period" @update:model-value="onPeriodChange" />
                        </div>
                        <!-- 切换粒度时降低不透明度而不是显示骨架：旧图表仍是有效信息。
                             min-h-0 允许这一层收缩，否则 flex 子项不会小于内容尺寸。 -->
                        <div
                            class="min-h-0 flex-1"
                            :class="periodLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'"
                        >
                            <AppStatBars
                                :series="overview.daily"
                                :period="overview.period || period"
                                fill
                            />
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
                    <!-- 外链巡检：状态统计 + 扫描 + 一键清理。
                         不再套独立材质：浅色材质叠在实心卡片上会互相干扰，
                         这一行靠间距与排版与下方筛选区分组即可。 -->
                    <div class="mb-4 flex flex-wrap items-center gap-3">
                        <span class="type-sm text-ink-2">
                            外链巡检
                            <span v-if="health" class="text-ink-3">
                                · 正常 {{ health.ok }}
                                · <span v-if="health.invalid" class="text-danger">失效 {{ health.invalid }}</span>
                                <span v-else>失效 0</span>
                                · 未检测 {{ health.unknown }}
                                <template v-if="health.last_scan_at">· 最近检测 {{ formatTime(health.last_scan_at) }}</template>
                            </span>
                        </span>
                        <div class="ml-auto flex flex-wrap items-center gap-2">
                            <AppButton
                                variant="secondary"
                                size="sm"
                                :loading="scanning"
                                :title="health?.pending ? `还有 ${health.pending} 条待检` : '所有短链均在有效复检期内'"
                                @click="scanNow"
                            >
                                {{ scanning ? '检测中…' : (health?.pending ? `扫描外链（${health.pending}）` : '扫描外链') }}
                            </AppButton>
                            <AppButton
                                variant="danger"
                                size="sm"
                                :disabled="!health?.invalid"
                                :loading="cleaning"
                                @click="pendingCleanup = true"
                            >
                                {{ cleaning ? '清理中…' : `一键清理失效（${health?.invalid || 0}）` }}
                            </AppButton>
                        </div>
                    </div>

                    <!-- 筛选：外链状态 + 目标域名 -->
                    <div class="mb-4 flex flex-wrap items-center gap-3">
                        <AppSegmented
                            :model-value="healthFilter"
                            :items="healthFilters"
                            mode="group"
                            label="按外链状态筛选"
                            @update:model-value="setHealthFilter"
                        />
                        <div class="domain-filter">
                            <AppSelect
                                :model-value="domainFilter"
                                :items="domainOptions"
                                label="按目标域名筛选"
                                placeholder="全部域名"
                                @update:model-value="setDomainFilter"
                            />
                        </div>
                    </div>

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
                        <table class="data-table type-sm w-full min-w-[820px] text-left">
                            <thead>
                                <tr>
                                    <th class="type-caps py-3 pr-3 text-ink-3">短链接</th>
                                    <th class="type-caps py-3 pr-3 text-ink-3">目标链接</th>
                                    <th class="type-caps py-3 pr-3 text-ink-3">状态</th>
                                    <th class="type-caps py-3 pr-3 text-ink-3">创建时间</th>
                                    <th class="type-caps py-3 pr-3 text-right text-ink-3">今日</th>
                                    <th class="type-caps py-3 pr-3 text-right text-ink-3">总点击</th>
                                    <th class="type-caps py-3 text-right text-ink-3">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-if="items.length === 0">
                                    <td colspan="7" class="py-12 text-center text-ink-3">
                                        {{ loading ? '加载中…' : (healthFilter === 'invalid' ? '没有失效的短链' : '没有匹配的短链') }}
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
                                    <td class="max-w-[260px] py-3 pr-3">
                                        <a
                                            :href="item.url"
                                            target="_blank"
                                            rel="noopener"
                                            class="block truncate"
                                            :class="isInvalidStatus(item.health_status) ? 'text-danger' : 'text-ink-2'"
                                            style="text-decoration: none"
                                            :title="item.url"
                                        >{{ item.url }}</a>
                                    </td>
                                    <td class="whitespace-nowrap py-3 pr-3">
                                        <span
                                            class="type-xs inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
                                            :class="{
                                                'text-success': item.health_status === 'ok',
                                                'text-danger': isInvalidStatus(item.health_status),
                                                'text-ink-3': item.health_status === 'unknown',
                                            }"
                                            :style="{ background: healthBadgeBackground(item.health_status) }"
                                            :title="healthTitle(item)"
                                        >
                                            {{ healthLabel(item) }}
                                        </span>
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
                                            @click="openStats(item.code, $event)"
                                        >统计</button>
                                        <button
                                            type="button"
                                            class="action-btn"
                                            :class="{ 'action-danger': isInvalidStatus(item.health_status) }"
                                            @click="editing = item"
                                        >{{ isInvalidStatus(item.health_status) ? '更新链接' : '编辑' }}</button>
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

        <ConfirmSheet
            v-if="pendingCleanup"
            title="清理失效链接"
            :message="`将永久删除全部 ${health?.invalid || 0} 条失效链接（目标地址当前无法访问）及其点击记录，此操作不可恢复。若目标只是临时不可用，建议先点「更新链接」改为新地址。`"
            confirm-text="确认清理"
            danger
            @confirm="confirmCleanupInvalid"
            @close="pendingCleanup = false"
        />

        <EditLinkSheet
            v-if="editing"
            :link="editing"
            @close="editing = null"
            @saved="editing = null; showNotice('已保存'); refresh()"
        />

        <LinkStatsSheet
            v-if="statsCode"
            :code="statsCode"
            :origin-rect="statsOrigin"
            @close="statsCode = ''; statsOrigin = null"
        />
        <AppToast :message="notice" @expire="notice = ''" />
    </div>
</template>

<style scoped>
/* 目标域名下拉：与状态分段控件同一行，右侧对齐；移动端独占一行 */
.domain-filter {
    width: clamp(200px, 18vw, 280px);
    margin-left: auto;
}

@media (max-width: 639.98px) {
    .domain-filter {
        width: 100%;
        margin-left: 0;
    }
}
</style>
