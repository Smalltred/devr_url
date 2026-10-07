<script setup>
/**
 * 趋势粒度切换：日 / 周 / 月 / 年。
 *
 * 复用 AppSegmented，因此选中块由弹簧驱动滑动、可在滑动途中反向，
 * 与后台选项卡保持同一套视觉与交互语言。
 */
import AppSegmented from './AppSegmented.vue'

defineProps({
    modelValue: { type: String, default: 'day' },
})

const emit = defineEmits(['update:modelValue'])

const OPTIONS = [
    { value: 'day', label: '日' },
    { value: 'week', label: '周' },
    { value: 'month', label: '月' },
    { value: 'year', label: '年' },
]
</script>

<template>
    <AppSegmented
        :model-value="modelValue"
        :items="OPTIONS"
        label="趋势粒度"
        mode="group"
        @update:model-value="emit('update:modelValue', $event)"
    />
</template>
