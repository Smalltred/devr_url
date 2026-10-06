<?php

declare(strict_types=1);

namespace App\Services;

/**
 * 短码生成器：ID → Code。
 * 字符表与编码算法必须与原 Node.js 版逐位一致（见 backend/tools/gen-code-vectors.js 与兼容测试）。
 * 另提供管理端“短码长度/随机性”策略所需的补齐与随机生成。
 */
final class ShortCodeService
{
    private const ALPHABET = 'GS2w4R6789IbcdHEXhijWZAzopTrxPNq3sLMJalBVyQeDmY0nugtF5Uv1fkOCK';

    /**
     * 与原 JavaScript encode() 等价：62 进制转换，encode(0) 返回空串。
     */
    public function encode(int $id): string
    {
        if ($id < 0) {
            throw new \InvalidArgumentException('ID must be non-negative');
        }

        $base = strlen(self::ALPHABET);
        $code = '';
        while ($id > 0) {
            $code = self::ALPHABET[$id % $base].$code;
            $id = intdiv($id, $base);
        }

        return $code;
    }

    /**
     * 左补齐到指定长度（确定性策略）。
     * 多字符自然码的首字符必不为字母表首字符（62 进制首位恒 ≥1），
     * 且首字符本身不会作为自然短码出现（encode(0) 不生成），
     * 因此左补后与任何存量自然短码不冲突；与随机短码的冲突由调用方查重回退。
     */
    public function padTo(string $code, int $length): string
    {
        if (strlen($code) >= $length) {
            return $code;
        }

        return str_pad($code, $length, self::ALPHABET[0], STR_PAD_LEFT);
    }

    /**
     * 指定长度的均匀随机短码（唯一性由调用方查重保证）。
     */
    public function randomCode(int $length): string
    {
        $max = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }

        return $code;
    }
}
