<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 通用请求计数仓库契约（request_throttle 表）。
 * 按 (scope, subject) 维度在时间窗口内累计次数，用于创建接口等防滥用限流。
 */
interface RequestThrottleRepository
{
    /**
     * 累加一次并返回当前窗口内的累计次数。
     * 窗口切换时计数重置为 1。
     */
    public function hit(string $scope, string $subject, int $windowStart): int;
}
