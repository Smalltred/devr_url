<script setup>
import { onMounted, ref } from 'vue'
import api from '../../services/entity'
import StatBars from './StatBars.vue'

const props = defineProps({
    code: {
        type: String,
        required: true,
    },
})

const emit = defineEmits(['close'])

const stats = ref(null)
const error = ref('')

onMounted(async () => {
    try {
        stats.value = await api.fetchLinkStats(props.code)
    } catch (err) {
        error.value = err.response?.data?.error || err.message || '统计加载失败'
    }
})
</script>

<template>
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6" @click.self="emit('close')">
        <div class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border-4 border-black bg-white p-6 font-mono shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <div class="mb-5 flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <h2 class="text-xl font-bold">短链 /{{ code }} 统计</h2>
                    <p class="mt-1 truncate text-sm text-black/50" :title="stats?.url">{{ stats?.url }}</p>
                </div>
                <button
                    type="button"
                    class="shrink-0 rounded-lg border-2 border-black px-3 py-1 text-sm font-bold hover:bg-black/5"
                    @click="emit('close')"
                >
                    关闭
                </button>
            </div>

            <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
            <p v-else-if="!stats" class="text-sm text-black/50">加载中…</p>

            <template v-else>
                <div class="mb-6 grid grid-cols-3 gap-3 text-center">
                    <div class="rounded-lg border-2 border-black p-3">
                        <div class="text-2xl font-bold">{{ stats.total_clicks }}</div>
                        <div class="text-xs text-black/50">总点击</div>
                    </div>
                    <div class="rounded-lg border-2 border-black p-3">
                        <div class="text-2xl font-bold">{{ stats.clicks_today }}</div>
                        <div class="text-xs text-black/50">今日点击</div>
                    </div>
                    <div class="rounded-lg border-2 border-black p-3">
                        <div class="text-2xl font-bold">{{ stats.visitors }}</div>
                        <div class="text-xs text-black/50">独立访客</div>
                    </div>
                </div>

                <h3 class="mb-2 text-sm font-bold">近 14 天趋势（UTC 日切）</h3>
                <StatBars :series="stats.daily" class="mb-6" />

                <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div>
                        <h3 class="mb-2 text-sm font-bold">来源域名 Top 10</h3>
                        <p v-if="stats.referers.length === 0" class="text-sm text-black/40">暂无来源记录</p>
                        <ul v-else class="space-y-1 text-sm">
                            <li v-for="ref in stats.referers" :key="ref.referer_host" class="flex justify-between gap-2 border-b border-black/10 pb-1">
                                <span class="truncate">{{ ref.referer_host }}</span>
                                <span class="shrink-0 font-bold">{{ ref.clicks }}</span>
                            </li>
                        </ul>
                    </div>
                    <div>
                        <h3 class="mb-2 text-sm font-bold">设备分布</h3>
                        <div class="space-y-2 text-sm">
                            <div class="flex items-center gap-2">
                                <span class="w-14 shrink-0">桌面</span>
                                <div class="h-4 flex-1 rounded bg-black/10">
                                    <div
                                        class="h-4 rounded bg-black"
                                        :style="{ width: (stats.devices.desktop / Math.max(stats.devices.desktop + stats.devices.mobile, 1)) * 100 + '%' }"
                                    ></div>
                                </div>
                                <span class="w-10 shrink-0 text-right font-bold">{{ stats.devices.desktop }}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="w-14 shrink-0">移动</span>
                                <div class="h-4 flex-1 rounded bg-black/10">
                                    <div
                                        class="h-4 rounded bg-black"
                                        :style="{ width: (stats.devices.mobile / Math.max(stats.devices.desktop + stats.devices.mobile, 1)) * 100 + '%' }"
                                    ></div>
                                </div>
                                <span class="w-10 shrink-0 text-right font-bold">{{ stats.devices.mobile }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
