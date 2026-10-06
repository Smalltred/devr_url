<?php

declare(strict_types=1);

namespace App\Security;

use App\Exceptions\ThrottleException;
use App\Http\Request;
use App\Repositories\RequestThrottleRepository;
use App\Support\IpHasher;

/**
 * 创建接口防滥用限流：按 IP 哈希在固定时间窗口内计数，超限抛 ThrottleException（HTTP 429）。
 *
 * IP 用匿名哈希而非明文存储，与点击统计口径一致（app_meta 中的安装级盐）。
 * max <= 0 表示关闭限流（保留给内网/仅管理员部署）。
 */
final class RequestRateLimiter
{
    public const SCOPE_CREATE = 'create';

    public function __construct(
        private readonly RequestThrottleRepository $repository,
        private readonly IpHasher $ipHasher,
        private readonly int $max,
        private readonly int $windowSeconds,
    ) {
    }

    public function assertAllowed(Request $request, string $scope = self::SCOPE_CREATE): void
    {
        if ($this->max <= 0 || $this->windowSeconds <= 0) {
            return;
        }

        // IP 不可用（如被代理剥离）时退化为全站共享桶，宁可偏严也不放开
        $subject = $this->ipHasher->hash($request->clientIp()) ?? 'anonymous';
        $windowStart = intdiv(time(), $this->windowSeconds) * $this->windowSeconds;

        if ($this->repository->hit($scope, $subject, $windowStart) > $this->max) {
            throw new ThrottleException();
        }
    }
}
