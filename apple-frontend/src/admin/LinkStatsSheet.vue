<script setup>
/**
 * 单链统计弹窗。
 *
 * 相比旧实现：
 *   1. 加载中显示统一 spinner（旧实现是 animate-pulse 的文字）
 *   2. 设备分布条带 role=progressbar 与数值语义
 *   3. 内容区可独立滚动，面板本身可下滑关闭
 */
import { onMounted, ref } from 'vue'
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
        @close="emit('close')"
    >
        <!-- URL 行在加载期也用骨架占位：它若不占位，数据到达时会额外撑高一行，
             与统计瓦片的高度变化叠加，放大跳变感。
             高度取 type-sm 的行高，与真实行精确对齐 -->
        <p v-if="stats" class="type-sm -mt-2 mb-5 truncate text-ink-3" :title="stats.url">
            {{ stats.url }}
        </p>
        <div v-else-if="loading" class="skeleton-bar type-sm -mt-2 mb-5" style="width: 70%">&nbsp;</div>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <!-- 加载态用骨架占住最终尺寸：面板高度不随后续数据跳变，
             因此打开时就是最终大小，不会出现「先小后突然撑开」的突兀感。
             骨架刻意复用真实内容的排版类（type-lg / type-sm / stat-tile /
             referer-box），高度由构造方式天然一致，而不是手算像素去凑 ——
             字号或行高令牌将来调整时，两侧仍会自动对齐。
             `&nbsp;` 用于撑出该字号的行高。 -->
        <div v-else-if="loading" class="stats-skeleton" role="status" aria-label="统计加载中">
            <div class="mb-6 grid grid-cols-3 gap-3 text-center">
                <div v-for="n in 3" :key="n" class="stat-tile">
                    <div class="skeleton-bar type-lg mx-auto" style="width: 2.5rem">&nbsp;</div>
                    <div class="skeleton-bar type-xs mt-1 mx-auto" style="width: 3.5rem">&nbsp;</div>
                </div>
            </div>

            <!-- 与「点击趋势」h3 同行高 -->
            <div class="skeleton-bar type-sm mb-2 font-semibold" style="width: 7rem">&nbsp;</div>
            <!-- 与粒度切换控件同高（segmented: 4px 内边距 + 36px 按钮） -->
            <div class="skeleton-bar mb-3" style="height: 2.75rem; width: 11rem" />
            <!-- 与 .stat-chart 同高：柱区 96px + 横轴 28px = 124px
                 （数值与 AppStatBars 的 height 默认值保持一致） -->
            <div class="skeleton-bar mb-6" style="height: 124px" />

            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                    <div class="skeleton-bar type-sm mb-3 font-semibold" style="width: 7rem">&nbsp;</div>
                    <!-- 与 .referer-box 同高，保证加载态/内容态面板尺寸一致 -->
                    <div class="referer-box">
                        <div class="skeleton-bar" style="height: 100%" />
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
        </div>

        <template v-else-if="stats">
            <div class="mb-6 grid grid-cols-3 gap-3 text-center">
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

            <h3 class="type-sm mb-2 font-semibold">点击趋势（UTC 口径）</h3>
            <div class="mb-3">
                <AppPeriodSwitch :model-value="period" @update:model-value="onPeriodChange" />
            </div>
            <div :class="[periodLoading ? 'opacity-60' : '', 'mb-6 transition-opacity']">
                <AppStatBars :series="stats.daily" :period="stats.period || period" />
            </div>

            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                    <h3 class="type-sm mb-3 font-semibold">来源域名 Top 10</h3>
                    <!-- 固定高度并内部滚动：来源条数随数据变化（0–10 条），
                         若让它撑开内容，弹窗高度就会随数据量变化，
                         居中布局下表现为上下同时位移。锁死高度后，
                         面板尺寸与数据无关，从结构上消除这类抖动。 -->
                    <div class="referer-box">
                        <p v-if="stats.referers.length === 0" class="type-sm text-ink-3">暂无来源记录</p>
                        <ul v-else class="type-sm space-y-2">
                            <li
                                v-for="ref in stats.referers"
                                :key="ref.referer_host"
                                class="flex justify-between gap-2 border-b border-line pb-1"
                            >
                                <span class="truncate text-ink-2">{{ ref.referer_host }}</span>
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
        </template>
    </AppSheet>
</template>

<style scoped>
/* 设备分布骨架：两行，间距与真实内容的 space-y-3（12px）一致 */
.stats-skeleton .device-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 3.1875rem; /* 2×2.5rem + 12px，与真实块（51px）等高 */
}

/* 来源域名区固定高度并内部滚动。
   来源条数随数据变化（0–10 条，高度差可达数百像素），
   若让它参与内容高度计算，弹窗尺寸就会随数据变化 ——
   居中布局下表现为上下同时位移（"数据加载后弹窗跳一下"）。
   锁死高度后，面板尺寸与数据完全无关。 */
.referer-box {
    height: 8.5rem;
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
