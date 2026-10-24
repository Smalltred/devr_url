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
            <label class="url-line-field w-full sm:flex-1">
                <!-- 链接图标：聚焦时与下划线一起变为品牌色 -->
                <svg
                    class="url-line-lead"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
                    <line x1="8" x2="16" y1="12" y2="12" />
                </svg>
                <input
                    ref="input"
                    v-model="url"
                    type="text"
                    class="url-line-input"
                    placeholder="请输入 http:// 或 https:// 开头的网址"
                    aria-label="原始网址"
                    autocomplete="url"
                    spellcheck="false"
                />
            </label>
            <AppButton type="submit" :loading="loading" class="w-full sm:w-auto">
                {{ loading ? '生成中…' : '生成短链' }}
            </AppButton>
        </form>

        <!-- role=alert 让辅助技术立即播报错误 -->
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
/* 极简下划线：无卡片底、无圆角，只保留一条发丝线。
   聚焦时由中心向两侧展开 2px 品牌色渐变线（可中断的 transform 动画），
   并让链接图标同步变为品牌色。 */
.url-line-field {
    --url-line: rgba(26, 35, 56, 0.16);
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 4px 14px;
    cursor: text;
}

[data-theme='dark'] .url-line-field {
    --url-line: rgba(233, 237, 244, 0.18);
}

/* 默认发丝线 */
.url-line-field::after {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 0;
    height: 1px;
    background: var(--url-line);
}

/* 聚焦时展开的品牌色渐变线：从中心向两侧展开 */
.url-line-field::before {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 0;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--color-accent), var(--color-accent-hover));
    transform: scaleX(0);
    transform-origin: 50% 50%;
    transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 悬停或聚焦时展开品牌色渐变线；聚焦时图标与占位提示再进一步响应 */
.url-line-field:hover::before,
.url-line-field:focus-within::before {
    transform: scaleX(1);
}

.url-line-lead {
    width: 18px;
    height: 18px;
    flex: none;
    color: var(--color-text-tertiary);
    transition: color 0.25s ease;
}

.url-line-field:focus-within .url-line-lead {
    color: var(--color-accent);
}

.url-line-input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text);
    caret-color: var(--color-accent);
    font: inherit;
    font-size: 16px;
    letter-spacing: var(--tracking-base);
}

.url-line-input::placeholder {
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-sm);
    opacity: 1;
    transition: opacity 0.25s ease;
}

/* 聚焦时弱化占位提示，把注意力让给输入内容 */
.url-line-input:focus::placeholder {
    opacity: 0.5;
}

/* 下划线本身就是焦点指示，去掉全局 focus-visible 的矩形描边 */
.url-line-input:focus-visible {
    outline: none;
}

@media (max-width: 640px) {
    .url-line-field {
        padding-bottom: 12px;
    }

    /* 防止 iOS 聚焦自动缩放 */
    .url-line-input {
        font-size: 16px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .url-line-field::before,
    .url-line-lead,
    .url-line-input::placeholder {
        transition: none;
    }
}
</style>
