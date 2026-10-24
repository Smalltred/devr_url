<script setup>
/**
 * 单链统计弹窗。
 *
 * 相比旧实现：
 *   1. 加载中显示统一 spinner（旧实现是 animate-pulse 的文字）
 *   2. 设备分布条带 role=progressbar 与数值语义
 *   3. 内容区可独立滚动，面板本身可下滑关闭
 */
import { onMounted, onUnmounted, ref } from 'vue'
import api, { errorMessage } from '../services/entity.js'
import AppStatBars from '../components/AppStatBars.vue'
import AppPeriodSwitch from '../components/AppPeriodSwitch.vue'
import AppSheet from '../components/AppSheet.vue'

const props = defineProps({
    code: { type: String, required: true },
    /** 触发按钮的矩形，供弹窗做「从按钮长出来」的入场动画 */
    originRect: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const stats = ref(null)
const error = ref('')
const loading = ref(true)
// 趋势粒度：day / week / month / year
const period = ref('day')
const periodLoading = ref(false)

// 趋势图高度：普通屏 72px，矮屏收到 56px。
// 用 matchMedia 而不是固定值，浏览器缩放或窗口变矮时内容仍能整体放进面板。
const chartHeight = ref(72)
let compactQuery = null

function syncChartHeight() {
    chartHeight.value = compactQuery?.matches ? 56 : 72
}

onMounted(() => {
    compactQuery = window.matchMedia('(max-height: 760px)')
    syncChartHeight()
    compactQuery.addEventListener('change', syncChartHeight)
})

onUnmounted(() => {
    compactQuery?.removeEventListener('change', syncChartHeight)
})

onMounted(async () => {
    try {
        stats.value = await api.fetchLinkStats(props.code, period.value)
    } catch (err) {
        error.value = errorMessage(err, '统计加载失败')
    } finally {
        loading.value = false
    }
})

/** 切换粒度：只重拉趋势数据 */
async function onPeriodChange(value) {
    period.value = value
    periodLoading.value = true
    try {
        stats.value = await api.fetchLinkStats(props.code, value)
    } catch (err) {
        error.value = errorMessage(err, '趋势加载失败')
    } finally {
        periodLoading.value = false
    }
}

/** 设备占比（桌面 / 移动） */
function deviceRatio(value) {
    if (!stats.value) return 0
    const { desktop = 0, mobile = 0 } = stats.value.devices || {}
    const total = Math.max(desktop + mobile, 1)

    return (value / total) * 100
}
</script>

<template>
    <AppSheet
        :title="`短链 ${code} 统计`"
        size="lg"
        :origin-rect="originRect"
        hide-scrollbar
        @close="emit('close')"
    >
        <!-- URL 行在加载期也用骨架占位：它若不占位，数据到达时会额外撑高一行，
             与统计瓦片的高度变化叠加，放大跳变感。
             真实行允许换行（break-all）：长 URL 若用 truncate 会被截掉一半，
             用户无法确认目标地址；换行多占的高度已由下方紧凑间距抵消。 -->
        <a
            v-if="stats"
            :href="stats.url"
            target="_blank"
            rel="noopener"
            class="stats-url type-sm block max-w-full truncate text-ink-3 hover:text-accent"
            :title="stats.url"
        >{{ stats.url }}</a>
        <div v-else-if="loading" class="skeleton-bar stats-url type-sm" style="width: 70%">&nbsp;</div>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <!-- 加载态用骨架占住最终尺寸：面板高度不随后续数据跳变，
             因此打开时就是最终大小，不会出现「先小后突然撑开」的突兀感。
             骨架刻意复用真实内容的排版类（type-lg / type-sm / stat-tile /
             referer-box），高度由构造方式天然一致，而不是手算像素去凑 ——
             字号或行高令牌将来调整时，两侧仍会自动对齐。
             `&nbsp;` 用于撑出该字号的行高。 -->
        <div v-else-if="loading" class="stats-skeleton" role="status" aria-label="统计加载中">
            <div class="stats-tiles grid grid-cols-3 gap-3 text-center">
                <div v-for="n in 3" :key="n" class="stat-tile">
                    <div class="skeleton-bar type-lg mx-auto" style="width: 2.5rem">&nbsp;</div>
                    <div class="skeleton-bar type-xs mt-1 mx-auto" style="width: 3.5rem">&nbsp;</div>
                </div>
            </div>

            <!-- 与「点击趋势」h3 同行高 -->
            <div class="skeleton-bar type-sm mb-2 font-semibold" style="width: 7rem">&nbsp;</div>
            <!-- 与粒度切换控件同高（segmented: 4px 内边距 + 36px 按钮） -->
            <div class="skeleton-bar stats-switch" style="height: 2.75rem; width: 11rem" />
            <!-- 与 .stat-chart 同高：柱区 chartHeight + 横轴 28px -->
            <div class="skeleton-bar stats-chart-wrap" :style="{ height: `${chartHeight + 28}px` }" />

            <div class="stats-grid grid grid-cols-1 sm:grid-cols-2">
                <div>
                    <div class="skeleton-bar type-sm mb-3 font-semibold" style="width: 7rem">&nbsp;</div>
                    <!-- 与空来源区同高（min-height），高度不随条数变化 -->
                    <div class="referer-box">
                        <div class="skeleton-bar" style="height: 2.75rem" />
                    </div>
                </div>
                <div>
                    <div class="skeleton-bar type-sm mb-3 font-semibold" style="width: 7rem">&nbsp;</div>
                    <!-- 与「设备分布」同高：桌面/移动两行（各 2.5rem 条 + 12px 间距）
                         移动端为单列堆叠，这一块的高度差同样会传导到面板高度 -->
                    <div class="device-skeleton">
                        <div class="skeleton-bar" style="height: 2.5rem" />
                        <div class="skeleton-bar" style="height: 2.5rem" />
                    </div>
                </div>
            </div>

            <!-- 与「创建信息」同高：标题 + 2×2 明细行 -->
            <div class="stats-creation border-t border-line">
                <div class="skeleton-bar stats-creation-title type-sm font-semibold" style="width: 5rem">&nbsp;</div>
                <div class="stats-creation-grid grid grid-cols-1 sm:grid-cols-2">
                    <div v-for="n in 4" :key="n" class="skeleton-bar" style="height: 1.75rem" />
                </div>
            </div>
        </div>

        <template v-else-if="stats">
            <div class="stats-tiles grid grid-cols-3 gap-3 text-center">
                <div class="stat-tile">
                    <div class="tnum type-lg">{{ stats.total_clicks }}</div>
                    <div class="type-xs mt-1 text-ink-3">总点击</div>
                </div>
                <div class="stat-tile">
                    <div class="tnum type-lg">{{ stats.clicks_today }}</div>
                    <div class="type-xs mt-1 text-ink-3">今日点击</div>
                </div>
                <div class="stat-tile">
                    <div class="tnum type-lg">{{ stats.visitors }}</div>
                    <div class="type-xs mt-1 text-ink-3">独立访客</div>
                </div>
            </div>

            <h3 class="type-sm mb-2 font-semibold">点击趋势（北京时间）</h3>
            <div class="stats-switch">
                <AppPeriodSwitch :model-value="period" @update:model-value="onPeriodChange" />
            </div>
            <div :class="[periodLoading ? 'opacity-60' : '', 'stats-chart-wrap transition-opacity']">
                <AppStatBars :series="stats.daily" :period="stats.period || period" :height="chartHeight" />
            </div>

            <div class="stats-grid grid grid-cols-1 sm:grid-cols-2">
                <div>
                    <h3 class="type-sm mb-3 font-semibold">来源域名 Top 10</h3>
                    <!-- 高度随数据自适应（空态只占一行），超过 8.5rem 后内部滚动：
                         既避免长列表把弹窗撑高，也不让 0–1 条数据时留出一大片空白。 -->
                    <div class="referer-box">
                        <p v-if="stats.referers.length === 0" class="type-sm text-ink-3">暂无来源记录</p>
                        <ul v-else class="type-sm space-y-2">
                            <li
                                v-for="ref in stats.referers"
                                :key="ref.referer_host || 'direct'"
                                class="flex justify-between gap-2 border-b border-line pb-1"
                            >
                                <span
                                    class="truncate"
                                    :class="ref.referer_host ? 'text-ink-2' : 'text-ink-3'"
                                >{{ ref.referer_host || '直接访问' }}</span>
                                <span class="tnum shrink-0 font-semibold">{{ ref.clicks }}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div>
                    <h3 class="type-sm mb-3 font-semibold">设备分布</h3>
                    <div class="space-y-3">
                        <div class="flex items-center gap-3">
                            <span class="type-sm w-10 shrink-0 text-ink-2">桌面</span>
                            <div
                                class="h-2.5 flex-1 overflow-hidden rounded-full bg-line"
                                role="progressbar"
                                aria-label="桌面端占比"
                                :aria-valuenow="Math.round(deviceRatio(stats.devices.desktop))"
                                aria-valuemin="0"
                                aria-valuemax="100"
                            >
                                <div
                                    class="h-2.5 rounded-full bg-accent"
                                    :style="{ width: deviceRatio(stats.devices.desktop) + '%' }"
                                />
                            </div>
                            <span class="tnum type-sm w-10 shrink-0 text-right font-semibold">
                                {{ stats.devices.desktop }}
                            </span>
                        </div>

                        <div class="flex items-center gap-3">
                            <span class="type-sm w-10 shrink-0 text-ink-2">移动</span>
                            <div
                                class="h-2.5 flex-1 overflow-hidden rounded-full bg-line"
                                role="progressbar"
                                aria-label="移动端占比"
                                :aria-valuenow="Math.round(deviceRatio(stats.devices.mobile))"
                                aria-valuemin="0"
                                aria-valuemax="100"
                            >
                                <div
                                    class="h-2.5 rounded-full bg-accent"
                                    :style="{ width: deviceRatio(stats.devices.mobile) + '%' }"
                                />
                            </div>
                            <span class="tnum type-sm w-10 shrink-0 text-right font-semibold">
                                {{ stats.devices.mobile }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 创建信息：补齐弹窗底部空白，展示创建者身份、真实 IP 与设备 -->
            <div class="stats-creation border-t border-line">
                <h3 class="stats-creation-title type-sm font-semibold">创建信息</h3>
                <dl class="stats-creation-grid grid grid-cols-1 sm:grid-cols-2">
                    <div class="stats-row flex items-baseline justify-between gap-3 border-b border-line">
                        <dt class="type-xs shrink-0 text-ink-3">创建者</dt>
                        <dd class="type-sm truncate text-right">{{ stats.creator?.label }}</dd>
                    </div>
                    <div class="stats-row flex items-baseline justify-between gap-3 border-b border-line">
                        <dt class="type-xs shrink-0 text-ink-3">创建 IP</dt>
                        <dd class="tnum type-sm select-all truncate text-right">{{ stats.creator?.ip || '—' }}</dd>
                    </div>
                    <div class="stats-row flex items-baseline justify-between gap-3 border-b border-line">
                        <dt class="type-xs shrink-0 text-ink-3">设备</dt>
                        <dd
                            class="type-sm truncate text-right"
                            :title="stats.creator?.user_agent || ''"
                        >{{ stats.creator?.device || '—' }}</dd>
                    </div>
                    <div class="stats-row flex items-baseline justify-between gap-3 border-b border-line">
                        <dt class="type-xs shrink-0 text-ink-3">创建时间（北京时间）</dt>
                        <dd class="tnum type-sm truncate text-right">{{ stats.creator?.created_at || '—' }}</dd>
                    </div>
                </dl>
                <p v-if="stats.creator?.type === 'unknown'" class="stats-creation-hint type-xs text-ink-3">
                    该短链创建于功能上线前，无法追溯创建者信息。
                </p>
            </div>
        </template>
    </AppSheet>
</template>

<style scoped>
/* 统计内容节奏集中在两档：普通屏与矮屏。
   矮屏（含 125%/150% 浏览器缩放）整体收紧间距，
   让「创建信息」留在弹窗可视区内，而不是靠隐藏溢出来消除滚动条。 */
.stats-url {
    /* 单行显示：超出用省略号，完整地址在 title 与点击打开的页面里。
       与标题的间距由 header 的 8px 底部内边距提供，不再用负 margin 上提，
       避免第一行被内容区的 overflow 裁掉。 */
    margin-bottom: 20px;
}
.stats-tiles { margin-bottom: var(--space-5); }
.stats-switch { margin-bottom: var(--space-3); }
.stats-chart-wrap { margin-bottom: var(--space-5); }
.stats-grid { gap: var(--space-5); }
.stats-creation { margin-top: var(--space-5); padding-top: var(--space-4); }
.stats-creation-title { margin-bottom: var(--space-3); }
.stats-creation-grid { gap: var(--space-2) var(--space-8); }
.stats-creation-hint { margin-top: var(--space-2); }
.stats-row { padding-bottom: var(--space-1); }

@media (max-height: 760px) {
    .stats-url { margin-bottom: 18px; }
    .stats-tiles { margin-bottom: var(--space-3); }
    .stats-tiles .stat-tile { padding: var(--space-2); }
    .stats-switch { margin-bottom: var(--space-2); }
    .stats-chart-wrap { margin-bottom: var(--space-3); }
    .stats-grid { gap: var(--space-3); }
    .stats-creation { margin-top: var(--space-3); padding-top: var(--space-3); }
    .stats-creation-title { margin-bottom: var(--space-2); }
    .stats-creation-grid { gap: var(--space-1) var(--space-6); }
    .stats-creation-hint { margin-top: var(--space-1); }
    .stats-row { padding-bottom: 2px; }
    /* 矮屏下限制来源列表的最大高度：Top 10 再多也不把创建信息挤出可视区，
       超出部分仍在框内滚动（页面滚动条保持隐藏，内容不丢失）。 */
    .stats-grid .referer-box { max-height: 3.5rem; }
}

/* 设备分布骨架：两行，间距与真实内容的 space-y-3（12px）一致 */
.stats-skeleton .device-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 3.1875rem; /* 2×2.5rem + 12px，与真实块（51px）等高 */
}

/* 来源列表：空态只保留一行高度，最多 8.5rem 后内部滚动。
   固定 8.5rem 会在 0–1 条来源时留下近 100px 空白，
   把下方的「创建信息」顶出弹窗可视区，用户必须滚动才能看到。 */
.referer-box {
    min-height: 2.75rem;
    max-height: 8.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
}

/* 骨架条：只负责视觉（底色、圆角、微光），不写死高度。
   高度由排版类（type-lg / type-sm / type-xs）或显式 height 决定 ——
   早期版本在这里写死 height: 1rem，把排版类撑出的行高覆盖掉了，
   导致骨架比真实内容矮、数据到达时面板高度跳变。 */
.stats-skeleton .skeleton-bar {
    border-radius: var(--radius-xs);
    background: var(--glass-border-soft);
    position: relative;
    overflow: hidden;
    /* 无排版类时的兜底高度 */
    min-height: 1rem;
}

/* 微光扫过表示「正在加载」，比整块呼吸更细腻，也不会让大块表面明暗闪烁 */
.stats-skeleton .skeleton-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, var(--glass-highlight), transparent);
    animation: skeleton-sweep 1.4s var(--ease) infinite;
}

@keyframes skeleton-sweep {
    to {
        transform: translateX(100%);
    }
}

@media (prefers-reduced-motion: reduce) {
    /* 减弱动效：去掉扫光，保留静态骨架（仍能表达「占位、未就绪」） */
    .stats-skeleton .skeleton-bar::after {
        animation: none;
        display: none;
    }
}
</style>
