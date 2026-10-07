<script setup>
/**
 * 柱状趋势图。
 *
 * 无障碍：旧实现是一堆裸 div，辅助技术完全读不到。
 * 这里给 role=img + 概要 aria-label，并用视觉隐藏的表格提供逐点数据。
 * 悬停/聚焦时高亮单根柱子并显示数值。
 */
import { computed, ref } from 'vue'

const props = defineProps({
    /** @type {{date: string, clicks: number}[]} 按时间升序 */
    series: { type: Array, required: true },
    /** 粒度：day / week / month / year，决定横轴标签与文案 */
    period: { type: String, default: 'day' },
    height: { type: Number, default: 96 },
})

const activeIndex = ref(-1)

const maxClicks = computed(() => {
    const max = Math.max(...props.series.map((point) => point.clicks), 1)

    return max
})

const total = computed(() => props.series.reduce((sum, point) => sum + point.clicks, 0))

/** 窗口内完全没有点击：明确告知，而不是画一片空白 */
const isEmpty = computed(() => total.value === 0)

const periodLabel = computed(
    () => ({ day: '天', week: '周', month: '月', year: '年' })[props.period] || '天',
)

/** 给屏幕阅读器的概要描述，避免逐个数字念出来 */
const summary = computed(() => {
    if (props.series.length === 0) return '暂无趋势数据'
    if (isEmpty.value) return `按${periodLabel.value}统计，该时段内暂无点击`

    const first = formatLabel(props.series[0].date)
    const last = formatLabel(props.series[props.series.length - 1].date)

    return `点击趋势，${first} 至 ${last}，按${periodLabel.value}统计，共 ${total.value} 次点击，峰值 ${maxClicks.value} 次`
})

/** 零值桶保留极细基线，保证柱列视觉连续而不是缺口 */
function barHeight(point) {
    if (point.clicks === 0) return '2px'

    return `${(point.clicks / maxClicks.value) * 100}%`
}

/**
 * 桶起始日 → 显示标签。
 * 粒度越长展示越粗略，避免窄屏下标签互相挤压。
 */
function formatLabel(date) {
    if (typeof date !== 'string' || date.length < 10) return date || ''

    const [year, month, day] = date.split('-')

    switch (props.period) {
        case 'year':
            return `${year} 年`
        case 'month':
            return `${Number(month)} 月`
        case 'week':
            return `${month}-${day} 周`
        default:
            return `${month}-${day}`
    }
}
</script>

<template>
    <figure class="stat-chart">
        <!-- 空状态：给出原因与下一步，而不是留一片空白 -->
        <div v-if="isEmpty" class="stat-empty" :style="{ minHeight: height + 16 + 'px' }" role="status">
            <span>该时段内暂无点击</span>
            <span class="stat-empty-hint">切换到其他粒度，或等待短链被访问后此处将显示趋势</span>
        </div>

        <template v-else>
            <div class="stat-bars" :style="{ height: height + 'px' }" role="img" :aria-label="summary">
                <button
                    v-for="(point, index) in series"
                    :key="point.date"
                    type="button"
                    class="stat-bar-group"
                    :aria-label="`${formatLabel(point.date)}：${point.clicks} 次点击`"
                    @mouseenter="activeIndex = index"
                    @mouseleave="activeIndex = -1"
                    @focus="activeIndex = index"
                    @blur="activeIndex = -1"
                >
                    <span
                        class="stat-bar"
                        :class="[
                            point.clicks === 0 ? 'is-zero' : '',
                            activeIndex === index ? 'is-active' : '',
                        ]"
                        :style="{ height: barHeight(point) }"
                    />
                </button>
            </div>

            <figcaption class="stat-axis tnum">
                <span>{{ formatLabel(series[0]?.date) }}</span>
                <span v-if="activeIndex >= 0" class="stat-axis-active">
                    {{ formatLabel(series[activeIndex].date) }} · {{ series[activeIndex].clicks }} 次
                </span>
                <span v-else class="stat-axis-total">
                    按{{ periodLabel }} · 共 {{ total }} 次
                </span>
                <span>{{ formatLabel(series[series.length - 1]?.date) }}</span>
            </figcaption>

            <!-- 供辅助技术逐点读取；视觉上隐藏 -->
            <table class="sr-only">
                <caption>{{ summary }}</caption>
                <thead>
                    <tr><th scope="col">桶起始日</th><th scope="col">点击</th></tr>
                </thead>
                <tbody>
                    <tr v-for="point in series" :key="point.date">
                        <td>{{ formatLabel(point.date) }}</td>
                        <td>{{ point.clicks }}</td>
                    </tr>
                </tbody>
            </table>
        </template>
    </figure>
</template>

<style scoped>
.stat-chart {
    margin: 0;
}

.stat-bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
}

.stat-bar-group {
    flex: 1;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    display: flex;
    align-items: flex-end;
    cursor: default;
}

.stat-bar {
    display: block;
    width: 100%;
    min-height: 2px;
    border-radius: var(--radius-xs) var(--radius-xs) 0 0;
    background: var(--color-accent);
    /* 数值变化时高度平滑过渡；这是数据更新不是手势，用 CSS 过渡足够 */
    transition:
        height var(--duration-normal) var(--ease),
        background var(--duration-fast) var(--ease);
}

.stat-bar.is-zero {
    background: var(--glass-border-soft);
}

.stat-bar.is-active {
    background: var(--color-accent-hover);
}

.stat-axis {
    margin-top: var(--space-2);
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-xs);
    min-height: 1.2em;
}

.stat-axis-active {
    color: var(--color-text-secondary);
    font-weight: var(--weight-medium);
}

.stat-axis-total {
    color: var(--color-text-secondary);
}

/* 空状态：虚线框给出「这里本该有数据」的暗示，并附下一步提示 */
.stat-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    border: 1px dashed var(--glass-border-soft);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    text-align: center;
}

.stat-empty-hint {
    font-size: var(--text-xs);
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
</style>
