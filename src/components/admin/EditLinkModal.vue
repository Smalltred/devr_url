<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import api from '../../services/entity'

const props = defineProps({
    // 待编辑的短链 {code, url}
    link: {
        type: Object,
        required: true,
    },
})

const emit = defineEmits(['close', 'saved'])

const code = ref(props.link.code)
const url = ref(props.link.url)
const error = ref('')
const saving = ref(false)

const save = async () => {
    if (saving.value) {
        return
    }
    error.value = ''
    saving.value = true
    try {
        await api.updateLink(props.link.code, { code: code.value, url: url.value })
        emit('saved')
    } catch (err) {
        error.value = err.response?.data?.error || err.message || '保存失败'
    } finally {
        saving.value = false
    }
}

// Escape 关闭弹窗
const onKeydown = e => {
    if (e.key === 'Escape') {
        emit('close')
    }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
    <div class="modal-overlay" @click.self="emit('close')">
        <div class="glass-strong card w-full max-w-lg" role="dialog" aria-modal="true">
            <h2 class="mb-5 text-lg font-semibold">编辑短链 /{{ link.code }}</h2>

            <label class="mb-2 block text-sm font-medium text-ink-2" for="edit-code">短码（改动后原短码立即失效）</label>
            <input id="edit-code" v-model="code" type="text" class="input mb-4" />

            <label class="mb-2 block text-sm font-medium text-ink-2" for="edit-url">目标链接</label>
            <input id="edit-url" v-model="url" type="text" class="input mb-4" />

            <p v-if="error" class="mb-4 text-sm text-danger">{{ error }}</p>

            <div class="flex justify-end gap-3">
                <button type="button" class="btn btn-secondary" @click="emit('close')">取消</button>
                <button type="button" :disabled="saving" class="btn btn-primary" @click="save">
                    {{ saving ? '保存中…' : '保存' }}
                </button>
            </div>
        </div>
    </div>
</template>
