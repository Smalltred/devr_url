<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\ClickRepository;

/**
 * 永远写入失败的点击仓库替身：模拟存储故障，验证点击采集失败不影响跳转。
 */
final class FailingClickRepository implements ClickRepository
{
    public function record(string $code, array $context): void
    {
        throw new \RuntimeException('storage down');
    }

    public function totalByCodes(array $codes): array
    {
        return [];
    }

    public function todayByCodes(array $codes): array
    {
        return [];
    }

    public function totalAll(): int
    {
        return 0;
    }

    public function todayAll(): int
    {
        return 0;
    }

    public function topCodes(int $limit): array
    {
        return [];
    }

    public function series(?string $code, string $period, int $buckets): array
    {
        return [];
    }

    public function visitors(string $code): int
    {
        return 0;
    }

    public function topRefererHosts(string $code, int $limit): array
    {
        return [];
    }

    public function deviceSplit(string $code): array
    {
        return ['mobile' => 0, 'desktop' => 0];
    }

    public function deleteByCode(string $code): void
    {
    }
}
