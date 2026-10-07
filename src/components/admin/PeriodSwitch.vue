<script setup>
/**
 * 趋势粒度切换：日 / 周 / 月 / 年。
 * 用 segmented 分段控件（与后台选项卡同一视觉语言）。
 */
defineProps({
    modelValue: {
        type: String,
        default: 'day',
    },
})

defineEmits(['update:modelValue'])

const OPTIONS = [
    { value: 'day', label: '日' },
    { value: 'week', label: '周' },
    { value: 'month', label: '月' },
    { value: 'year', label: '年' },
]
</script>

<template>
    <div class="segmented glass-ctl" role="group" aria-label="趋势粒度">
        <button
            v-for="option in OPTIONS"
            :key="option.value"
            type="button"
            :class="{ active: modelValue === option.value }"
            :aria-pressed="modelValue === option.value"
            @click="$emit('update:modelValue', option.value)"
        >
            {{ option.label }}
        </button>
    </div>
</template>
