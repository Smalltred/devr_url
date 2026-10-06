<script setup>
import { onMounted, ref } from 'vue'
import copy from 'copy-to-clipboard'
import api from '../../services/entity'

const emit = defineEmits(['password-changed', 'notice'])

// 短链设置
const codeMinLength = ref(1)
const codeRandom = ref(false)
const requireLogin = ref(false)
const passwordSource = ref('env')
const settingsError = ref('')
const savingSettings = ref(false)

// 修改密码
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const savingPassword = ref(false)

// API Keys
const keys = ref([])
const newKeyName = ref('')
const freshKey = ref(null) // {id, name, key} 明文仅此一次展示
const keysError = ref('')
const creatingKey = ref(false)

onMounted(async () => {
    try {
        applySettings(await api.fetchSettings())
    } catch (err) {
        settingsError.value = err.response?.data?.error || err.message || '设置加载失败'
    }
    await loadKeys()
})

function applySettings(data) {
    codeMinLength.value = data.code_min_length
    codeRandom.value = Boolean(data.code_random)
    requireLogin.value = Boolean(data.require_login)
    passwordSource.value = data.password_source || 'env'
}

async function loadKeys() {
    try {
        keys.value = await api.fetchKeys()
    } catch {
        keysError.value = keysError.value || 'Key 列表加载失败'
    }
}

async function saveSettings() {
    if (savingSettings.value) {
        return
    }
    settingsError.value = ''
    savingSettings.value = true
    try {
        applySettings(
            await api.updateSettings({
                code_min_length: Number(codeMinLength.value),
                code_random: codeRandom.value,
                require_login: requireLogin.value,
            }),
        )
        emit('notice', '设置已保存')
    } catch (err) {
        settingsError.value = err.response?.data?.error || err.message || '保存失败'
    } finally {
        savingSettings.value = false
    }
}

async function changePassword() {
    if (savingPassword.value) {
        return
    }
    passwordError.value = ''
    if (!currentPassword.value || !newPassword.value) {
        passwordError.value = '请填写当前密码与新密码'
        return
    }
    if (newPassword.value.length < 8) {
        passwordError.value = '新密码至少需要 8 位'
        return
    }
    if (newPassword.value !== confirmPassword.value) {
        passwordError.value = '两次输入的新密码不一致'
        return
    }

    savingPassword.value = true
    try {
        await api.changePassword(currentPassword.value, newPassword.value)
        emit('notice', '密码已修改，请重新登录')
        // 服务端已撤销全部登录态，切回登录视图
        emit('password-changed')
    } catch (err) {
        passwordError.value = err.response?.data?.error || err.message || '修改失败'
    } finally {
        savingPassword.value = false
    }
}

async function createKey() {
    if (creatingKey.value) {
        return
    }
    keysError.value = ''
    if (!newKeyName.value.trim()) {
        keysError.value = '请填写 Key 名称'
        return
    }
    creatingKey.value = true
    try {
        freshKey.value = await api.createKey(newKeyName.value.trim())
        newKeyName.value = ''
        await loadKeys()
    } catch (err) {
        keysError.value = err.response?.data?.error || err.message || '创建失败'
    } finally {
        creatingKey.value = false
    }
}

async function resetKeyItem(item) {
    if (!window.confirm(`确定重置 Key「${item.name}」？将生成新 Key，旧 Key 立即失效。`)) {
        return
    }
    keysError.value = ''
    try {
        freshKey.value = await api.resetKey(item.id)
        await loadKeys()
    } catch (err) {
        keysError.value = err.response?.data?.error || err.message || '重置失败'
    }
}

async function removeKey(item) {
    if (!window.confirm(`确定删除 Key「${item.name}」？使用该 Key 的调用将立即失败。`)) {
        return
    }
    keysError.value = ''
    try {
        await api.deleteKey(item.id)
        if (freshKey.value && freshKey.value.id === item.id) {
            freshKey.value = null
        }
        emit('notice', `已删除 Key「${item.name}」`)
        await loadKeys()
    } catch (err) {
        keysError.value = err.response?.data?.error || err.message || '删除失败'
    }
}

function copyFreshKey() {
    if (freshKey.value) {
        copy(freshKey.value.key)
        emit('notice', 'Key 已复制')
    }
}

function formatTime(value) {
    return typeof value === 'string' ? value.replace('T', ' ').slice(0, 16) : '—'
}
</script>

<template>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- 短链与站点设置 -->
        <div class="glass card">
            <h2 class="mb-6 text-lg font-semibold">站点设置</h2>

            <div class="mb-5">
                <label class="mb-1 block text-sm font-medium" for="setting-length">短链最小长度（1-16）</label>
                <p class="mb-2 text-xs text-ink-3">新短码不足该长度时自动补齐；已有短链不受影响</p>
                <input
                    id="setting-length"
                    v-model.number="codeMinLength"
                    type="number"
                    min="1"
                    max="16"
                    class="input w-32"
                />
            </div>

            <div class="mb-5 flex items-start justify-between gap-4 border-t border-line pt-5">
                <div>
                    <div class="text-sm font-medium">随机短码</div>
                    <p class="mt-1 text-xs text-ink-3">开启后新短码随机生成、不可预测；长度至少为 3</p>
                </div>
                <button
                    type="button"
                    class="switch"
                    role="switch"
                    :aria-checked="codeRandom"
                    aria-label="随机短码"
                    @click="codeRandom = !codeRandom"
                ></button>
            </div>

            <div class="mb-6 flex items-start justify-between gap-4 border-t border-line pt-5">
                <div>
                    <div class="text-sm font-medium">创建短链需要登录</div>
                    <p class="mt-1 text-xs text-ink-3">开启后首页仅管理员可生成短链，未登录访问首页将跳转登录页</p>
                </div>
                <button
                    type="button"
                    class="switch"
                    role="switch"
                    :aria-checked="requireLogin"
                    aria-label="创建短链需要登录"
                    @click="requireLogin = !requireLogin"
                ></button>
            </div>

            <p v-if="settingsError" class="mb-4 text-sm text-danger">{{ settingsError }}</p>

            <button
                type="button"
                :disabled="savingSettings"
                class="btn btn-primary w-full sm:w-auto"
                @click="saveSettings"
            >
                {{ savingSettings ? '保存中…' : '保存设置' }}
            </button>
        </div>

        <!-- 修改密码 -->
        <div class="glass card">
            <h2 class="mb-1 text-lg font-semibold">修改密码</h2>
            <p class="mb-6 text-xs text-ink-3">
                {{ passwordSource === 'custom' ? '当前使用后台修改过的密码' : '当前使用环境变量/默认密码（admin123），建议立即修改' }}
                ，修改后所有登录端将被强制下线
            </p>

            <label class="mb-2 block text-sm font-medium text-ink-2" for="pwd-current">当前密码</label>
            <input
                id="pwd-current"
                v-model="currentPassword"
                type="password"
                autocomplete="current-password"
                class="input mb-4"
            />

            <label class="mb-2 block text-sm font-medium text-ink-2" for="pwd-new">新密码（至少 8 位）</label>
            <input
                id="pwd-new"
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                class="input mb-4"
            />

            <label class="mb-2 block text-sm font-medium text-ink-2" for="pwd-confirm">确认新密码</label>
            <input
                id="pwd-confirm"
                v-model="confirmPassword"
                type="password"
                autocomplete="new-password"
                class="input mb-5"
            />

            <p v-if="passwordError" class="mb-4 text-sm text-danger">{{ passwordError }}</p>

            <button
                type="button"
                :disabled="savingPassword"
                class="btn btn-primary w-full sm:w-auto"
                @click="changePassword"
            >
                {{ savingPassword ? '修改中…' : '修改密码' }}
            </button>
        </div>
    </div>

    <!-- 开放 API Keys -->
    <div class="glass card mt-4">
        <h2 class="text-lg font-semibold">开放 API Keys</h2>
        <p class="mt-1 text-xs text-ink-3">
            供外部程序调用
            <code class="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 font-mono text-xs">POST /api/open/shorten</code>
            创建短链；请求头
            <code class="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>
            或
            <code class="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 font-mono text-xs">X-API-Key: &lt;key&gt;</code>
            。明文 Key 仅在创建/重置时展示一次，服务端只保存哈希。
        </p>

        <!-- 仅此一次的明文展示 -->
        <div
            v-if="freshKey"
            class="mt-4 rounded-lg border border-line bg-[var(--color-accent-soft)] p-4"
        >
            <div class="text-sm font-medium">Key「{{ freshKey.name }}」已生成，请立即保存，关闭后将无法再次查看：</div>
            <div class="mt-2 flex flex-wrap items-center gap-3">
                <code class="select-all break-all rounded bg-[var(--color-surface-solid)] px-3 py-2 font-mono text-sm">{{ freshKey.key }}</code>
                <button type="button" class="btn btn-secondary btn-sm" @click="copyFreshKey">复制</button>
                <button type="button" class="btn btn-primary btn-sm" @click="freshKey = null">我已保存</button>
            </div>
        </div>

        <!-- 创建 -->
        <form class="mt-5 flex flex-wrap gap-3" @submit.prevent="createKey">
            <input
                v-model="newKeyName"
                type="text"
                maxlength="64"
                placeholder="Key 名称，如：CI、博客、脚本"
                class="input min-w-0 max-w-xs flex-1"
            />
            <button type="submit" class="btn btn-primary" :disabled="creatingKey">
                {{ creatingKey ? '创建中…' : '创建 Key' }}
            </button>
        </form>

        <p v-if="keysError" class="mt-3 text-sm text-danger">{{ keysError }}</p>

        <!-- 列表 -->
        <div class="mt-4 overflow-x-auto">
            <table class="w-full min-w-[640px] text-left text-sm">
                <thead>
                    <tr class="border-b border-line text-xs uppercase tracking-wider text-ink-3">
                        <th class="py-3 pr-3 font-medium">名称</th>
                        <th class="py-3 pr-3 font-medium">Key</th>
                        <th class="py-3 pr-3 font-medium">创建时间</th>
                        <th class="py-3 pr-3 font-medium">最近使用</th>
                        <th class="py-3 text-right font-medium">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="keys.length === 0">
                        <td colspan="5" class="py-10 text-center text-ink-3">还没有 API Key，创建一个供外部程序调用</td>
                    </tr>
                    <tr
                        v-for="item in keys"
                        :key="item.id"
                        class="row-hover border-b border-line align-middle last:border-0"
                    >
                        <td class="py-3 pr-3 font-medium">{{ item.name }}</td>
                        <td class="py-3 pr-3">
                            <code class="select-all rounded bg-[var(--color-accent-soft)] px-2 py-1 font-mono text-xs">{{ item.prefix }}…</code>
                        </td>
                        <td class="tnum whitespace-nowrap py-3 pr-3 text-ink-3">{{ formatTime(item.created_at) }}</td>
                        <td class="tnum whitespace-nowrap py-3 pr-3 text-ink-3">{{ formatTime(item.last_used_at) }}</td>
                        <td class="whitespace-nowrap py-3 text-right">
                            <button type="button" class="action-btn" @click="resetKeyItem(item)">重置</button>
                            <button type="button" class="action-btn action-danger" @click="removeKey(item)">删除</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
