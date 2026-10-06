<script setup>
import { ref } from 'vue'
import api from '../../services/entity'

const emit = defineEmits(['logged-in'])

const username = ref('admin')
const password = ref('')
const error = ref('')
const submitting = ref(false)

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
                <a href="/" class="transition-colors hover:text-accent">← 返回首页</a>
            </p>
        </form>
    </div>
</template>
