<script setup>
/**
 * 搜索表单。
 *
 * 相比旧实现的改动：
 *   1. 用真实 <form>，回车与按钮走同一条提交路径（旧实现没有 form，
 *      只有 keyup.enter 与 click 两条独立路径）
 *   2. 请求期间按钮进入 loading 并禁用，防重复提交（旧实现没有）
 *   3. 错误用 role=alert 播报
 */
import { ref } from 'vue'
import AppButton from '../components/AppButton.vue'
import { useShortUrl } from '../stores/shortUrl.js'

const url = ref('')
const { error, loading, generate } = useShortUrl()

const input = ref(null)

async function submit() {
    if (loading.value) return

    const ok = await generate(url.value)
    // 只有成功发出请求才清空输入，格式错误时保留用户输入便于修改
    if (ok) {
        url.value = ''
        input.value?.focus()
    }
}
</script>

<template>
    <div class="mb-8 mt-12">
        <form class="flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="submit">
            <input
                ref="input"
                v-model="url"
                type="text"
                class="url-line-input w-full sm:flex-1"
                placeholder="请输入 http:// 或 https:// 开头的网址"
                aria-label="原始网址"
                autocomplete="url"
                spellcheck="false"
            />
            <AppButton type="submit" :loading="loading" class="w-full sm:w-auto">
                {{ loading ? '生成中…' : '生成短链' }}
            </AppButton>
        </form>

        <!-- role=alert 让辅助技术立即播报错误 -->
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
/* 首页输入框采用「下划线」形态：无卡片底、无圆角，
   默认灰色细线，悬停/聚焦时变为强调色粗线。
   用 inset 阴影叠加第二像素，避免改变边框宽度导致文字上下跳动。 */
.url-line-input {
    width: 100%;
    height: 64px;
    padding: 0 2px 10px;
    color: var(--color-text);
    background: transparent;
    border: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.45);
    border-radius: 0;
    outline: none;
    appearance: none;
    font-family: inherit;
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-base);
    transition:
        border-color var(--duration-fast) var(--ease),
        box-shadow var(--duration-fast) var(--ease);
}

.url-line-input::placeholder {
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-sm);
}

.url-line-input:hover,
.url-line-input:focus {
    border-bottom-color: var(--color-accent);
    box-shadow: inset 0 -1px 0 var(--color-accent);
}

/* 下划线本身就是焦点指示，去掉全局 focus-visible 的矩形描边 */
.url-line-input:focus-visible {
    outline: none;
}

@media (max-width: 640px) {
    .url-line-input {
        height: 56px;
        padding-bottom: 8px;
        /* 防止 iOS 聚焦自动缩放 */
        font-size: 16px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .url-line-input {
        transition: none;
    }
}
</style>
