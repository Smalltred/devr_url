<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import api from '../../services/entity'
import StatBars from './StatBars.vue'
import PeriodSwitch from './PeriodSwitch.vue'

const props = defineProps({
    code: {
        type: String,
        required: true,
    },
})

const emit = defineEmits(['close'])

const stats = ref(null)
const error = ref('')
const period = ref('day')
const periodLoading = ref(false)

onMounted(async () => {
    try {
        stats.value = await api.fetchLinkStats(props.code, period.value)
    } catch (err) {
        error.value = err.response?.data?.error || err.message || '统计加载失败'
    }
})

// 切换粒度：只重拉当前短链的统计
async function onPeriodChange(value) {
    period.value = value
    periodLoading.value = true
    try {
        stats.value = await api.fetchLinkStats(props.code, value)
    } catch (err) {
        error.value = err.response?.data?.error || err.message || '趋势加载失败'
    } finally {
        periodLoading.value = false
    }
}

// Escape 关闭弹窗
const onKeydown = e => {
    if (e.key === 'Escape') {
        emit('close')
    }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
    <div class="modal-overlay" @click.self="emit('close')">
        <div
            class="glass-strong card max-h-[85vh] w-full max-w-2xl overflow-y-auto"
            role="dialog"
            aria-modal="true"
        >
            <div class="mb-5 flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <h2 class="text-lg font-semibold">短链 /{{ code }} 统计</h2>
                    <p class="mt-1 truncate text-sm text-ink-3" :title="stats?.url">{{ stats?.url }}</p>
                </div>
                <button type="button" class="btn btn-secondary btn-sm shrink-0" @click="emit('close')">关闭</button>
            </div>

            <p v-if="error" class="text-sm text-danger">{{ error }}</p>
            <p v-else-if="!stats" class="animate-pulse text-sm text-ink-3">加载中…</p>

            <template v-else>
                <div class="mb-6 grid grid-cols-3 gap-3 text-center">
                    <div class="stat-tile">
                        <div class="tnum text-2xl font-semibold">{{ stats.total_clicks }}</div>
                        <div class="mt-1 text-xs text-ink-3">总点击</div>
                    </div>
                    <div class="stat-tile">
                        <div class="tnum text-2xl font-semibold">{{ stats.clicks_today }}</div>
                        <div class="mt-1 text-xs text-ink-3">今日点击</div>
                    </div>
                    <div class="stat-tile">
                        <div class="tnum text-2xl font-semibold">{{ stats.visitors }}</div>
                        <div class="mt-1 text-xs text-ink-3">独立访客</div>
                    </div>
                </div>

                <h3 class="mb-2 text-sm font-semibold">点击趋势（UTC 口径）</h3>
                <div class="mb-3">
                    <PeriodSwitch :model-value="period" @update:model-value="onPeriodChange" />
                </div>
                <div :class="[periodLoading ? 'opacity-60' : '', 'mb-6 transition-opacity']">
                    <StatBars :series="stats.daily" :period="stats.period || period" />
                </div>

                <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div>
                        <h3 class="mb-2 text-sm font-semibold">来源域名 Top 10</h3>
                        <p v-if="stats.referers.length === 0" class="text-sm text-ink-3">暂无来源记录</p>
                        <ul v-else class="space-y-2 text-sm">
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
                    <div>
                        <h3 class="mb-2 text-sm font-semibold">设备分布</h3>
                        <div class="space-y-3 text-sm">
                            <div class="flex items-center gap-3">
                                <span class="w-10 shrink-0 text-ink-2">桌面</span>
                                <div class="h-2.5 flex-1 rounded-full bg-line">
                                    <div
                                        class="h-2.5 rounded-full bg-accent"
                                        :style="{ width: (stats.devices.desktop / Math.max(stats.devices.desktop + stats.devices.mobile, 1)) * 100 + '%' }"
                                    ></div>
                                </div>
                                <span class="tnum w-10 shrink-0 text-right font-semibold">{{ stats.devices.desktop }}</span>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="w-10 shrink-0 text-ink-2">移动</span>
                                <div class="h-2.5 flex-1 rounded-full bg-line">
                                    <div
                                        class="h-2.5 rounded-full bg-accent"
                                        :style="{ width: (stats.devices.mobile / Math.max(stats.devices.desktop + stats.devices.mobile, 1)) * 100 + '%' }"
                                    ></div>
                                </div>
                                <span class="tnum w-10 shrink-0 text-right font-semibold">{{ stats.devices.mobile }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
