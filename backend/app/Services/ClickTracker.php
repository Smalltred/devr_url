<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\Request;
use App\Repositories\ClickRepository;
use App\Support\IpHasher;

/**
 * 点击采集：从请求中提取来源与设备信息并落库。
 * 只做最小化采集：不存原始 UA 与 IP，仅存来源域名、设备二分类与 IP 匿名哈希。
 * 完整 Referer 默认不落库（见 config privacy.store_full_referer）：
 * 来源页的查询串可能含 token/一次性链接，长期留存属隐私风险；
 * 后台「来源域名 Top 10」只用 referer_host，不受影响。
 */
final class ClickTracker
{
    private const MAX_REFERER_LENGTH = 500;

    private const MAX_REFERER_HOST_LENGTH = 120;

    public function __construct(
        private readonly ClickRepository $clicks,
        private readonly IpHasher $ipHasher,
        private readonly bool $storeFullReferer = false,
    ) {
    }

    public function track(Request $request, string $code): void
    {
        $referer = $request->header('referer');
        $userAgent = $request->header('user-agent') ?? '';

        $this->clicks->record($code, [
            'referer' => $this->storeFullReferer ? self::truncate($referer, self::MAX_REFERER_LENGTH) : null,
            'referer_host' => self::truncate(self::hostOf($referer), self::MAX_REFERER_HOST_LENGTH),
            'device' => self::deviceOf($userAgent),
            'ip_hash' => $this->ipHasher->hash($request->clientIp()),
        ]);
    }

    private static function hostOf(?string $referer): ?string
    {
        if ($referer === null || $referer === '') {
            return null;
        }

        $host = parse_url($referer, PHP_URL_HOST);

        return is_string($host) && $host !== '' ? strtolower($host) : null;
    }

    private static function deviceOf(string $userAgent): string
    {
        if ($userAgent === '') {
            return 'unknown';
        }

        return stripos($userAgent, 'mobile') !== false ? 'mobile' : 'desktop';
    }

    private static function truncate(?string $value, int $length): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return mb_substr($value, 0, $length);
    }
}
