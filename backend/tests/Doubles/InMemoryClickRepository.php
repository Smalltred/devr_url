<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\ClickRepository;

/**
 * 内存点击仓库替身：聚合语义对齐 SqliteClickRepository（UTC 日切、去重口径一致）。
 */
final class InMemoryClickRepository implements ClickRepository
{
    /** @var list<array{code: string, clicked_at: string, referer: ?string, referer_host: ?string, device: string, ip_hash: ?string}> */
    public array $clicks = [];

    public function record(string $code, array $context): void
    {
        $this->clicks[] = [
            'code' => $code,
            'clicked_at' => gmdate('Y-m-d H:i:s'),
            'referer' => $context['referer'],
            'referer_host' => $context['referer_host'],
            'device' => $context['device'],
            'ip_hash' => $context['ip_hash'],
        ];
    }

    public function totalByCodes(array $codes): array
    {
        $map = [];
        foreach ($this->clicks as $click) {
            if (in_array($click['code'], $codes, true)) {
                $map[$click['code']] = ($map[$click['code']] ?? 0) + 1;
            }
        }

        return $map;
    }

    public function todayByCodes(array $codes): array
    {
        $today = gmdate('Y-m-d');
        $map = [];
        foreach ($this->clicks as $click) {
            if (in_array($click['code'], $codes, true) && $click['clicked_at'] >= $today) {
                $map[$click['code']] = ($map[$click['code']] ?? 0) + 1;
            }
        }

        return $map;
    }

    public function totalAll(): int
    {
        return count($this->clicks);
    }

    public function todayAll(): int
    {
        $today = gmdate('Y-m-d');

        return count(array_filter($this->clicks, static fn (array $click): bool => $click['clicked_at'] >= $today));
    }

    public function topCodes(int $limit): array
    {
        $counts = [];
        foreach ($this->clicks as $click) {
            $counts[$click['code']] = ($counts[$click['code']] ?? 0) + 1;
        }
        arsort($counts);

        $list = [];
        foreach ($counts as $code => $clicks) {
            $list[] = ['code' => (string) $code, 'clicks' => (int) $clicks];
        }

        return array_slice($list, 0, $limit);
    }

    public function dailySeries(?string $code, int $days): array
    {
        $floor = gmdate('Y-m-d', time() - ($days - 1) * 86400);
        $counts = [];
        foreach ($this->clicks as $click) {
            if ($code !== null && $click['code'] !== $code) {
                continue;
            }
            $date = (string) substr($click['clicked_at'], 0, 10);
            if ($date < $floor) {
                continue;
            }
            $counts[$date] = ($counts[$date] ?? 0) + 1;
        }
        ksort($counts);

        $series = [];
        foreach ($counts as $date => $clicks) {
            $series[] = ['date' => (string) $date, 'clicks' => (int) $clicks];
        }

        return $series;
    }

    public function visitors(string $code): int
    {
        $seen = [];
        foreach ($this->clicks as $click) {
            if ($click['code'] === $code && $click['ip_hash'] !== null) {
                $seen[$click['ip_hash']] = true;
            }
        }

        return count($seen);
    }

    public function topRefererHosts(string $code, int $limit): array
    {
        $counts = [];
        foreach ($this->clicks as $click) {
            if ($click['code'] !== $code || $click['referer_host'] === null || $click['referer_host'] === '') {
                continue;
            }
            $counts[$click['referer_host']] = ($counts[$click['referer_host']] ?? 0) + 1;
        }
        arsort($counts);

        $list = [];
        foreach ($counts as $host => $clicks) {
            $list[] = ['referer_host' => (string) $host, 'clicks' => (int) $clicks];
        }

        return array_slice($list, 0, $limit);
    }

    public function deviceSplit(string $code): array
    {
        $split = ['mobile' => 0, 'desktop' => 0];
        foreach ($this->clicks as $click) {
            if ($click['code'] === $code && isset($split[$click['device']])) {
                $split[$click['device']]++;
            }
        }

        return $split;
    }

    public function deleteByCode(string $code): void
    {
        $this->clicks = array_values(array_filter(
            $this->clicks,
            static fn (array $click): bool => $click['code'] !== $code,
        ));
    }
}
