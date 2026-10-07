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
    <div class="material-thick material-edge card mb-8 mt-12">
        <form class="flex flex-col gap-3 sm:flex-row" @submit.prevent="submit">
            <input
                ref="input"
                v-model="url"
                type="text"
                class="input flex-1"
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
