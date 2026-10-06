<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\RequestThrottleRepository;

/**
 * 内存请求计数仓库替身：窗口语义对齐 SqliteRequestThrottleRepository
 * （同一窗口累加、窗口切换重置为 1）。
 */
final class InMemoryRequestThrottleRepository implements RequestThrottleRepository
{
    /** @var array<string, array{window_start: int, hits: int}> */
    public array $buckets = [];

    public function hit(string $scope, string $subject, int $windowStart): int
    {
        $key = $scope.'|'.$subject;
        $bucket = $this->buckets[$key] ?? null;

        $hits = $bucket !== null && $bucket['window_start'] === $windowStart ? $bucket['hits'] + 1 : 1;
        $this->buckets[$key] = ['window_start' => $windowStart, 'hits' => $hits];

        return $hits;
    }
}
