<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 短码不存在：HTTP 404。
 * 默认文案与原 Node 后端保持一致。
 */
final class ShortCodeNotFoundException extends \RuntimeException
{
    public function __construct(string $message = 'Unknown URL')
    {
        parent::__construct($message);
    }
}
