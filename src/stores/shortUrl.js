import { ref } from 'vue'
import QRCode from 'qrcode'
import copy from 'copy-to-clipboard'
import entityService from '../services/entity'

// 轻量全局状态（entity 与 error 两个切片，行为与旧版保持一致）
const entity = ref(null)
const error = ref('')

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
     * @returns 是否发起了生成请求（格式合法）
     */
    const generate = async originUrl => {
        clearError()
        clearEntity()
        if (!/^((https|http)?:\/\/)[^\s]+/.test(encodeURI(originUrl))) {
            error.value = 'URL 格式有误，请输入 http:// 或 https:// 开头的网址'
            return false
        }
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
            error.value = err.message
            return true
        }
    }

    return { entity, error, clearError, clearEntity, generate }
}
