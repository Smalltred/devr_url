<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 登录失败次数过多被限流：HTTP 429。
 */
final class ThrottleException extends \RuntimeException
{
    public function __construct(string $message = 'Too Many Attempts')
    {
        parent::__construct($message);
    }
}
