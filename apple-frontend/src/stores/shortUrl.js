import { ref } from 'vue'
import QRCode from 'qrcode'
import copy from 'copy-to-clipboard'
import entityService, { errorMessage } from '../services/entity.js'

// 轻量全局状态：首页三件套共享（与旧实现同为模块级单例，行为保持一致）
const entity = ref(null)
const error = ref('')
// 请求进行中：旧实现没有这个状态，导致按钮无反馈且可重复提交
const loading = ref(false)

/**
 * 短链接状态与动作
 */
export function useShortUrl() {
    const clearError = () => {
        error.value = ''
    }

    const clearEntity = () => {
        entity.value = null
    }

    /**
     * 生成短链接：校验 → 调 API → 生成二维码 → 自动复制
     * @param {string} originUrl
     * @returns {Promise<boolean>} 是否发起了生成请求（格式合法）
     */
    const generate = async originUrl => {
        if (loading.value) {
            return false
        }

        clearError()
        clearEntity()

        if (!/^((https|http)?:\/\/)[^\s]+/.test(encodeURI(originUrl))) {
            error.value = 'URL 格式有误，请输入 http:// 或 https:// 开头的网址'

            return false
        }

        loading.value = true
        try {
            const res = await entityService.shortUrl(originUrl)
            const shortUrl = `${window.location.origin}/${res.code}`
            const qrcode = await QRCode.toDataURL(shortUrl, { errorCorrectionLevel: 'H' })
            entity.value = {
                originUrl,
                shortUrl,
                qrcode,
                code: res.code,
            }
            copy(shortUrl)

            return true
        } catch (err) {
            // 取后端的中文说明，而不是 axios 的英文提示
            error.value = errorMessage(err, '生成失败，请稍后再试')

            return true
        } finally {
            loading.value = false
        }
    }

    return { entity, error, loading, clearError, clearEntity, generate }
}
