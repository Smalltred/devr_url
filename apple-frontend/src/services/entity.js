import axios from 'axios'

const api = axios.create({
    // 留空 = 与前端同源（配合反向代理把 /url、/api、短码路由转发到 PHP）
    // 跨域部署时设置 VITE_API_BASE_URL（构建时读取）
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    // 登录态走 HttpOnly Cookie
    withCredentials: true,
})

// 401 统一打标：管理页据此切回登录视图
api.interceptors.response.use(
    res => res,
    err => {
        if (err.response && err.response.status === 401) {
            err.isAuthError = true
        }
        return Promise.reject(err)
    },
)

/**
 * 从错误对象提取面向用户的提示。
 *
 * 后端所有失败都返回 { error: "中文说明" }，旧前端只读了 axios 的 err.message，
 * 用户看到的是「Request failed with status code 429」这类英文串。
 * 这里统一优先取后端消息。
 *
 * @param {unknown} err
 * @param {string} fallback 兜底文案
 * @returns {string}
 */
export function errorMessage(err, fallback = '操作失败，请稍后再试') {
    return err?.response?.data?.error || err?.message || fallback
}

// ==================== 首页 ====================

/**
 * 生成短链接
 * @param {string} url 原始链接
 * @returns {{code: string, url: string}}
 */
const shortUrl = async url => {
    const res = await api.post('/url', { url })

    return res.data
}

// ==================== 管理后台 ====================

const login = async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password })

    return res.data
}

const logout = async () => {
    const res = await api.post('/api/auth/logout')

    return res.data
}

const me = async () => {
    const res = await api.get('/api/auth/me')

    // {authenticated: boolean, require_login: boolean}
    return res.data
}

/**
 * 全站概览。
 *
 * @param {'day'|'week'|'month'|'year'} period 趋势粒度，后端非法值回落为 day
 */
const fetchOverview = async (period = 'day') => {
    const res = await api.get('/api/admin/overview', { params: { period } })

    return res.data
}

/**
 * @param {{page?: number, per_page?: number, q?: string, health?: string}} params
 */
const fetchLinks = async params => {
    const res = await api.get('/api/admin/links', { params })

    return res.data
}

/**
 * 扫描一批外链（检测目标地址是否仍可访问）。
 *
 * @param {number} limit 本批条数
 */
const scanLinks = async (limit = 20) => {
    const res = await api.post('/api/admin/links/scan', { limit })

    return res.data
}

/** 一键清理全部死链（连续失败达到阈值的短链，含点击记录） */
const cleanupDeadLinks = async () => {
    const res = await api.post('/api/admin/links/cleanup-dead')

    return res.data
}

/** 兼容旧名称（后端语义已改为只清理死链） */
const cleanupBrokenLinks = cleanupDeadLinks

const updateLink = async (code, payload) => {
    const res = await api.put(`/api/admin/links/${encodeURIComponent(code)}`, payload)

    return res.data
}

const deleteLink = async code => {
    const res = await api.delete(`/api/admin/links/${encodeURIComponent(code)}`)

    return res.data
}

/**
 * 单链统计。
 *
 * @param {string} code
 * @param {'day'|'week'|'month'|'year'} period 趋势粒度
 */
const fetchLinkStats = async (code, period = 'day') => {
    const res = await api.get(`/api/admin/links/${encodeURIComponent(code)}/stats`, { params: { period } })

    return res.data
}

const fetchSettings = async () => {
    const res = await api.get('/api/admin/settings')

    return res.data
}

const updateSettings = async payload => {
    const res = await api.put('/api/admin/settings', payload)

    return res.data
}

const changePassword = async (currentPassword, newPassword) => {
    const res = await api.post('/api/admin/settings/password', {
        current_password: currentPassword,
        new_password: newPassword,
    })

    return res.data
}

const fetchKeys = async () => {
    const res = await api.get('/api/admin/keys')

    return res.data.items || []
}

// 明文 Key 仅在创建/重置的响应中出现一次
const createKey = async name => {
    const res = await api.post('/api/admin/keys', { name })

    return res.data
}

const resetKey = async id => {
    const res = await api.post(`/api/admin/keys/${id}/reset`)

    return res.data
}

const deleteKey = async id => {
    const res = await api.delete(`/api/admin/keys/${id}`)

    return res.data
}

export default {
    shortUrl,
    login,
    logout,
    me,
    fetchOverview,
    fetchLinks,
    scanLinks,
    cleanupDeadLinks,
    cleanupBrokenLinks,
    updateLink,
    deleteLink,
    fetchLinkStats,
    fetchSettings,
    updateSettings,
    changePassword,
    fetchKeys,
    createKey,
    resetKey,
    deleteKey,
}
