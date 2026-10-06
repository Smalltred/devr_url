<script setup>
import { ref } from 'vue'
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
</script>

<template>
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6" @click.self="emit('close')">
        <div class="w-full max-w-lg rounded-xl border-4 border-black bg-white p-6 font-mono shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <h2 class="mb-5 text-xl font-bold">编辑短链 /{{ link.code }}</h2>

            <label class="mb-1 block text-sm font-bold" for="edit-code">短码（改动后原短码立即失效）</label>
            <input
                id="edit-code"
                v-model="code"
                type="text"
                class="mb-4 w-full rounded-lg border-2 border-black bg-yellow-100/60 px-3 py-2 outline-none focus:bg-yellow-100"
            />

            <label class="mb-1 block text-sm font-bold" for="edit-url">目标链接</label>
            <input
                id="edit-url"
                v-model="url"
                type="text"
                class="mb-4 w-full rounded-lg border-2 border-black bg-yellow-100/60 px-3 py-2 outline-none focus:bg-yellow-100"
            />

            <p v-if="error" class="mb-4 text-sm text-red-600">{{ error }}</p>

            <div class="flex justify-end gap-3">
                <button
                    type="button"
                    class="rounded-lg border-2 border-black px-4 py-2 font-bold hover:bg-black/5"
                    @click="emit('close')"
                >
                    取消
                </button>
                <button
                    type="button"
                    :disabled="saving"
                    class="rounded-lg bg-black px-4 py-2 font-bold text-yellow-100 border-r-4 border-b-4 border-yellow-500 disabled:opacity-60"
                    @click="save"
                >
                    {{ saving ? '保存中…' : '保存' }}
                </button>
            </div>
        </div>
    </div>
</template>
