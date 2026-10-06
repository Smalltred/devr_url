<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 跨站请求伪造防护拦截：跨站来源的写操作被拒绝，HTTP 403。
 */
final class CsrfException extends \RuntimeException
{
    public function __construct(string $message = 'Cross-site request rejected')
    {
        parent::__construct($message);
    }
}
