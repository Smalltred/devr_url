/**
 * 业务异常：携带 HTTP 状态码与对外的固定文案。
 *
 * 与 PHP 版 ExceptionHandler 的映射保持一致：
 * 4xx 记录 info `request rejected`，5xx 记录 error `request failed`；
 * APP_DEBUG=true 时对外文案替换为真实消息。
 */
export class AppError extends Error {
    /**
     * @param {number} status
     * @param {string} publicMessage 对外文案
     * @param {boolean} serverError 是否按 5xx 记录 error 日志
     * @param {string} [message] 内部消息（默认同对外文案）
     */
    constructor(status, publicMessage, serverError, message) {
        super(message ?? publicMessage)
        this.name = 'AppError'
        this.status = status
        this.publicMessage = publicMessage
        this.serverError = serverError
    }
}

export const invalidUrl = (message = 'Incorrect URL format') => new AppError(400, message, false)
export const validationError = (message) => new AppError(400, message || 'Validation Failed', false)
export const csrfError = (message) => new AppError(403, 'Cross-site request rejected', false, message)
export const conflictError = (message = 'Short Code Already Exists') => new AppError(409, message, false)
export const unauthorized = (message = 'Unauthorized') => new AppError(401, message, false)
// 与旧实现一致：对外固定文案，内部消息只进日志
export const throttleError = (message = 'Too Many Attempts') => new AppError(429, 'Too Many Attempts', false, message)
export const notFoundCode = (message = 'Unknown URL') => new AppError(404, message, false)
// 对外固定文案，内部消息只进日志（与旧实现一致）
export const payloadTooLarge = (message = 'Payload Too Large') => new AppError(413, 'Payload Too Large', false, message)
export const storageError = (message = 'Service Unavailable') => new AppError(503, message, true)
export const configurationError = (message = 'Internal Server Error') => new AppError(500, message, true)
