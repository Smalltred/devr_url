import axios from 'axios'

const api = axios.create({
    // 留空 = 与前端同源（推荐，配合 Nginx 把 /url、/api、短码路由反代到 PHP）
    // 跨域部署时设置 VITE_API_BASE_URL（构建时读取，如 https://api.example.com）
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    // 登录态走 HttpOnly Cookie，跨域部署时也需要携带
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
 * 生成短链接
 * @param {string} url 原始链接
 * @returns 短链接
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

const fetchOverview = async () => {
    const res = await api.get('/api/admin/overview')
    return res.data
}

/**
 * @param {{page?: number, per_page?: number, q?: string}} params
 */
const fetchLinks = async params => {
    const res = await api.get('/api/admin/links', { params })
    return res.data
}

const updateLink = async (code, payload) => {
    const res = await api.put(`/api/admin/links/${encodeURIComponent(code)}`, payload)
    return res.data
}

const deleteLink = async code => {
    const res = await api.delete(`/api/admin/links/${encodeURIComponent(code)}`)
    return res.data
}

const fetchLinkStats = async code => {
    const res = await api.get(`/api/admin/links/${encodeURIComponent(code)}/stats`)
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
