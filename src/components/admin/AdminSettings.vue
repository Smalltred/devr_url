<script setup>
import { onUnmounted, onMounted, ref } from 'vue'
import copy from 'copy-to-clipboard'
import api from '../../services/entity'

const emit = defineEmits(['password-changed', 'notice'])

// 短链设置（改动即自动保存，无保存按钮）
const codeMinLength = ref(1)
const codeRandom = ref(false)
const requireLogin = ref(false)
const passwordSource = ref('env')
const settingsError = ref('')
const savingSettings = ref(false)
const settingsSaved = ref(false)

// 缓存
const cacheTtl = ref(300)
const cacheNegativeTtl = ref(30)
const cacheStatus = ref(null)

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

// 自动保存：数字输入防抖（逐字符输入只发一次请求），下拉/开关与失焦立即提交
const SETTINGS_DEBOUNCE_MS = 600
let settingsTimer = null
let savedFlashTimer = null
// 请求序号：并发改动时只采纳最后一次响应，避免旧响应覆盖新状态
let saveSeq = 0
// 最近一次已提交的载荷：在发请求前登记、失败时清除。
// 同一载荷不重复提交——数字框会先后触发 input 与 change（顺序不定），
// 失焦、开关等时机也可能与防抖定时器重叠。
let lastSubmittedPayload = null

onMounted(async () => {
    try {
        applySettings(await api.fetchSettings())
    } catch (err) {
        settingsError.value = err.response?.data?.error || err.message || '设置加载失败'
    }
    await loadKeys()
})

onUnmounted(() => {
    if (settingsTimer) clearTimeout(settingsTimer)
    if (savedFlashTimer) clearTimeout(savedFlashTimer)
})

function applySettings(data) {
    codeMinLength.value = data.code_min_length
    codeRandom.value = Boolean(data.code_random)
    requireLogin.value = Boolean(data.require_login)
    passwordSource.value = data.password_source || 'env'
    cacheTtl.value = data.cache_ttl ?? 300
    cacheNegativeTtl.value = data.cache_negative_ttl ?? 30
    cacheStatus.value = data.cache || null
    // 服务端基线：此后与之一致的触发（失焦、重复事件）不再提交
    lastSubmittedPayload = canonicalPayload(data)
}

/**
 * 从服务端设置视图提取规范化载荷（用于比对，字段与提交体一致）。
 *
 * @param {object} data
 */
function canonicalPayload(data) {
    return {
        code_min_length: data.code_min_length,
        code_random: Boolean(data.code_random),
        require_login: Boolean(data.require_login),
        cache_ttl: data.cache_ttl ?? 300,
        cache_negative_ttl: data.cache_negative_ttl ?? 30,
    }
}

async function loadKeys() {
    try {
        keys.value = await api.fetchKeys()
    } catch {
        keysError.value = keysError.value || 'Key 列表加载失败'
    }
}

/**
 * 读取整数输入。返回 null 表示“尚未形成可用值”（空输入/非整数），
 * 调用方据此跳过本次保存而不报错，避免用户改写过程中弹出校验提示。
 */
function readInt(value) {
    const text = String(value).trim()
    if (text === '') {
        return null
    }
    const parsed = Number(text)

    return Number.isInteger(parsed) ? parsed : null
}

/**
 * 本地校验：不通过则不发请求，直接提示（与后端规则一致，省一次往返）。
 *
 * @returns {{payload: object|null, incomplete: boolean}} incomplete 为 true 表示输入未完成，静默跳过
 */
function validateSettings() {
    const rawMinLength = String(codeMinLength.value).trim()
    const rawTtl = String(cacheTtl.value).trim()
    const rawNegativeTtl = String(cacheNegativeTtl.value).trim()
    // 任一数字框正在改写（空值）时整体跳过，避免把半成品状态提交或被后端拒绝
    if (rawMinLength === '' || rawTtl === '' || rawNegativeTtl === '') {
        return { payload: null, incomplete: true }
    }

    const minLength = readInt(codeMinLength.value)
    if (minLength === null || minLength < 1 || minLength > 16) {
        settingsError.value = '短链最小长度需为 1-16 的整数'
        return { payload: null, incomplete: false }
    }

    const ttl = readInt(cacheTtl.value)
    if (ttl === null || ttl < 0 || ttl > 86400) {
        settingsError.value = '缓存有效期需为 0-86400 秒的整数'
        return { payload: null, incomplete: false }
    }

    const negativeTtl = readInt(cacheNegativeTtl.value)
    if (negativeTtl === null || negativeTtl < 0 || negativeTtl > 3600) {
        settingsError.value = '负缓存需为 0-3600 秒的整数'
        return { payload: null, incomplete: false }
    }

    if (codeRandom.value && minLength < 3) {
        settingsError.value = '开启随机短码后，短链最小长度至少为 3'
        return { payload: null, incomplete: false }
    }

    settingsError.value = ''

    return {
        payload: {
            code_min_length: minLength,
            code_random: codeRandom.value,
            require_login: requireLogin.value,
            cache_ttl: ttl,
            cache_negative_ttl: negativeTtl,
        },
        incomplete: false,
    }
}

function scheduleSettingsSave() {
    if (settingsTimer) {
        clearTimeout(settingsTimer)
    }
    settingsTimer = setTimeout(() => {
        settingsTimer = null
        persistSettings()
    }, SETTINGS_DEBOUNCE_MS)
}

// 失焦/回车等提交时机：取消防抖，立即保存
function flushSettingsSave() {
    if (settingsTimer) {
        clearTimeout(settingsTimer)
        settingsTimer = null
    }

    // 失焦时数字框仍为空（用户清空后离开）：不提交也不留空白，回填服务端当前值
    if (hasEmptyNumberField()) {
        settingsSaved.value = false
        void restoreSettings()
        return
    }

    persistSettings()
}

function hasEmptyNumberField() {
    return (
        String(codeMinLength.value).trim() === '' ||
        String(cacheTtl.value).trim() === '' ||
        String(cacheNegativeTtl.value).trim() === ''
    )
}

/**
 * 拉回服务端当前设置（用于放弃半成品输入）。
 */
async function restoreSettings() {
    try {
        applySettings(await api.fetchSettings())
        settingsError.value = ''
    } catch {
        // 拉取失败保持现状
    }
}

async function persistSettings() {
    const { payload, incomplete } = validateSettings()
    if (payload === null) {
        // 输入未完成：静默跳过，但清掉可能残留的“已保存”提示以免误导
        if (incomplete) {
            settingsSaved.value = false
        }
        return
    }

    // 与该载荷一致（重复事件/仅失焦触发）：无需重复提交，保证提交幂等
    if (lastSubmittedPayload !== null && isSameSettings(payload, lastSubmittedPayload)) {
        return
    }

    const seq = ++saveSeq
    // 请求发出前登记，使并发的重复触发直接跳过
    lastSubmittedPayload = payload
    savingSettings.value = true
    try {
        const data = await api.updateSettings(payload)
        if (seq === saveSeq) {
            applySettings(data)
            flashSaved()
        }
    } catch (err) {
        if (seq === saveSeq) {
            // 失败后清除登记，允许用户重试同一载荷
            lastSubmittedPayload = null
            settingsError.value = err.response?.data?.error || err.message || '保存失败'
            // 与后端对齐：拉回服务端状态，避免界面显示未生效的值
            try {
                applySettings(await api.fetchSettings())
            } catch {
                // 拉取失败则保持当前显示，错误提示已给出
            }
        }
    } finally {
        if (seq === saveSeq) {
            savingSettings.value = false
        }
    }
}

/**
 * 两个设置载荷是否等价（字段一致，数值按数字比较）。
 *
 * @param {object} a
 * @param {object} b
 */
function isSameSettings(a, b) {
    return (
        a.code_min_length === b.code_min_length &&
        a.code_random === b.code_random &&
        a.require_login === b.require_login &&
        a.cache_ttl === b.cache_ttl &&
        a.cache_negative_ttl === b.cache_negative_ttl
    )
}

function flashSaved() {
    settingsSaved.value = true
    if (savedFlashTimer) {
        clearTimeout(savedFlashTimer)
    }
    savedFlashTimer = setTimeout(() => {
        settingsSaved.value = false
    }, 1800)
}

// 开关：本地校验不过就不切换（并说明原因），通过则立即保存
function toggleCodeRandom() {
    if (!codeRandom.value) {
        const minLength = readInt(codeMinLength.value)
        if (minLength === null || minLength < 3) {
            settingsError.value = '开启随机短码后，短链最小长度至少为 3，请先调整长度'
            return
        }
    }
    codeRandom.value = !codeRandom.value
    flushSettingsSave()
}

function toggleRequireLogin() {
    requireLogin.value = !requireLogin.value
    flushSettingsSave()
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
    <div>
        <!-- 单一根节点：本组件在 AdminPage 中包在 <transition mode="out-in"> 内。
             注意根级不能有任何注释——dev 模式下注释会编译成 fragment 的额外子节点，
             使组件根退化为多根，过渡钩子落在锚点注释上，切换选项卡后内容区永久空白 -->
        <!-- 站点设置与修改密码 -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <!-- 短链与站点设置 -->
            <div class="glass card">
                <div class="mb-6 flex items-center justify-between gap-3">
                    <h2 class="text-lg font-semibold">站点设置</h2>
                    <!-- 自动保存状态：保存中转圈，完成后短暂提示 -->
                    <span class="flex items-center gap-1.5 text-xs text-ink-3" aria-live="polite">
                        <span v-if="savingSettings" class="spinner" aria-hidden="true"></span>
                        {{ savingSettings ? '保存中…' : settingsSaved ? '已保存' : '改动即自动保存' }}
                    </span>
                </div>

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
                        @input="scheduleSettingsSave"
                        @change="flushSettingsSave"
                        @blur="flushSettingsSave"
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
                        @click="toggleCodeRandom"
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
                        @click="toggleRequireLogin"
                    ></button>
                </div>

                <div class="mb-4 border-t border-line pt-5">
                    <div class="mb-3 flex items-start justify-between gap-4">
                        <div>
                            <div class="text-sm font-medium">短链缓存（Memcached）</div>
                            <p class="mt-1 text-xs text-ink-3">
                                跳转结果缓存，命中时免查数据库；缓存不可用时自动降级为直连数据库，不影响跳转
                            </p>
                        </div>
                        <span
                            v-if="cacheStatus"
                            class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                            :class="cacheStatus.available ? 'bg-[var(--color-success-soft)] text-success' : 'bg-[var(--color-danger-soft)] text-danger'"
                        >
                            {{ cacheStatus.available ? '运行中' : '不可用（已降级）' }}
                        </span>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="mb-1 block text-xs font-medium text-ink-2" for="cache-ttl">缓存有效期（秒）</label>
                            <input
                                id="cache-ttl"
                                v-model.number="cacheTtl"
                                type="number"
                                min="0"
                                max="86400"
                                class="input w-full"
                                @input="scheduleSettingsSave"
                                @change="flushSettingsSave"
                                @blur="flushSettingsSave"
                            />
                        </div>
                        <div>
                            <label class="mb-1 block text-xs font-medium text-ink-2" for="cache-negative-ttl">负缓存（秒）</label>
                            <input
                                id="cache-negative-ttl"
                                v-model.number="cacheNegativeTtl"
                                type="number"
                                min="0"
                                max="3600"
                                class="input w-full"
                                @input="scheduleSettingsSave"
                                @change="flushSettingsSave"
                                @blur="flushSettingsSave"
                            />
                        </div>
                    </div>
                    <p class="mt-2 text-xs text-ink-3">
                        缓存有效期 0 = 不缓存；负缓存用于缓存“短码不存在”，抵御扫描流量，0 = 关闭。
                    </p>

                    <p v-if="cacheStatus" class="mt-3 text-xs text-ink-3">
                        服务节点：{{ cacheStatus.servers.join('、') || '—' }}
                        <template v-if="cacheStatus.available">
                            · 累计命中 {{ cacheStatus.stats.hits }} / 未命中 {{ cacheStatus.stats.misses }} · 缓存条目
                            {{ cacheStatus.stats.items }}
                        </template>
                    </p>
                </div>

                <p v-if="settingsError" class="text-sm text-danger">{{ settingsError }}</p>
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
    </div>
</template>
