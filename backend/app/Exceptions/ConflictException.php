<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 资源冲突（如新短码已被占用）：HTTP 409。
 */
final class ConflictException extends \RuntimeException
{
    public function __construct(string $message = 'Short Code Already Exists')
    {
        parent::__construct($message);
    }
}
