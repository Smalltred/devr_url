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
    <transition name="pop">
        <div v-if="entity" class="glass card">
            <div class="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                <!-- 二维码始终保持白底，保证深色模式下可扫码 -->
                <img
                    class="h-40 w-40 shrink-0 rounded-xl border border-line bg-white p-2"
                    :src="entity.qrcode"
                    alt="QRCode"
                />
                <div class="w-full min-w-0 flex-1">
                    <p class="break-all text-lg font-semibold">
                        短链接：<a
                            class="text-accent transition-colors hover:text-accent-hover"
                            :href="entity.shortUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                        >{{ entity.shortUrl }}</a>
                    </p>
                    <p class="mt-2 break-all text-sm text-ink-2">
                        原链接：<a
                            class="transition-colors hover:text-accent"
                            :href="entity.originUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                        >{{ entity.originUrl }}</a>
                    </p>
                    <div class="mt-6 flex flex-wrap items-center gap-3">
                        <Button label="复制短链接" @click="handleCopy" />
                        <Button label="下载二维码" variant="secondary" @click="handleDownload" />
                        <span v-if="showCopied" class="chip chip-success">
                            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
                                <path d="M16.5 9.5 11 15l-2.5-2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            已复制
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>
