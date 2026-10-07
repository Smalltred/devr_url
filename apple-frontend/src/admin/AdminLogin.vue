<script setup>
/**
 * 管理后台登录页。
 *
 * 旧实现把管理员账号预填为 'admin'：既会误导（该值可能已被 ADMIN_USERNAME
 * 改掉），也等于把账号名告诉访问者。这里保持为空。
 */
import { onMounted, ref } from 'vue'
import api, { errorMessage } from '../services/entity.js'
import AppButton from '../components/AppButton.vue'

const props = defineProps({
    homeAccessible: { type: Boolean, default: true },
})

const emit = defineEmits(['logged-in'])

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

const usernameInput = ref(null)

onMounted(() => {
    // autofocus 属性只在页面初始加载时生效；本组件是登录态校验后动态挂载的，
    // 必须显式聚焦
    usernameInput.value?.focus()
})

async function submit() {
    if (submitting.value || !username.value || !password.value) return

    error.value = ''
    submitting.value = true
    try {
        await api.login(username.value, password.value)
        emit('logged-in')
    } catch (err) {
        error.value = err.isAuthError
            ? '用户名或密码错误'
            : errorMessage(err, '登录失败，请稍后再试')
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <div class="flex min-h-screen items-center justify-center px-5">
        <form
            class="material-thick material-edge card w-full max-w-md p-8"
            @submit.prevent="submit"
        >
            <div class="mb-8 text-center">
                <h1 class="type-2xl">Devr · 管理后台</h1>
                <p class="type-sm mt-2 text-ink-2">请输入管理员账号登录</p>
            </div>

            <label class="field-label" for="admin-username">用户名</label>
            <input
                id="admin-username"
                ref="usernameInput"
                v-model="username"
                type="text"
                class="input mb-4"
                autocomplete="username"
                :aria-invalid="error ? 'true' : undefined"
            />

            <label class="field-label" for="admin-password">密码</label>
            <input
                id="admin-password"
                v-model="password"
                type="password"
                class="input mb-5"
                autocomplete="current-password"
                :aria-invalid="error ? 'true' : undefined"
            />

            <p v-if="error" class="field-error mb-4" role="alert">{{ error }}</p>

            <AppButton type="submit" :loading="submitting" block>
                {{ submitting ? '登录中…' : '登 录' }}
            </AppButton>

            <p class="type-sm mt-6 text-center text-ink-3">
                <a v-if="props.homeAccessible" href="/" class="link">← 返回首页</a>
                <span v-else>本站已开启登录访问，首页对未登录用户不可见</span>
            </p>
        </form>
    </div>
</template>
