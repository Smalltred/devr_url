<script setup>
/**
 * 按钮原语。
 *
 * 响应感原则：反馈在 pointerdown 那一刻就出现，不等 click。
 * 按下即缩小，松开才触发动作；用户把指针拖走后松开则取消。
 */
import { ref } from 'vue'

const props = defineProps({
    variant: { type: String, default: 'primary' }, // primary | secondary | ghost | danger | tinted
    size: { type: String, default: 'md' }, // md | sm | icon
    type: { type: String, default: 'button' },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    block: { type: Boolean, default: false },
})

defineEmits(['click'])

const root = ref(null)

// 供父组件把焦点交给本按钮（如确认框默认聚焦「取消」）
defineExpose({
    focus: () => root.value?.focus(),
})

// 按下态：pointerdown 立刻置位，用于手势期间的即时视觉反馈
const pressed = ref(false)

function onPointerDown() {
    if (props.disabled || props.loading) return
    pressed.value = true
}

function onPointerUp() {
    pressed.value = false
}

function onPointerLeave() {
    pressed.value = false
}
</script>

<template>
    <button
        ref="root"
        :type="type"
        class="btn"
        :class="[
            `btn-${variant}`,
            size !== 'md' ? `btn-${size}` : '',
            block ? 'w-full' : '',
            pressed ? 'is-pressed' : '',
        ]"
        :disabled="disabled || loading"
        :aria-busy="loading ? 'true' : undefined"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @pointercancel="onPointerLeave"
        @click="$emit('click', $event)"
    >
        <span v-if="loading" class="btn-spinner" aria-hidden="true"></span>
        <slot />
    </button>
</template>

<style scoped>
.btn-spinner {
    display: inline-block;
    width: 1em;
    height: 1em;
    flex-shrink: 0;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-right-color: currentColor;
    border-radius: 50%;
    animation: btn-spin 0.7s linear infinite;
}

@keyframes btn-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .btn-spinner {
        animation-duration: 1.6s;
    }
}
</style>
