<script setup>
/**
 * 编辑短链弹窗（可下滑关闭的表单面板）。
 */
import { ref } from 'vue'
import api, { errorMessage } from '../services/entity.js'
import AppButton from '../components/AppButton.vue'
import AppSheet from '../components/AppSheet.vue'

const props = defineProps({
    /** @type {{code: string, url: string}} */
    link: { type: Object, required: true },
})

const emit = defineEmits(['close', 'saved'])

const code = ref(props.link.code)
const url = ref(props.link.url)
const error = ref('')
const saving = ref(false)

async function save() {
    if (saving.value) return

    error.value = ''
    saving.value = true
    try {
        // 路径参数用原短码，请求体带新短码
        await api.updateLink(props.link.code, { code: code.value, url: url.value })
        emit('saved')
    } catch (err) {
        error.value = errorMessage(err, '保存失败')
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <AppSheet :title="`编辑短链 ${link.code}`" @close="emit('close')">
        <form id="edit-link-form" @submit.prevent="save">
            <label class="field-label" for="edit-code">短码（改动后原短码立即失效）</label>
            <input
                id="edit-code"
                v-model="code"
                type="text"
                class="input mb-4"
                spellcheck="false"
                autocomplete="off"
            />

            <label class="field-label" for="edit-url">目标链接</label>
            <input
                id="edit-url"
                v-model="url"
                type="text"
                class="input mb-4"
                spellcheck="false"
                autocomplete="off"
            />

            <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        </form>

        <template #footer>
            <AppButton variant="secondary" @click="emit('close')">取消</AppButton>
            <AppButton type="submit" form="edit-link-form" :loading="saving">
                {{ saving ? '保存中…' : '保存' }}
            </AppButton>
        </template>
    </AppSheet>
</template>
