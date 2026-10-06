<?php

declare(strict_types=1);

namespace App\Http;

/**
 * 轻量 HTTP 请求对象：统一封装 $_SERVER / php://input，
 * 业务代码禁止直接访问超全局变量。
 */
final class Request
{
    private readonly mixed $decodedBody;

    /**
     * @param array<string, string> $query
     * @param array<string, string> $headers
     * @param array<string, string> $params
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly string $rawBody,
        private readonly array $query = [],
        private readonly array $headers = [],
        private array $params = [],
        private readonly string $remoteAddress = '',
    ) {
        $this->decodedBody = $rawBody === '' ? null : json_decode($rawBody, true);
    }

    public static function fromGlobals(): self
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = rawurldecode((string) parse_url($uri, PHP_URL_PATH));
        if ($path === '') {
            $path = '/';
        }

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with((string) $key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr((string) $key, 5)))] = (string) $value;
            }
        }

        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $rawBody = (string) file_get_contents('php://input');

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path,
            $rawBody,
            $_GET,
            $headers,
            [],
            (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        );
    }

    /**
     * 解析后的 JSON 请求体；缺失或非法时返回 null。
     */
    public function json(): mixed
    {
        return $this->decodedBody;
    }

    public function routeParam(string $name): string
    {
        return isset($this->params[$name]) ? (string) $this->params[$name] : '';
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    /**
     * 客户端 IP（REMOTE_ADDR 原值，代理判定交给部署层）。
     */
    public function clientIp(): string
    {
        return $this->remoteAddress;
    }

    /**
     * 按名称读取 Cookie；不存在返回 null。
     */
    public function cookie(string $name): ?string
    {
        $header = $this->header('cookie');
        if ($header === null) {
            return null;
        }

        foreach (explode(';', $header) as $pair) {
            $parts = explode('=', $pair, 2);
            if (count($parts) === 2 && trim($parts[0]) === $name) {
                $decoded = rawurldecode(trim($parts[1]));

                return $decoded === '' ? null : $decoded;
            }
        }

        return null;
    }

    public function queryParam(string $key): ?string
    {
        return $this->query[$key] ?? null;
    }

    /**
     * @param array<string, string> $params
     */
    public function withParams(array $params): self
    {
        return new self($this->method, $this->path, $this->rawBody, $this->query, $this->headers, $params);
    }
}
