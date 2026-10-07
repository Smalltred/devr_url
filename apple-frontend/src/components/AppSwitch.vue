<script setup>
/**
 * 开关：iOS 风格。
 *
 * 视觉状态由 aria-checked 驱动（旧系统亦如此），因此无障碍属性与视觉
 * 天然同步，不会出现「看起来开了但辅助技术说是关的」。
 */
defineProps({
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
    <button
        type="button"
        class="switch"
        role="switch"
        :aria-checked="modelValue ? 'true' : 'false'"
        :aria-label="label || undefined"
        :disabled="disabled"
        @click="emit('update:modelValue', !modelValue)"
    />
</template>

<style scoped>
.switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
    /* 减弱动效：不做滑动，直接切换位置（状态仍然清晰可辨） */
    .switch::after {
        transition: none !important;
    }
}
</style>
