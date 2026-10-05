<?php

declare(strict_types=1);

namespace App\Http;

/**
 * 轻量路由：支持精确路径与单段参数（/{code}）。
 * 命中但方法不符返回 405；完全未命中返回 404。
 */
final class Router
{
    /**
     * @var list<array{method: string, regex: string, params: list<string>, handler: callable}>
     */
    private array $routes = [];

    public function get(string $pattern, callable $handler): void
    {
        $this->add('GET', $pattern, $handler);
    }

    public function post(string $pattern, callable $handler): void
    {
        $this->add('POST', $pattern, $handler);
    }

    public function dispatch(Request $request): Response
    {
        $method = $request->method === 'HEAD' ? 'GET' : $request->method;
        $allowed = [];

        foreach ($this->routes as $route) {
            if (preg_match($route['regex'], $request->path, $matches) !== 1) {
                continue;
            }

            if ($route['method'] !== $method) {
                $allowed[] = $route['method'];

                continue;
            }

            $params = [];
            foreach ($route['params'] as $index => $name) {
                $params[$name] = $matches[$index + 1] ?? '';
            }

            $handler = $route['handler'];

            return $handler($request->withParams($params));
        }

        if ($allowed !== []) {
            return Response::json(
                ['error' => 'Method Not Allowed'],
                405,
                ['allow' => implode(', ', array_unique($allowed))],
            );
        }

        return Response::json(['error' => 'Not Found'], 404);
    }

    private function add(string $method, string $pattern, callable $handler): void
    {
        $paramNames = [];
        $regex = preg_replace_callback(
            '/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/',
            static function (array $match) use (&$paramNames): string {
                $paramNames[] = $match[1];

                return '([^/]+)';
            },
            $pattern,
        );
        \assert($regex !== null);

        $this->routes[] = [
            'method' => $method,
            'regex' => '#^'.$regex.'/?$#',
            'params' => $paramNames,
            'handler' => $handler,
        ];
    }
}
