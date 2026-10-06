<script setup>
import { ref } from 'vue'
import Button from './Button.vue'
import Error from './Error.vue'
import { useShortUrl } from '../stores/shortUrl'

const { generate } = useShortUrl()
const url = ref('')

// 处理生成事件；仅当 URL 格式合法时清空输入框（与原版一致）
const handleClick = async () => {
    if (await generate(url.value)) {
        url.value = ''
    }
}
</script>

<template>
    <div class="glass-strong card mb-8 mt-12">
        <div class="flex flex-col gap-3 sm:flex-row">
            <input
                v-model="url"
                class="input flex-1"
                placeholder="请输入 http:// 或 https:// 开头的网址"
                aria-label="原始网址"
                @keyup.enter="handleClick"
            />
            <Button label="生成短链" class="w-full sm:w-auto" @click="handleClick" />
        </div>
        <Error />
    </div>
</template>
