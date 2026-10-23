/**
 * JSON 行日志：正常业务写 app.log，异常与系统错误写 error.log。
 *
 * 刻意不记录请求体与 URL，避免敏感信息进入日志；写失败时降级到 stderr。
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export class Logger {
    /**
     * @param {string} directory
     */
    constructor(directory) {
        this.directory = directory
    }

    /**
     * @param {string} message
     * @param {object} [context]
     */
    info(message, context = {}) {
        this.#write('app.log', 'info', message, context)
    }

    /**
     * @param {string} message
     * @param {object} [context]
     */
    error(message, context = {}) {
        this.#write('error.log', 'error', message, context)
    }

    #write(file, level, message, context) {
        const record = {
            timestamp: new Date().toISOString(),
            level,
            message,
        }
        if (context && Object.keys(context).length > 0) {
            record.context = context
        }

        let line
        try {
            line = JSON.stringify(record)
        } catch {
            console.error('short-url: unable to encode log record')

            return
        }

        if (!existsSync(this.directory)) {
            try {
                mkdirSync(this.directory, { recursive: true, mode: 0o775 })
            } catch {
                // 目录建不了就退化为 stderr
            }
        }

        try {
            appendFileSync(join(this.directory, file), `${line}\n`, { mode: 0o664 })
        } catch {
            console.error(line)
        }
    }
}
