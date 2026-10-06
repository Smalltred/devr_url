<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 管理端表单校验失败：HTTP 400。
 * 文案面向管理界面展示，随异常消息原样返回（不含敏感信息）。
 */
final class ValidationException extends \InvalidArgumentException
{
    public function __construct(string $message = 'Validation Failed')
    {
        parent::__construct($message);
    }
}
