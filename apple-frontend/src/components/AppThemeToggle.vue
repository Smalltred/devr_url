<script setup>
/**
 * 主题切换。
 *
 * 与旧版一致地读写 devr-theme / data-theme，因此新老前端共用同一偏好，
 * 在两个端口之间切换时主题不会跳变。
 */
import { onMounted, ref } from 'vue'

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
        // localStorage 不可用（隐私模式）时仅本次会话生效
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
        <!-- 深色下显示太阳（点击回到浅色），浅色下显示月亮 -->
        <svg v-if="theme === 'dark'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8" />
            <path
                d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
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
