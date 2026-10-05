<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * URL 校验失败：HTTP 400。
 * 默认文案与原 Node 后端保持一致。
 */
final class InvalidUrlException extends \InvalidArgumentException
{
    public function __construct(string $message = 'Incorrect URL format')
    {
        parent::__construct($message);
    }
}
