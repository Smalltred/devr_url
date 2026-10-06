<?php

declare(strict_types=1);

namespace App\Http;

/**
 * 轻量 HTTP 响应对象：测试可直接断言 status/headers/body。
 */
final class Response
{
    /**
     * @param array<string, string> $headers
     */
    public function __construct(
        private readonly int $status,
        private readonly array $headers,
        private readonly string $body,
    ) {
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, string> $headers
     */
    public static function json(array $data, int $status = 200, array $headers = []): self
    {
        $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($body === false) {
            $body = '{"error":"Internal Server Error"}';
        }

        $headers['content-type'] = 'application/json; charset=utf-8';

        return new self($status, $headers, $body);
    }

    public static function redirect(string $location, int $status = 302): self
    {
        if (strpbrk($location, "\r\n") !== false) {
            throw new \InvalidArgumentException('Invalid redirect location');
        }

        return new self($status, ['location' => $location], '');
    }

    /**
     * @param array<string, string> $headers
     */
    public static function text(string $body, int $status = 200, array $headers = []): self
    {
        $headers['content-type'] = 'text/plain; charset=utf-8';

        return new self($status, $headers, $body);
    }

    /**
     * @param array<string, string> $headers
     */
    public static function html(string $body, int $status = 200, array $headers = []): self
    {
        $headers['content-type'] = 'text/html; charset=utf-8';

        return new self($status, $headers, $body);
    }

    public function status(): int
    {
        return $this->status;
    }

    /**
     * @return array<string, string>
     */
    public function headers(): array
    {
        return $this->headers;
    }

    public function body(): string
    {
        return $this->body;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function decodedJson(): ?array
    {
        $decoded = json_decode($this->body, true);

        return is_array($decoded) ? $decoded : null;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name.': '.$value, true);
        }

        if ($this->body !== '') {
            echo $this->body;
        }
    }
}
