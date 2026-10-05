<script setup>
import { ref, onUnmounted } from 'vue'
import copy from 'copy-to-clipboard'
import { saveAs } from 'file-saver'
import Button from './Button.vue'
import { useShortUrl } from '../stores/shortUrl'

const { entity } = useShortUrl()
const showCopied = ref(false)
let copiedTimer = null

// 下载二维码事件
const handleDownload = async () => {
    const res = await fetch(entity.value.qrcode)
    const blob = await res.blob()
    saveAs(blob, `QRCode_${entity.value.code}.png`)
}

// 复制短链接事件
const handleCopy = () => {
    copy(entity.value.shortUrl)
    showCopied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
        showCopied.value = false
    }, 3000)
}

onUnmounted(() => clearTimeout(copiedTimer))
</script>

<template>
    <div v-if="entity" class="flex">
        <img class="w-40 h-40 mr-10 rounded-lg" :src="entity.qrcode" alt="QRCode" />
        <div class="flex-1 relative">
            <p class="font-bold text-xl font-mono">
                短链接：<a class="underline" :href="entity.shortUrl" target="_blank" rel="noopener noreferrer">{{ entity.shortUrl }}</a>
            </p>
            <p class="mt-4 text-xl font-mono font-light">
                原链接：<a class="underline" :href="entity.originUrl" target="_blank" rel="noopener noreferrer">{{ entity.originUrl }}</a>
            </p>
            <div class="absolute left-0 bottom-0">
                <div class="inline-block mr-3">
                    <Button label="下载二维码" @click="handleDownload" />
                </div>
                <div class="inline-block mr-5">
                    <Button label="复制短链接" @click="handleCopy" />
                </div>
                <div v-if="showCopied" class="inline-block h-5 leading-5 font-mono">
                    <svg class="inline-block w-5 h-5 mr-1 align-top" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17 9L9.99998 16L6.99994 13M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 16.9706 21 12Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    已复制
                </div>
            </div>
        </div>
    </div>
</template>
