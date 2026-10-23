/**
 * 短码生成器：ID → Code，算法与原 Node/PHP 版逐位一致（存量短码必须继续可解析）。
 */
import { randomInt } from 'node:crypto'

const ALPHABET = 'GS2w4R6789IbcdHEXhijWZAzopTrxPNq3sLMJalBVyQeDmY0nugtF5Uv1fkOCK'

export class ShortCodeService {
    /**
     * 62 进制转换；encode(0) 返回空串。
     *
     * @param {number} id
     */
    encode(id) {
        if (!Number.isInteger(id) || id < 0) {
            throw new TypeError('ID must be a non-negative integer')
        }

        const base = ALPHABET.length
        let value = id
        let code = ''
        while (value > 0) {
            code = ALPHABET[value % base] + code
            value = Math.floor(value / base)
        }

        return code
    }

    /**
     * 左侧补齐到指定长度（确定性策略）。
     * 多字符自然短码的首字符必不为字母表首字符（62 进制首位恒 ≥1），
     * 且首字符本身不会作为自然短码出现（encode(0) 不生成），故补齐后不会与存量自然短码冲突。
     *
     * @param {string} code
     * @param {number} length
     */
    padTo(code, length) {
        if (code.length >= length) {
            return code
        }

        return ALPHABET[0].repeat(length - code.length) + code
    }

    /**
     * 指定长度的均匀随机短码（唯一性由调用方查重保证）。
     *
     * @param {number} length
     */
    randomCode(length) {
        let code = ''
        for (let i = 0; i < length; i += 1) {
            code += ALPHABET[randomInt(0, ALPHABET.length)]
        }

        return code
    }
}

export { ALPHABET as SHORT_CODE_ALPHABET }
