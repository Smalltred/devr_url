<script setup>
/**
 * 确认对话框。
 *
 * 破坏性操作需要确认，但要克制：Apple 的「宽容」原则建议只对真正不可逆的
 * 操作弹确认，频繁打断会训练用户闭眼点过。
 * 焦点默认落在「取消」上，避免回车误触危险操作。
 */
import { onMounted, ref } from 'vue'
import AppButton from '../components/AppButton.vue'
import AppSheet from '../components/AppSheet.vue'

defineProps({
    title: { type: String, default: '确认操作' },
    message: { type: String, required: true },
    confirmText: { type: String, default: '确定' },
    cancelText: { type: String, default: '取消' },
    danger: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'close'])

const cancelBtn = ref(null)

onMounted(() => {
    // 覆盖 AppSheet 的默认聚焦（它聚焦第一个可聚焦元素，可能正是危险按钮）
    cancelBtn.value?.focus?.()
})
</script>

<template>
    <AppSheet size="sm" :title="title" role="alertdialog" @close="emit('close')">
        <p class="type-sm text-ink-2">{{ message }}</p>

        <template #footer>
            <AppButton ref="cancelBtn" variant="secondary" @click="emit('close')">
                {{ cancelText }}
            </AppButton>
            <AppButton :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">
                {{ confirmText }}
            </AppButton>
        </template>
    </AppSheet>
</template>
