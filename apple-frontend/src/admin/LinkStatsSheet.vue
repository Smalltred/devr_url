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
    <AppSheet :title="`短链 ${code} 统计`" size="lg" @close="emit('close')">
        <p v-if="stats" class="type-sm -mt-2 mb-5 truncate text-ink-3" :title="stats.url">
            {{ stats.url }}
        </p>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <div v-else-if="loading" class="flex items-center gap-2 type-sm text-ink-3" role="status">
            <span class="spinner" aria-hidden="true" />
            加载中…
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
