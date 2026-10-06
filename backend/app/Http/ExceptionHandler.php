<?php

declare(strict_types=1);

namespace App\Http;

use App\Exceptions\ConfigurationException;
use App\Exceptions\ConflictException;
use App\Exceptions\InvalidUrlException;
use App\Exceptions\ShortCodeNotFoundException;
use App\Exceptions\StorageException;
use App\Exceptions\ThrottleException;
use App\Exceptions\UnauthorizedException;
use App\Exceptions\ValidationException;
use App\Support\Config;
use App\Support\Logger;

/**
 * 统一异常出口：对外仅输出固定文案（与原 Node 后端一致），
 * 对内写日志；仅开发环境（APP_DEBUG=true）回显真实异常消息。
 */
final class ExceptionHandler
{
    public function __construct(private readonly Config $config, private readonly Logger $logger)
    {
    }

    public function render(\Throwable $exception): Response
    {
        [$status, $publicMessage, $isServerError] = match (true) {
            $exception instanceof InvalidUrlException => [400, 'Incorrect URL format', false],
            $exception instanceof ValidationException => [400, $exception->getMessage() !== '' ? $exception->getMessage() : 'Validation Failed', false],
            $exception instanceof ConflictException => [409, 'Short Code Already Exists', false],
            $exception instanceof UnauthorizedException => [401, $exception->getMessage() !== '' ? $exception->getMessage() : 'Unauthorized', false],
            $exception instanceof ThrottleException => [429, 'Too Many Attempts', false],
            $exception instanceof ShortCodeNotFoundException => [404, 'Unknown URL', false],
            $exception instanceof StorageException => [503, 'Service Unavailable', true],
            $exception instanceof ConfigurationException => [500, 'Internal Server Error', true],
            default => [500, 'Internal Server Error', true],
        };

        $context = [
            'exception' => $exception::class,
            'message' => $exception->getMessage(),
        ];

        if ($isServerError) {
            $this->logger->error('request failed', $context);
        } else {
            $this->logger->info('request rejected', $context);
        }

        $message = $publicMessage;
        if ($this->config->get('app.debug') === true && $exception->getMessage() !== '') {
            $message = $exception->getMessage();
        }

        return Response::json(['error' => $message], $status);
    }
}
