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
    <div class="mb-10">
        <div class="flex">
            <input
                v-model="url"
                class="outline-none flex-1 mr-4 px-5 py-3 rounded-lg font-mono text-lg text-black bg-yellow-100 bg-opacity-80 placeholder-yellow-900 placeholder-opacity-30"
                placeholder="请输入 http:// 或 https:// 开头的网址"
                @keyup.enter="handleClick"
            />
            <Button label=")缩(" @click="handleClick" />
        </div>
        <Error />
    </div>
</template>
