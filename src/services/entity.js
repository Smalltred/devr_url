import axios from 'axios'

const api = axios.create({
    // 留空 = 与前端同源（推荐，配合 Nginx 把 /url、/api、短码路由反代到 PHP）
    // 跨域部署时设置 VITE_API_BASE_URL（构建时读取，如 https://api.example.com）
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
})

/**
 * 生成短链接
 * @param {string} url 原始链接
 * @returns 短链接
 */
const shortUrl = async url => {
    const res = await api.post('/url', { url })
    return res.data
}

export default { shortUrl }
