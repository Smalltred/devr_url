<?php

declare(strict_types=1);

namespace App\Support;

/**
 * JSON 行日志：正常业务写入 app.log，异常与系统错误写入 error.log。
 * 刻意不记录请求体与 URL，避免敏感信息进入日志；写失败时降级到 SAPI error_log。
 */
final class Logger
{
    public function __construct(private readonly string $directory)
    {
    }

    /**
     * @param array<string, mixed> $context
     */
    public function info(string $message, array $context = []): void
    {
        $this->write('app.log', 'info', $message, $context);
    }

    /**
     * @param array<string, mixed> $context
     */
    public function error(string $message, array $context = []): void
    {
        $this->write('error.log', 'error', $message, $context);
    }

    /**
     * @param array<string, mixed> $context
     */
    private function write(string $file, string $level, string $message, array $context): void
    {
        $record = [
            'timestamp' => date(DATE_ATOM),
            'level' => $level,
            'message' => $message,
        ];

        if ($context !== []) {
            $record['context'] = $context;
        }

        $line = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($line === false) {
            error_log('short-url: unable to encode log record');

            return;
        }

        if (!is_dir($this->directory)) {
            @mkdir($this->directory, 0775, true);
        }

        if (@file_put_contents($this->directory.'/'.$file, $line.PHP_EOL, FILE_APPEND | LOCK_EX) === false) {
            error_log($line);
        }
    }
}
