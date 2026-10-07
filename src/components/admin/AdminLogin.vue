<script setup>
import { onMounted, ref } from 'vue'
import api from '../../services/entity'

const emit = defineEmits(['logged-in'])

// 首页是否对未登录用户开放。开启「创建短链需要登录」时为 false：
// 此时首页会强制跳回登录页，必须隐藏「返回首页」入口，否则点击即形成往返循环。
const props = defineProps({
    homeAccessible: {
        type: Boolean,
        default: true,
    },
})

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

// autofocus 属性只在页面初始加载时生效，登录页是登录态校验后动态挂载的，需显式聚焦
const usernameInput = ref(null)
onMounted(() => {
    usernameInput.value?.focus()
})

const submit = async () => {
    if (submitting.value || !username.value || !password.value) {
        return
    }
    error.value = ''
    submitting.value = true
    try {
        await api.login(username.value, password.value)
        emit('logged-in')
    } catch (err) {
        error.value = err.isAuthError
            ? '用户名或密码错误'
            : (err.response?.data?.error || err.message || '登录失败，请稍后再试')
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <div class="flex min-h-screen items-center justify-center px-5">
        <form class="glass-strong card w-full max-w-md p-8" @submit.prevent="submit">
            <div class="mb-8 text-center">
                <h1 class="text-2xl font-semibold tracking-tight">Devr · 管理后台</h1>
                <p class="mt-2 text-sm text-ink-2">请输入管理员账号登录</p>
            </div>

            <label class="mb-2 block text-sm font-medium text-ink-2" for="admin-username">用户名</label>
            <input
                id="admin-username"
                ref="usernameInput"
                v-model="username"
                type="text"
                autocomplete="username"
                class="input mb-4"
            />

            <label class="mb-2 block text-sm font-medium text-ink-2" for="admin-password">密码</label>
            <input
                id="admin-password"
                v-model="password"
                type="password"
                autocomplete="current-password"
                class="input mb-5"
            />

            <p v-if="error" class="mb-4 text-sm text-danger">{{ error }}</p>

            <button type="submit" :disabled="submitting" class="btn btn-primary w-full">
                <span v-if="submitting" class="spinner" aria-hidden="true"></span>
                {{ submitting ? '登录中…' : '登 录' }}
            </button>

            <p class="mt-6 text-center text-sm text-ink-3">
                <a v-if="props.homeAccessible" href="/" class="transition-colors hover:text-accent">← 返回首页</a>
                <span v-else>本站已开启登录访问，首页对未登录用户不可见</span>
            </p>
        </form>
    </div>
</template>
