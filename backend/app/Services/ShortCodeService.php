<?php

declare(strict_types=1);

namespace App\Services;

/**
 * 短码生成器：ID → Code。
 * 字符表与编码算法必须与原 Node.js 版逐位一致（见 backend/tools/gen-code-vectors.js 与兼容测试）。
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
}
