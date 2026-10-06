<script setup>
defineProps({
    // {date: 'YYYY-MM-DD', clicks: number}
    series: {
        type: Array,
        required: true,
    },
    height: {
        type: Number,
        default: 96,
    },
})
</script>

<template>
    <div>
        <div class="flex items-end gap-1" :style="{ height: height + 'px' }">
            <div
                v-for="point in series"
                :key="point.date"
                class="group flex flex-1 flex-col items-center justify-end"
                :title="`${point.date}：${point.clicks} 次点击`"
            >
                <div
                    class="w-full rounded-t-md transition-all duration-200"
                    :class="point.clicks === 0 ? 'bg-line' : 'bg-accent group-hover:bg-accent-hover'"
                    :style="{ height: (Math.max(point.clicks, 0) / Math.max(...series.map(p => p.clicks), 1)) * 100 + '%' }"
                ></div>
            </div>
        </div>
        <div class="tnum mt-2 flex justify-between text-xs text-ink-3">
            <span>{{ series[0]?.date?.slice(5) }}</span>
            <span>{{ series[series.length - 1]?.date?.slice(5) }}</span>
        </div>
    </div>
</template>
