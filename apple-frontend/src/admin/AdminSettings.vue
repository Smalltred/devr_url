<script setup>
/**
 * 设置面板：站点设置（改动即自动保存）、修改密码、开放 API Keys。
 *
 * 自动保存的时序逻辑与旧实现保持一致（防抖、幂等、并发序号、失败回滚），
 * 这些是踩过坑的地方，行为不改。UI 层的变化：
 *   · 重置/删除 Key 改用主题内的确认面板，不再用原生 window.confirm
 *   · 修改密码按钮带 loading 态
 *   · 保存状态用 aria-live 播报
 */
import { onMounted, onUnmounted, ref } from 'vue'
import copy from 'copy-to-clipboard'
import api, { errorMessage } from '../services/entity.js'
import AppButton from '../components/AppButton.vue'
import AppSwitch from '../components/AppSwitch.vue'
import ConfirmSheet from './ConfirmSheet.vue'

const emit = defineEmits(['password-changed', 'notice'])

// 短链设置
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

// 定时巡检
const healthScanEnabled = ref(true)
// 时间用 <input type="time"> 的 HH:MM 字符串，提交时拆成时/分
const healthScanTime = ref('12:00')
const healthDeadThreshold = ref(3)

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

// 待确认的 Key 操作：{ type: 'reset' | 'delete', item }
const pendingKeyAction = ref(null)

// 自动保存：数字输入防抖（逐字符输入只发一次请求），开关与失焦立即提交
const SETTINGS_DEBOUNCE_MS = 600
let settingsTimer = null
let savedFlashTimer = null
// 请求序号：并发改动时只采纳最后一次响应，避免旧响应覆盖新状态
let saveSeq = 0
// 最近一次已提交的载荷：在发请求前登记、失败时清除。
// 同一载荷不重复提交 —— 数字框会先后触发 input 与 change（顺序不定），
// 失焦、开关等时机也可能与防抖定时器重叠。
let lastSubmittedPayload = null

onMounted(async () => {
    try {
        applySettings(await api.fetchSettings())
    } catch (err) {
        settingsError.value = errorMessage(err, '设置加载失败')
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
    healthScanEnabled.value = data.health_scan_enabled !== false
    healthScanTime.value = formatTimeOfDay(data.health_scan_hour ?? 12, data.health_scan_minute ?? 0)
    healthDeadThreshold.value = data.health_dead_threshold ?? 3
    // 服务端基线：此后与之一致的触发（失焦、重复事件）不再提交
    lastSubmittedPayload = canonicalPayload(data)
}

/**
 * 时/分 → HH:MM。
 */
function formatTimeOfDay(hour, minute) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * HH:MM → { hour, minute }；格式非法返回 null。
 */
function parseTimeOfDay(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim())
    if (!match) return null
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

    return { hour, minute }
}

/**
 * 从服务端设置视图提取规范化载荷（用于比对，字段与提交体一致）。
 */
function canonicalPayload(data) {
    return {
        code_min_length: data.code_min_length,
        code_random: Boolean(data.code_random),
        require_login: Boolean(data.require_login),
        cache_ttl: data.cache_ttl ?? 300,
        cache_negative_ttl: data.cache_negative_ttl ?? 30,
        health_scan_enabled: data.health_scan_enabled !== false,
        health_scan_hour: data.health_scan_hour ?? 12,
        health_scan_minute: data.health_scan_minute ?? 0,
        health_dead_threshold: data.health_dead_threshold ?? 3,
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
 * 读取整数输入。返回 null 表示「尚未形成可用值」（空输入/非整数），
 * 调用方据此跳过本次保存而不报错，避免用户改写过程中弹出校验提示。
 */
function readInt(value) {
    const text = String(value).trim()
    if (text === '') return null

    const parsed = Number(text)

    return Number.isInteger(parsed) ? parsed : null
}

/**
 * 本地校验：不通过则不发请求，直接提示（与后端规则一致，省一次往返）。
 * @returns {{payload: object|null, incomplete: boolean}}
 */
function validateSettings() {
    const rawMinLength = String(codeMinLength.value).trim()
    const rawTtl = String(cacheTtl.value).trim()
    const rawNegativeTtl = String(cacheNegativeTtl.value).trim()
    const rawThreshold = String(healthDeadThreshold.value).trim()
    // 任一数字/时间框正在改写（空值）时整体跳过
    if (rawMinLength === '' || rawTtl === '' || rawNegativeTtl === '' || rawThreshold === '' || healthScanTime.value === '') {
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

    const threshold = readInt(healthDeadThreshold.value)
    if (threshold === null || threshold < 1 || threshold > 10) {
        settingsError.value = '失效确认阈值需为 1-10 的整数'

        return { payload: null, incomplete: false }
    }

    const scanTime = parseTimeOfDay(healthScanTime.value)
    if (scanTime === null) {
        settingsError.value = '巡检时间格式无效'

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
            health_scan_enabled: healthScanEnabled.value,
            health_scan_hour: scanTime.hour,
            health_scan_minute: scanTime.minute,
            health_dead_threshold: threshold,
        },
        incomplete: false,
    }
}

function hasEmptyNumberField() {
    return (
        String(codeMinLength.value).trim() === '' ||
        String(cacheTtl.value).trim() === '' ||
        String(cacheNegativeTtl.value).trim() === '' ||
        String(healthDeadThreshold.value).trim() === '' ||
        healthScanTime.value === ''
    )
}

function scheduleSettingsSave() {
    if (settingsTimer) clearTimeout(settingsTimer)
    settingsTimer = window.setTimeout(() => {
        settingsTimer = null
        persistSettings()
    }, SETTINGS_DEBOUNCE_MS)
}

// 失焦/开关等提交时机：取消防抖，立即保存
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

/** 拉回服务端当前设置（用于放弃半成品输入） */
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
        // 输入未完成：静默跳过，但清掉可能残留的「已保存」提示以免误导
        if (incomplete) settingsSaved.value = false

        return
    }

    // 与该载荷一致（重复事件/仅失焦触发）：无需重复提交，保证提交幂等
    if (lastSubmittedPayload !== null && isSameSettings(payload, lastSubmittedPayload)) return

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
            settingsError.value = errorMessage(err, '保存失败')
            // 与后端对齐：拉回服务端状态，避免界面显示未生效的值
            try {
                applySettings(await api.fetchSettings())
            } catch {
                // 拉取失败则保持当前显示，错误提示已给出
            }
        }
    } finally {
        if (seq === saveSeq) savingSettings.value = false
    }
}

/** 两个设置载荷是否等价（字段一致，数值按数字比较） */
function isSameSettings(a, b) {
    // 逐字段比较易漏（新增设置项时忘记同步）；载荷结构固定、键顺序一致，直接序列化比较
    return JSON.stringify(a) === JSON.stringify(b)
}

function flashSaved() {
    settingsSaved.value = true
    if (savedFlashTimer) clearTimeout(savedFlashTimer)
    savedFlashTimer = window.setTimeout(() => {
        settingsSaved.value = false
    }, 1800)
}

// 开关：本地校验不过就不切换（并说明原因），通过则立即保存
function toggleCodeRandom(next) {
    if (next) {
        const minLength = readInt(codeMinLength.value)
        if (minLength === null || minLength < 3) {
            settingsError.value = '开启随机短码后，短链最小长度至少为 3，请先调整长度'

            return
        }
    }
    codeRandom.value = next
    flushSettingsSave()
}

function toggleRequireLogin(next) {
    requireLogin.value = next
    flushSettingsSave()
}

async function changePassword() {
    if (savingPassword.value) return

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
        passwordError.value = errorMessage(err, '修改失败')
    } finally {
        savingPassword.value = false
    }
}

async function createKey() {
    if (creatingKey.value) return

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
        keysError.value = errorMessage(err, '创建失败')
    } finally {
        creatingKey.value = false
    }
}

/** 确认后执行 Key 的重置或删除 */
async function confirmKeyAction() {
    const pending = pendingKeyAction.value
    pendingKeyAction.value = null
    if (!pending) return

    const { type, item } = pending
    keysError.value = ''
    try {
        if (type === 'reset') {
            freshKey.value = await api.resetKey(item.id)
            await loadKeys()
        } else {
            await api.deleteKey(item.id)
            if (freshKey.value && freshKey.value.id === item.id) freshKey.value = null
            emit('notice', `已删除 Key「${item.name}」`)
            await loadKeys()
        }
    } catch (err) {
        keysError.value = errorMessage(err, type === 'reset' ? '重置失败' : '删除失败')
    }
}

function copyFreshKey() {
    if (!freshKey.value) return
    copy(freshKey.value.key)
    emit('notice', 'Key 已复制')
}

function formatTime(value) {
    return typeof value === 'string' ? value.replace('T', ' ').slice(0, 16) : '—'
}
</script>

<template>
    <div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <!-- 站点设置 -->
            <div class="material-regular card">
                <div class="mb-6 flex items-center justify-between gap-3">
                    <h2 class="type-lg">站点设置</h2>
                    <span class="type-xs flex items-center gap-1.5 text-ink-3" aria-live="polite">
                        <span v-if="savingSettings" class="spinner" aria-hidden="true" />
                        {{ savingSettings ? '保存中…' : (settingsSaved ? '已保存' : '改动即自动保存') }}
                    </span>
                </div>

                <div class="mb-5">
                    <label class="field-label" for="setting-length">短链最小长度（1-16）</label>
                    <p class="field-hint mb-2">新短码不足该长度时自动补齐；已有短链不受影响</p>
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
                        <div class="type-sm font-medium">随机短码</div>
                        <p class="field-hint">开启后新短码随机生成、不可预测；长度至少为 3</p>
                    </div>
                    <AppSwitch
                        :model-value="codeRandom"
                        label="随机短码"
                        @update:model-value="toggleCodeRandom"
                    />
                </div>

                <div class="mb-6 flex items-start justify-between gap-4 border-t border-line pt-5">
                    <div>
                        <div class="type-sm font-medium">创建短链需要登录</div>
                        <p class="field-hint">开启后首页仅管理员可生成短链，未登录访问首页将跳转登录页</p>
                    </div>
                    <AppSwitch
                        :model-value="requireLogin"
                        label="创建短链需要登录"
                        @update:model-value="toggleRequireLogin"
                    />
                </div>

                <div class="mb-4 border-t border-line pt-5">
                    <div class="mb-3 flex items-start justify-between gap-4">
                        <div>
                            <div class="type-sm font-medium">短链缓存（Memcached）</div>
                            <p class="field-hint">
                                跳转结果缓存，命中时免查数据库；缓存不可用时自动降级为直连数据库，不影响跳转
                            </p>
                        </div>
                        <span
                            v-if="cacheStatus"
                            class="type-xs shrink-0 rounded-full px-2.5 py-1 font-medium"
                            :class="cacheStatus.available
                                ? 'bg-[var(--color-success-soft)] text-success'
                                : 'bg-[var(--color-danger-soft)] text-danger'"
                        >
                            {{ cacheStatus.available ? '运行中' : '不可用（已降级）' }}
                        </span>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="field-label" for="cache-ttl">缓存有效期（秒）</label>
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
                            <label class="field-label" for="cache-negative-ttl">负缓存（秒）</label>
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

                    <p class="field-hint mt-2">
                        缓存有效期 0 = 不缓存；负缓存用于缓存「短码不存在」，抵御扫描流量，0 = 关闭。
                    </p>

                    <p v-if="cacheStatus" class="field-hint mt-3">
                        服务节点：{{ cacheStatus.servers.join('、') || '—' }}
                        <template v-if="cacheStatus.available && cacheStatus.stats">
                            · 累计命中 {{ cacheStatus.stats.hits }} / 未命中 {{ cacheStatus.stats.misses }}
                            · 缓存条目 {{ cacheStatus.stats.items }}
                        </template>
                    </p>
                </div>

                <p v-if="settingsError" class="field-error" role="alert">{{ settingsError }}</p>
            </div>

            <!-- 修改密码 -->
            <div class="material-regular card">
                <h2 class="type-lg mb-1">修改密码</h2>
                <p class="type-xs mb-6 text-ink-3">
                    {{
                        passwordSource === 'custom'
                            ? '当前使用后台修改过的密码'
                            : '当前使用环境变量/默认密码（admin123），建议立即修改'
                    }}
                    ，修改后所有登录端将被强制下线
                </p>

                <label class="field-label" for="pwd-current">当前密码</label>
                <input
                    id="pwd-current"
                    v-model="currentPassword"
                    type="password"
                    class="input mb-4"
                    autocomplete="current-password"
                />

                <label class="field-label" for="pwd-new">新密码（至少 8 位）</label>
                <input
                    id="pwd-new"
                    v-model="newPassword"
                    type="password"
                    class="input mb-4"
                    autocomplete="new-password"
                />

                <label class="field-label" for="pwd-confirm">确认新密码</label>
                <input
                    id="pwd-confirm"
                    v-model="confirmPassword"
                    type="password"
                    class="input mb-5"
                    autocomplete="new-password"
                />

                <p v-if="passwordError" class="field-error mb-4" role="alert">{{ passwordError }}</p>

                <AppButton :loading="savingPassword" class="w-full sm:w-auto" @click="changePassword">
                    {{ savingPassword ? '修改中…' : '修改密码' }}
                </AppButton>
            </div>
        </div>

        <!-- 定时巡检 -->
        <div class="material-regular card mt-4">
            <div class="mb-1 flex flex-wrap items-center justify-between gap-3">
                <h2 class="type-lg">定时巡检</h2>
                <AppSwitch
                    label="每日定时巡检"
                    :model-value="healthScanEnabled"
                    @update:model-value="healthScanEnabled = $event; flushSettingsSave()"
                />
            </div>
            <p class="type-xs text-ink-3">
                每天在指定时间自动检测短链目标地址是否仍可访问；目标不可访问即视为「失效」，
                可在列表页按「失效」筛选并一键清理。时间使用服务器本地时区。
            </p>

            <div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label class="field-label" for="health-scan-time">每日巡检时间</label>
                    <input
                        id="health-scan-time"
                        v-model="healthScanTime"
                        type="time"
                        class="input w-full"
                        @change="flushSettingsSave"
                        @blur="flushSettingsSave"
                    />
                </div>
                <div>
                    <label class="field-label" for="health-dead-threshold">失效确认阈值（次）</label>
                    <input
                        id="health-dead-threshold"
                        v-model.number="healthDeadThreshold"
                        type="number"
                        min="1"
                        max="10"
                        class="input w-full"
                        @input="scheduleSettingsSave"
                        @change="flushSettingsSave"
                        @blur="flushSettingsSave"
                    />
                </div>
            </div>

            <p class="type-xs mt-2 text-ink-3">
                例如阈值 3：连续 3 次检测都连不上（403/404/5xx/连接被终止/超时）才判定为失效；
                中途恢复会清零计数。关闭定时巡检后仍可在列表页手动扫描。
            </p>
        </div>

        <!-- 开放 API Keys -->
        <div class="material-regular card mt-4">
            <h2 class="type-lg">开放 API Keys</h2>
            <p class="type-xs mt-1 text-ink-3">
                供外部程序调用
                <code class="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 font-mono">POST /api/open/shorten</code>
                创建短链；请求头
                <code class="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 font-mono">Authorization: Bearer &lt;key&gt;</code>
                或
                <code class="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 font-mono">X-API-Key: &lt;key&gt;</code>
                。明文 Key 仅在创建/重置时展示一次，服务端只保存哈希。
            </p>

            <!-- 仅此一次的明文展示 -->
            <div
                v-if="freshKey"
                class="mt-4 rounded-lg border border-line bg-[var(--color-accent-soft)] p-4"
            >
                <div class="type-sm font-medium">
                    Key「{{ freshKey.name }}」已生成，请立即保存，关闭后将无法再次查看：
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-3">
                    <code
                        class="type-sm select-all break-all rounded bg-[var(--color-surface-solid)] px-3 py-2 font-mono"
                    >{{ freshKey.key }}</code>
                    <AppButton variant="secondary" size="sm" @click="copyFreshKey">复制</AppButton>
                    <AppButton size="sm" @click="freshKey = null">我已保存</AppButton>
                </div>
            </div>

            <!-- 创建 -->
            <form class="mt-5 flex flex-wrap gap-3" @submit.prevent="createKey">
                <input
                    v-model="newKeyName"
                    type="text"
                    maxlength="64"
                    class="input min-w-0 max-w-xs flex-1"
                    placeholder="Key 名称，如：CI、博客、脚本"
                    aria-label="Key 名称"
                />
                <AppButton type="submit" :loading="creatingKey">
                    {{ creatingKey ? '创建中…' : '创建 Key' }}
                </AppButton>
            </form>

            <p v-if="keysError" class="field-error mt-3" role="alert">{{ keysError }}</p>

            <div class="table-bleed mt-4 overflow-x-auto">
                <table class="data-table type-sm w-full min-w-[640px] text-left">
                    <thead>
                        <tr>
                            <th class="type-caps py-3 pr-3 text-ink-3">名称</th>
                            <th class="type-caps py-3 pr-3 text-ink-3">Key</th>
                            <th class="type-caps py-3 pr-3 text-ink-3">创建时间</th>
                            <th class="type-caps py-3 pr-3 text-ink-3">最近使用</th>
                            <th class="type-caps py-3 text-right text-ink-3">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="keys.length === 0">
                            <td colspan="5" class="py-10 text-center text-ink-3">
                                还没有 API Key，创建一个供外部程序调用
                            </td>
                        </tr>
                        <tr
                            v-for="item in keys"
                            :key="item.id"
                            class="row-hover align-middle"
                        >
                            <td class="py-3 pr-3 font-medium">{{ item.name }}</td>
                            <td class="py-3 pr-3">
                                <code
                                    class="type-xs select-all rounded bg-[var(--color-accent-soft)] px-2 py-1 font-mono"
                                >{{ item.prefix }}…</code>
                            </td>
                            <td class="tnum whitespace-nowrap py-3 pr-3 text-ink-3">
                                {{ formatTime(item.created_at) }}
                            </td>
                            <td class="tnum whitespace-nowrap py-3 pr-3 text-ink-3">
                                {{ formatTime(item.last_used_at) }}
                            </td>
                            <td class="whitespace-nowrap py-3 text-right">
                                <button
                                    type="button"
                                    class="action-btn"
                                    @click="pendingKeyAction = { type: 'reset', item }"
                                >重置</button>
                                <button
                                    type="button"
                                    class="action-btn action-danger"
                                    @click="pendingKeyAction = { type: 'delete', item }"
                                >删除</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <ConfirmSheet
            v-if="pendingKeyAction"
            :title="pendingKeyAction.type === 'reset' ? '重置 API Key' : '删除 API Key'"
            :message="pendingKeyAction.type === 'reset'
                ? `确定重置 Key「${pendingKeyAction.item.name}」？将生成新 Key，旧 Key 立即失效。`
                : `确定删除 Key「${pendingKeyAction.item.name}」？使用该 Key 的调用将立即失败。`"
            :confirm-text="pendingKeyAction.type === 'reset' ? '重置' : '删除'"
            :danger="pendingKeyAction.type === 'delete'"
            @confirm="confirmKeyAction"
            @close="pendingKeyAction = null"
        />
    </div>
</template>
