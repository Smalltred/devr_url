import axios from "axios";

const api = axios.create({
    // 生产环境通过 Nginx 反代到 PHP 后端；留空表示与前端同源。
    // 需要跨域部署时设置 REACT_APP_API_BASE_URL（如 https://api.example.com）
    baseURL: process.env.REACT_APP_API_BASE_URL || '',
});

/**
 * 生成短链接
 * @param {string} url 原始链接
 * @returns 短链接
 */
const shortUrl = async url => {
    const res = await api.post('/url', { url });
    return res.data;
}

export default { shortUrl };
