<script setup>
/**
 * 轻提示。
 *
 * 无障碍：role=status + aria-live=polite，屏幕阅读器会播报但不打断。
 * 旧实现只有一个视觉 div，辅助技术读不到。
 */
import { onUnmounted, watch, ref } from 'vue'
import { createSpring, createTween, prefersReducedMotion } from '../motion/spring.js'

const props = defineProps({
    message: { type: String, default: '' },
    duration: { type: Number, default: 3000 },
})

const emit = defineEmits(['expire'])

const host = ref(null)
let hideTimer = null

watch(() => props.message, (next) => {
    if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
    }
    if (!next) return

    if (host.value) {
        // 入场：从下方浮起；用弹簧而非固定时长过渡
        const el = host.value
        createSpring({
            from: 12,
            to: 0,
            response: 0.34,
            damping: 1,
            onUpdate: (y) => {
                el.style.transform = `translate(-50%, ${y}px)`
            },
        })
        createTween({
            from: 0,
            to: 1,
            duration: 0.22,
            onUpdate: (o) => {
                el.style.opacity = String(o)
            },
        })
    }

    hideTimer = window.setTimeout(() => {
        hideTimer = null
        // 交由父组件清空 message，保持单向数据流
        emit('expire')
    }, props.duration)
})

onUnmounted(() => {
    if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
    <Transition name="toast-fade">
        <div
            v-if="message"
            ref="host"
            class="toast"
            role="status"
            aria-live="polite"
        >
            {{ message }}
        </div>
    </Transition>
</template>

<style scoped>
.toast {
    position: fixed;
    left: 50%;
    bottom: var(--space-6);
    z-index: 50;
    transform: translate(-50%, 0);
    background: var(--color-text);
    color: var(--color-bg);
    border-radius: var(--radius-pill);
    padding: 10px 18px;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-sm);
    box-shadow: var(--shadow-lg);
    max-width: calc(100vw - 2 * var(--page-padding));
    text-align: center;
}

/* 只做透明度过渡；位移由弹簧驱动（见 script），避免两者打架 */
.toast-fade-enter-active,
.toast-fade-leave-active {
    transition: opacity 0.18s var(--ease);
}

.toast-fade-enter-from,
.toast-fade-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .toast {
        transform: translate(-50%, 0) !important;
    }
}
</style>
