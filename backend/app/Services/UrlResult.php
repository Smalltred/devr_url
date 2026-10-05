<?php

declare(strict_types=1);

namespace App\Services;

/**
 * 创建短链的结果 DTO。
 */
final readonly class UrlResult
{
    public function __construct(
        public string $url,
        public string $code,
    ) {
    }
}
