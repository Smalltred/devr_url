<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 请求体积超出上限：HTTP 413。
 * 用于请求体与目标 URL 长度，避免单请求造成内存与数据库膨胀。
 */
final class PayloadTooLargeException extends \RuntimeException
{
    public function __construct(string $message = 'Payload Too Large')
    {
        parent::__construct($message);
    }
}
