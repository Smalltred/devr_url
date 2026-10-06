<script setup>
import { onMounted, ref } from 'vue'
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

onMounted(async () => {
    try {
        applySettings(await api.fetchSettings())
    } catch (err) {
        settingsError.value = err.response?.data?.error || err.message || '设置加载失败'
    }
})

function applySettings(data) {
    codeMinLength.value = data.code_min_length
    codeRandom.value = Boolean(data.code_random)
    requireLogin.value = Boolean(data.require_login)
    passwordSource.value = data.password_source || 'env'
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
</template>
