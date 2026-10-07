<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 点击统计仓库契约。生产实现为 SQLite（SqliteClickRepository），测试实现为内存替身。
 * 时间口径统一为 UTC：写入依赖 clicked_at 默认值 datetime('now')，聚合使用 date('now')。
 */
interface ClickRepository
{
    /**
     * 记录一次点击。
     *
     * @param array{referer: ?string, referer_host: ?string, device: string, ip_hash: ?string} $context
     */
    public function record(string $code, array $context): void;

    /**
     * 指定短码集合的总点击数。
     *
     * @param list<string> $codes
     *
     * @return array<string, int> code => clicks（无点击的短码不出现在结果中）
     */
    public function totalByCodes(array $codes): array;

    /**
     * 指定短码集合今日（UTC）点击数。
     *
     * @param list<string> $codes
     *
     * @return array<string, int> code => clicks
     */
    public function todayByCodes(array $codes): array;

    public function totalAll(): int;

    public function todayAll(): int;

    /**
     * 点击最多的短码。
     *
     * @return list<array{code: string, clicks: int}>
     */
    public function topCodes(int $limit): array;

    /**
     * 趋势序列：按粒度 $period（day/week/month/year）聚合。
     * $code 为 null 时统计全站；只返回有数据的桶，缺失桶由调用方补零。
     *
     * @param 'day'|'week'|'month'|'year' $period
     *
     * @return list<array{date: string, clicks: int}> date 为桶起始日（Y-m-d）
     */
    public function series(?string $code, string $period, int $buckets): array;

    /**
     * 独立访客数（按 ip_hash 去重；ip_hash 为 NULL 的记录不计入）。
     */
    public function visitors(string $code): int;

    /**
     * 来源域名 Top N。
     *
     * @return list<array{referer_host: string, clicks: int}>
     */
    public function topRefererHosts(string $code, int $limit): array;

    /**
     * 设备分布（仅 mobile/desktop 两类）。
     *
     * @return array{mobile: int, desktop: int}
     */
    public function deviceSplit(string $code): array;

    public function deleteByCode(string $code): void;
}
