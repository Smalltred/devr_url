<script setup>
import { computed } from 'vue'

const props = defineProps({
    // {date: 'YYYY-MM-DD', clicks: number}，按时间升序
    series: {
        type: Array,
        required: true,
    },
    // 粒度：day / week / month / year，决定横轴标签与空状态文案
    period: {
        type: String,
        default: 'day',
    },
    height: {
        type: Number,
        default: 96,
    },
})

const max = computed(() => Math.max(...props.series.map(p => p.clicks), 1))
const totalClicks = computed(() => props.series.reduce((sum, p) => sum + p.clicks, 0))

const periodLabel = computed(
    () => ({ day: '天', week: '周', month: '月', year: '年' })[props.period] || '天',
)

/**
 * 桶起始日 → 横轴/悬浮标签。
 * 越长的粒度展示越粗略，避免窄屏下标签互相挤压。
 */
function formatLabel(date) {
    if (typeof date !== 'string' || date.length < 10) {
        return date || ''
    }
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

function formatTitle(point) {
    return `${formatLabel(point.date)}：${point.clicks} 次点击`
}
</script>

<template>
    <div>
        <!-- 窗口内无任何点击：明确告知，而不是画一片空白 -->
        <div
            v-if="totalClicks === 0"
            class="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-sm text-ink-3"
            :style="{ height: height + 16 + 'px' }"
        >
            <span>该时段内暂无点击</span>
            <span class="text-xs">切换到其他粒度，或等待短链被访问后此处将显示趋势</span>
        </div>

        <template v-else>
            <div class="flex items-end gap-1" :style="{ height: height + 'px' }">
                <div
                    v-for="point in series"
                    :key="point.date"
                    class="group flex h-full flex-1 flex-col items-center justify-end"
                    :title="formatTitle(point)"
                >
                    <!-- 零值桶保留极细的基线，保证网格视觉连续 -->
                    <div
                        class="w-full rounded-t-md transition-all duration-200"
                        :class="point.clicks === 0 ? 'bg-line' : 'bg-accent group-hover:bg-accent-hover'"
                        :style="{ height: point.clicks === 0 ? '2px' : (point.clicks / max) * 100 + '%' }"
                    ></div>
                </div>
            </div>
            <div class="tnum mt-2 flex justify-between text-xs text-ink-3">
                <span>{{ formatLabel(series[0]?.date) }}</span>
                <span class="text-ink-2">按{{ periodLabel }} · 共 {{ totalClicks }} 次</span>
                <span>{{ formatLabel(series[series.length - 1]?.date) }}</span>
            </div>
        </template>
    </div>
</template>
