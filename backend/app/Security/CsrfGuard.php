<?php

declare(strict_types=1);

namespace App\Security;

use App\Exceptions\CsrfException;
use App\Http\Request;

/**
 * CSRF 防护：校验写请求的 Origin/Referer 是否与本站同源。
 *
 * 为什么不能只依赖 SameSite=Strict：旧浏览器与部分 WebView 不识别该属性，
 * 站点被挂到 http:// 子域或同站点的其它端口时 Strict 也不覆盖；
 * Cookie 是环境凭据（浏览器自动附带），因此对状态变更请求（非 GET/HEAD）再做一次来源校验。
 *
 * 例外：显式携带 API Key 头（Authorization: Bearer / X-API-Key）的请求不做来源校验。
 * CSRF 成立的前提是「浏览器自动附带凭据」；自定义请求头只能由脚本显式设置，
 * 跨站表单无法添加，浏览器跨域设置自定义头会先触发预检（本服务不返回 CORS 允许头）。
 * 因此持有 Key 的调用方本身就具备凭据，不构成 CSRF 场景——开放 API 的脚本客户端依赖此例外。
 *
 * 同源判定以请求的 Host 头为基准，因此反向代理/自定义域名部署无需额外配置；
 * 反向代理场景由部署层保证 Host 与 X-Forwarded-Host 一致（见 deploy/nginx）。
 */
final class CsrfGuard
{
    private const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

    /**
     * @param list<string> $allowedOrigins 额外允许的来源（协议+主机+可选端口）
     */
    public function __construct(
        private readonly array $allowedOrigins = [],
        private readonly bool $allowMissingOrigin = false,
    ) {
    }

    public function assertSafe(Request $request): void
    {
        if (in_array($request->method, self::SAFE_METHODS, true)) {
            return;
        }

        // 显式凭据头 = 非环境凭据，不存在被浏览器自动带发的可能
        if ($this->hasExplicitCredential($request)) {
            return;
        }

        $origin = $this->originFrom($request);
        if ($origin === null) {
            // 浏览器发起的跨站表单一定带 Origin（现代浏览器）或 Referer；
            // 两者都缺失通常是非浏览器客户端（curl/脚本），是否放行由部署方决定。
            if ($this->allowMissingOrigin) {
                return;
            }

            throw new CsrfException('Missing Origin or Referer header');
        }

        if ($this->isSameOrigin($origin, $request) || $this->isAllowed($origin)) {
            return;
        }

        throw new CsrfException('Cross-site request rejected');
    }

    /**
     * 请求是否携带显式的 API Key 凭据头。
     */
    private function hasExplicitCredential(Request $request): bool
    {
        $apiKey = $request->header('x-api-key');
        if (is_string($apiKey) && trim($apiKey) !== '') {
            return true;
        }

        $authorization = $request->header('authorization');

        return is_string($authorization) && preg_match('/^Bearer\s+\S+/i', $authorization) === 1;
    }

    /**
     * 取请求声明的来源：优先 Origin，其次 Referer 的协议+主机部分。
     */
    private function originFrom(Request $request): ?string
    {
        $origin = $request->header('origin');
        if (is_string($origin) && trim($origin) !== '') {
            // 带重定向的跨站请求会发送 "null"，不能当作有效来源
            $trimmed = rtrim(trim($origin), '/');

            return strtolower($trimmed) === 'null' ? null : $trimmed;
        }

        $referer = $request->header('referer');
        if (!is_string($referer) || trim($referer) === '') {
            return null;
        }

        $parts = parse_url(trim($referer));
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        $port = isset($parts['port']) ? ':'.(int) $parts['port'] : '';

        return strtolower($parts['scheme'].'://'.$parts['host'].$port);
    }

    private function isSameOrigin(string $origin, Request $request): bool
    {
        $host = $request->header('host');
        if (!is_string($host) || trim($host) === '') {
            return false;
        }

        $host = strtolower(trim($host));
        // 协议不参与比较：内网 TLS 卸载（Nginx 终结 HTTPS、回源 HTTP）下
        // Origin 为 https 而请求本身是 http，属同站请求，不应误杀。
        foreach (['https://', 'http://'] as $scheme) {
            if ($origin === $scheme.$host) {
                return true;
            }
        }

        return false;
    }

    private function isAllowed(string $origin): bool
    {
        foreach ($this->allowedOrigins as $allowed) {
            if (strtolower(rtrim($allowed, '/')) === $origin) {
                return true;
            }
        }

        return false;
    }
}
