<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 未登录或登录态失效：HTTP 401。
 */
final class UnauthorizedException extends \RuntimeException
{
    public function __construct(string $message = 'Unauthorized')
    {
        parent::__construct($message);
    }
}
