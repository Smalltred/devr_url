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
        <form class="url-search-form flex flex-col sm:flex-row sm:items-end" @submit.prevent="submit">
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
            <AppButton type="submit" :loading="loading" class="url-submit w-full sm:w-auto">
                {{ loading ? '生成中…' : '生成短链' }}
            </AppButton>
        </form>

        <!-- role=alert 让辅助技术立即播报错误 -->
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
/* 极简下划线：输入区直接落在页面底色上，无卡片、无边框。
   静止时只有文字 + 1px 发丝线；聚焦时 2px 品牌渐变线从中心展开。 */
.url-search-form {
    gap: 18px;
}

.url-line-field {
    --url-line: rgba(26, 35, 56, 0.16);
    --url-fg: #172033;
    --url-muted: #7e8898;
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 4px 12px;
    cursor: text;
}

[data-theme='dark'] .url-line-field {
    --url-line: rgba(233, 237, 244, 0.18);
    --url-fg: #e9edf4;
    --url-muted: #98a2b6;
}

/* 1px 发丝底线 */
.url-line-field::after {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 0;
    height: 1px;
    background: var(--url-line);
}

/* 2px 品牌渐变线：默认从中心收起，聚焦时向两侧展开 */
.url-line-field::before {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 0;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, #3d7bff, #6ea6ff);
    transform: scaleX(0);
    transform-origin: 50% 50%;
    transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

.url-line-field:focus-within::before {
    transform: scaleX(1);
}

/* Lucide link-2：与输入文字间距 10px，聚焦时点亮 */
.url-line-lead {
    width: 18px;
    height: 18px;
    flex: none;
    color: var(--url-muted);
    transition: color 0.25s ease;
}

.url-line-field:focus-within .url-line-lead {
    color: #3d7bff;
}

.url-line-input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--url-fg);
    caret-color: #3d7bff;
    font: inherit;
    font-size: 16px;
}

.url-line-input::placeholder {
    color: var(--url-muted);
    opacity: 1;
    transition: opacity 0.25s ease;
}

.url-line-input:focus::placeholder {
    opacity: 0.5;
}

/* 提交按钮：尺寸、渐变、投影按设计稿固定，不跟随全局按钮样式 */
.url-submit {
    height: 42px;
    min-height: 42px;
    padding: 0 22px;
    border: 0;
    border-radius: 999px;
    background: linear-gradient(180deg, #5490ff, #3b78f6);
    color: #fff;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: 0;
    box-shadow:
        0 1px 2px rgba(15, 23, 42, 0.12),
        0 10px 22px -12px rgba(61, 120, 246, 0.65);
    transition:
        filter 0.2s ease,
        transform 0.16s ease,
        box-shadow 0.25s ease;
}

.url-submit:hover:not(:disabled) {
    filter: brightness(1.06);
    background: linear-gradient(180deg, #5490ff, #3b78f6);
}

.url-submit:active:not(:disabled),
.url-submit.is-pressed:not(:disabled) {
    transform: scale(0.965);
}

/* 减弱动效：不播放展开动画，直接显示/隐藏渐变线 */
@media (prefers-reduced-motion: reduce) {
    .url-line-field::before,
    .url-line-lead,
    .url-line-input::placeholder {
        transition: none;
    }
}
</style>
