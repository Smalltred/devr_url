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
    <div class="flex min-h-screen items-center justify-center px-6">
        <form
            class="w-full max-w-md rounded-xl border-4 border-black bg-white p-8 font-mono shadow-[8px_8px_0_0_rgba(0,0,0,1)]"
            @submit.prevent="submit"
        >
            <h1 class="mb-1 text-2xl font-bold">devr · 管理后台</h1>
            <p class="mb-6 text-sm text-black/50">请输入管理员账号登录</p>

            <label class="mb-1 block text-sm font-bold" for="admin-username">用户名</label>
            <input
                id="admin-username"
                v-model="username"
                type="text"
                autocomplete="username"
                class="mb-4 w-full rounded-lg border-2 border-black bg-yellow-100/60 px-3 py-2 outline-none focus:bg-yellow-100"
            />

            <label class="mb-1 block text-sm font-bold" for="admin-password">密码</label>
            <input
                id="admin-password"
                v-model="password"
                type="password"
                autocomplete="current-password"
                class="mb-4 w-full rounded-lg border-2 border-black bg-yellow-100/60 px-3 py-2 outline-none focus:bg-yellow-100"
            />

            <p v-if="error" class="mb-4 text-sm text-red-600">{{ error }}</p>

            <button
                type="submit"
                :disabled="submitting"
                class="w-full rounded-lg bg-black px-4 py-3 font-bold text-lg text-yellow-100 border-r-4 border-b-4 border-yellow-500 disabled:opacity-60"
            >
                {{ submitting ? '登录中…' : '登 录' }}
            </button>

            <p class="mt-6 text-center text-xs text-black/40">
                <a href="/" class="hover:text-black">← 返回首页</a>
            </p>
        </form>
    </div>
</template>
