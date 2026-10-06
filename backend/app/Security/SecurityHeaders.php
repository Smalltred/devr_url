<?php

declare(strict_types=1);

namespace App\Security;

use App\Http\Request;
use App\Http\Response;

/**
 * 全站统一安全响应头。
 *
 * CSP 必须与前端产物匹配，否则会直接打断 SPA：
 * - 构建产物为外链 /assets/*.js 与 /assets/*.css，但 index.html 内联了两段脚本
 *   （首帧主题、Google Analytics 引导），因此对 HTML 响应按内容动态计算 sha256 放行，
 *   避免写死哈希后在 index.html 变动时失效；
 * - style-src 需要 'unsafe-inline'：Vue 的 :style 绑定写 style 属性；
 * - 图片允许 data:（二维码为 data URL）与 https:（本站参考图/站点图标）；
 * - 默认放行 Google Analytics（index.html 内置），可通过配置收紧。
 *
 * frame-ancestors 与 X-Frame-Options 双写：前者覆盖支持 CSP 的浏览器，后者兼容旧浏览器。
 * HSTS 默认不下发，仅在部署方确认全站 HTTPS 后按 SECURITY_HSTS_MAX_AGE 开启。
 */
final class SecurityHeaders
{
    /**
     * @param list<string> $scriptExtra  额外的脚本来源（如统计脚本域名）
     * @param list<string> $scriptHashes HTML 内联脚本的 sha256 哈希（含 sha256- 前缀）
     * @param list<string> $connectExtra 额外的 connect-src 来源（跨域部署的后端源）
     * @param int          $hstsMaxAge   HSTS 有效期（秒），0 = 不下发
     *
     * @return array<string, string>
     */
    public static function all(
        array $scriptExtra = [],
        array $scriptHashes = [],
        array $connectExtra = [],
        int $hstsMaxAge = 0,
    ): array {
        $script = array_merge(["'self'"], $scriptHashes, $scriptExtra);
        $connect = array_merge(["'self'"], $connectExtra);

        $headers = [
            'x-content-type-options' => 'nosniff',
            'x-frame-options' => 'DENY',
            'referrer-policy' => 'strict-origin-when-cross-origin',
            'permissions-policy' => 'geolocation=(), microphone=(), camera=(), payment=()',
            'content-security-policy' => implode('; ', [
                "default-src 'self'",
                'script-src '.implode(' ', array_unique($script)),
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self' data:",
                'connect-src '.implode(' ', array_unique($connect)),
                "form-action 'self'",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "object-src 'none'",
            ]),
        ];

        if ($hstsMaxAge > 0) {
            $headers['strict-transport-security'] = 'max-age='.$hstsMaxAge.'; includeSubDomains';
        }

        return $headers;
    }

    /**
     * 附加安全头（不覆盖处理器已显式设置的同名头）。
     *
     * @param list<string> $scriptExtra
     * @param list<string> $connectExtra
     */
    public static function apply(
        Response $response,
        array $scriptExtra = [],
        array $connectExtra = [],
        int $hstsMaxAge = 0,
    ): Response {
        $hashes = [];
        $contentType = $response->header('content-type') ?? '';
        if (str_starts_with($contentType, 'text/html')) {
            $hashes = self::inlineScriptHashes($response->body());
        }

        $merged = $response->headers();
        foreach (self::all($scriptExtra, $hashes, $connectExtra, $hstsMaxAge) as $name => $value) {
            if (!array_key_exists($name, $merged)) {
                $merged[$name] = $value;
            }
        }

        return new Response($response->status(), $merged, $response->body());
    }

    /**
     * 提取 HTML 中内联脚本（无 src）的 sha256，供 CSP 放行。
     * 只对完全静态的引导脚本有效；任一内联脚本被注入内容都会使哈希失配而被拦截，
     * 这正是 CSP 期望的行为。
     *
     * @return list<string>
     */
    public static function inlineScriptHashes(string $html): array
    {
        if (preg_match_all('#<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>#is', $html, $matches) === false) {
            return [];
        }

        $hashes = [];
        foreach ($matches[1] as $body) {
            $hashes[] = "'sha256-".base64_encode(hash('sha256', (string) $body, true))."'";
        }

        return $hashes;
    }

    /**
     * 请求是否经 HTTPS（部署层 TLS 终结时由 X-Forwarded-Proto 传递）。
     */
    public static function isSecureRequest(Request $request): bool
    {
        $proto = $request->header('x-forwarded-proto');

        return is_string($proto) && strtolower(trim($proto)) === 'https';
    }
}
