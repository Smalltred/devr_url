<script setup>
/**
 * 结果卡片：短链、二维码、复制与下载。
 *
 * 改动要点：
 *   1. 「已复制」用 role=status + aria-live，辅助技术能读到（旧实现读不到）
 *   2. 二维码 alt 描述用途而非只写 "QRCode"
 *   3. 卡片入场用弹簧从下方浮起，替代旧的固定时长过渡
 */
import { onUnmounted, ref, watch } from 'vue'
import copy from 'copy-to-clipboard'
import { saveAs } from 'file-saver'
import AppButton from '../components/AppButton.vue'
import { createSpring, createTween } from '../motion/spring.js'
import { useShortUrl } from '../stores/shortUrl.js'

const { entity } = useShortUrl()

const card = ref(null)
const showCopied = ref(false)
let copiedTimer = null

watch(entity, (next) => {
    if (!next || !card.value) return

    const el = card.value
    // 卡片到场：轻微上浮，临界阻尼无过冲（不是手势带来的惯性，不该回弹）
    createSpring({
        from: 14,
        to: 0,
        response: 0.4,
        damping: 1,
        onUpdate: (y) => {
            el.style.transform = `translateY(${y}px)`
        },
    })
    createTween({
        from: 0,
        to: 1,
        duration: 0.24,
        onUpdate: (o) => {
            el.style.opacity = String(o)
        },
    })
})

onUnmounted(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
})

function handleCopy() {
    if (!entity.value) return
    copy(entity.value.shortUrl)
    showCopied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
        showCopied.value = false
    }, 3000)
}

/**
 * data:image/png;base64,... → Blob。
 *
 * 之前用 fetch(dataUrl) 取 Blob，会被 CSP 的 connect-src 'self' 拦截
 * （fetch 对 data: URL 也走 connect-src），导致「下载二维码」报
 * TypeError: Failed to fetch。这里直接在本地解码，不发起任何请求。
 */
function qrDataUrlToBlob(dataUrl) {
    const [header, payload] = String(dataUrl).split(',')
    if (!payload) throw new Error('二维码数据无效')

    const mime = /^data:([^;]+)/i.exec(header)?.[1] || 'image/png'
    const binary = /;base64/i.test(header)
        ? atob(payload)
        : decodeURIComponent(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }

    return new Blob([bytes], { type: mime })
}

function handleDownload() {
    if (!entity.value) return
    saveAs(qrDataUrlToBlob(entity.value.qrcode), `QRCode_${entity.value.code}.png`)
}
</script>

<template>
    <div v-if="entity" ref="card" class="material-regular card">
        <div class="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <!-- 二维码保持白底，深色模式下也可扫描 -->
            <img
                :src="entity.qrcode"
                class="h-40 w-40 shrink-0 rounded-xl border border-line bg-white p-2"
                alt="短链接二维码，可扫码打开"
                width="160"
                height="160"
            />

            <div class="w-full min-w-0 flex-1">
                <p class="flex items-baseline text-lg font-semibold">
                    <span class="shrink-0">短链接：</span>
                    <a
                        class="link min-w-0 truncate"
                        :href="entity.shortUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                    >{{ entity.shortUrl }}</a>
                </p>

                <p class="mt-2 flex items-baseline text-sm text-ink-2">
                    <span class="shrink-0">原链接：</span>
                    <a
                        class="link min-w-0 truncate"
                        style="color: inherit"
                        :href="entity.originUrl"
                        :title="entity.originUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                    >{{ entity.originUrl }}</a>
                </p>

                <div class="mt-6 flex flex-wrap items-center gap-3">
                    <AppButton @click="handleCopy">复制短链接</AppButton>
                    <AppButton variant="secondary" @click="handleDownload">下载二维码</AppButton>

                    <span v-if="showCopied" class="chip chip-success" role="status" aria-live="polite">
                        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.6" />
                            <path
                                d="M6 10.5l2.5 2.5L14 7.5"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                        已复制
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>
