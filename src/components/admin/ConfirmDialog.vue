<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
    title: {
        type: String,
        default: '确认操作',
    },
    message: {
        type: String,
        required: true,
    },
    confirmText: {
        type: String,
        default: '确定',
    },
    cancelText: {
        type: String,
        default: '取消',
    },
    // 危险操作时确认按钮显示为红色
    danger: {
        type: Boolean,
        default: false,
    },
})

const emit = defineEmits(['confirm', 'close'])

// 默认聚焦取消按钮，避免危险操作被回车误触发
const cancelBtn = ref(null)

const onKeydown = e => {
    if (e.key === 'Escape') {
        emit('close')
    }
}
onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    cancelBtn.value?.focus()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
    <div class="modal-overlay" @click.self="emit('close')">
        <div class="glass-strong card w-full max-w-md" role="alertdialog" aria-modal="true" :aria-label="title">
            <h2 class="text-lg font-semibold">{{ title }}</h2>
            <p class="mt-2 text-sm text-ink-2">{{ message }}</p>
            <div class="mt-6 flex justify-end gap-3">
                <button ref="cancelBtn" type="button" class="btn btn-secondary" @click="emit('close')">
                    {{ cancelText }}
                </button>
                <button type="button" class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">
                    {{ confirmText }}
                </button>
            </div>
        </div>
    </div>
</template>
