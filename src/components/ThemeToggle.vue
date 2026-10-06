<script setup>
import { onMounted, ref } from 'vue'

// 亮/暗主题切换：写入 <html data-theme> 并持久化到 localStorage（index.html 首帧脚本读取同一键）
const theme = ref('light')

onMounted(() => {
    theme.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
})

function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme.value
    try {
        localStorage.setItem('devr-theme', theme.value)
    } catch {
        // 隐私模式下持久化失败不影响切换
    }
}
</script>

<template>
    <button
        type="button"
        class="btn btn-secondary btn-icon"
        :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
        :title="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
        @click="toggle"
    >
        <svg v-if="theme === 'dark'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8" />
            <path
                d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />
        </svg>
        <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M20.2 14.2A8.5 8.5 0 0 1 9.8 3.8a8.5 8.5 0 1 0 10.4 10.4Z"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
            />
        </svg>
    </button>
</template>
