<?php

declare(strict_types=1);

namespace App\Services;

use App\Cache\Store;
use App\Exceptions\ConflictException;
use App\Exceptions\ShortCodeNotFoundException;
use App\Exceptions\ValidationException;
use App\Repositories\ClickRepository;
use App\Repositories\UrlRepository;
use App\Validation\UrlValidator;

/**
 * 管理端业务编排：概览统计、短链分页/搜索、编辑、删除、单链统计、站点设置与缓存状态。
 * 每日序列与全站统计的时间口径统一为 UTC，缺失日期在内存中补零。
 */
final class AdminService
{
    /** GET /admin 已被管理面板占用，禁止改用该短码 */
    private const RESERVED_CODES = ['admin'];

    private const CODE_PATTERN = '/^[0-9A-Za-z]{1,32}$/';

    /** 各粒度的默认展示桶数（约 2 周 / 3 个月 / 一年 / 五年） */
    private const PERIOD_BUCKETS = [
        'day' => 14,
        'week' => 12,
        'month' => 12,
        'year' => 5,
    ];

    private const MAX_CODE_MIN_LENGTH = 16;

    /** 开启随机短码的最低长度：62³ ≈ 24 万，避免高频碰撞 */
    private const MIN_RANDOM_LENGTH = 3;

    public function __construct(
        private readonly UrlRepository $urls,
        private readonly ClickRepository $clicks,
        private readonly UrlValidator $validator,
        private readonly SettingsService $settings,
        private readonly Store $cache,
    ) {
    }

    /**
     * 站点设置视图（不包含密码哈希等敏感值）。
     *
     * @return array<string, mixed>
     */
    public function settingsView(): array
    {
        return [
            'code_min_length' => $this->settings->codeMinLength(),
            'code_random' => $this->settings->codeRandom(),
            'require_login' => $this->settings->requireLogin(),
            // env = 沿用环境变量配置（含默认密码）；custom = 已在后台修改过
            'password_source' => $this->settings->hasCustomPassword() ? 'custom' : 'env',
            'cache_ttl' => $this->settings->cacheTtl(),
            'cache_negative_ttl' => $this->settings->cacheNegativeTtl(),
            'cache' => $this->cacheStatus(),
        ];
    }

    /**
     * 缓存状态视图：驱动、可用性、服务端地址与命中统计（供设置页展示）。
     *
     * @return array<string, mixed>
     */
    private function cacheStatus(): array
    {
        $status = $this->cache->status();

        return [
            'driver' => $status['driver'],
            'available' => $status['available'],
            'servers' => $status['servers'],
            'stats' => $this->cache->stats(),
        ];
    }

    /**
     * 更新站点设置：仅处理请求中出现的键，校验通过后落库。
     *
     * @param mixed $payload 请求体（未校验类型）
     *
     * @return array<string, mixed> 保存后的设置视图
     */
    public function updateSettings(mixed $payload): array
    {
        $body = is_array($payload) ? $payload : [];
        $values = [];

        if (array_key_exists('code_min_length', $body)) {
            $length = filter_var($body['code_min_length'], FILTER_VALIDATE_INT);
            if ($length === false || $length < 1 || $length > self::MAX_CODE_MIN_LENGTH) {
                throw new ValidationException('短链长度需为 1-'.self::MAX_CODE_MIN_LENGTH.' 的整数');
            }
            $values[SettingsService::KEY_CODE_MIN_LENGTH] = (string) $length;
        }

        if (array_key_exists('code_random', $body)) {
            $values[SettingsService::KEY_CODE_RANDOM] = $this->normalizeBool($body['code_random']) ? '1' : '0';
        }

        if (array_key_exists('require_login', $body)) {
            $values[SettingsService::KEY_REQUIRE_LOGIN] = $this->normalizeBool($body['require_login']) ? '1' : '0';
        }

        if (array_key_exists('cache_ttl', $body)) {
            $ttl = filter_var($body['cache_ttl'], FILTER_VALIDATE_INT);
            if ($ttl === false || $ttl < 0 || $ttl > 86400) {
                throw new ValidationException('缓存有效期需为 0-86400 秒的整数（0 = 不缓存）');
            }
            $values[SettingsService::KEY_CACHE_TTL] = (string) $ttl;
        }

        if (array_key_exists('cache_negative_ttl', $body)) {
            $ttl = filter_var($body['cache_negative_ttl'], FILTER_VALIDATE_INT);
            if ($ttl === false || $ttl < 0 || $ttl > 3600) {
                throw new ValidationException('负缓存有效期需为 0-3600 秒的整数（0 = 不缓存不存在短码）');
            }
            $values[SettingsService::KEY_CACHE_NEGATIVE_TTL] = (string) $ttl;
        }

        // 校验合并后的有效组合：随机短码要求长度达标（本次未提交的键取当前已存值）
        $randomValue = $values[SettingsService::KEY_CODE_RANDOM] ?? ($this->settings->codeRandom() ? '1' : '0');
        $lengthValue = (int) ($values[SettingsService::KEY_CODE_MIN_LENGTH] ?? (string) $this->settings->codeMinLength());
        if ($randomValue === '1' && $lengthValue < self::MIN_RANDOM_LENGTH) {
            throw new ValidationException('开启随机短码后，长度至少为 '.self::MIN_RANDOM_LENGTH);
        }

        if ($values !== []) {
            $this->settings->save($values);
        }

        return $this->settingsView();
    }

    private function normalizeBool(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 'true' || $value === 'on';
    }

    /**
     * 全站概览：链接总数、总点击、今日点击、按粒度聚合的趋势、点击 Top 10。
     *
     * @param string $period 趋势粒度：day / week / month / year
     *
     * @return array<string, mixed>
     */
    public function overview(string $period = 'day'): array
    {
        $topLinks = [];
        foreach ($this->clicks->topCodes(10) as $row) {
            $topLinks[] = [
                'code' => $row['code'],
                'url' => $this->urls->findByCode($row['code']) ?? '',
                'clicks' => $row['clicks'],
            ];
        }

        $period = $this->normalizePeriod($period);

        return [
            'links' => $this->urls->countAll(),
            'total_clicks' => $this->clicks->totalAll(),
            'clicks_today' => $this->clicks->todayAll(),
            'period' => $period,
            'daily' => $this->fillSeries($this->clicks->series(null, $period, self::PERIOD_BUCKETS[$period]), $period),
            'top_links' => $topLinks,
        ];
    }

    /**
     * 粒度兜底：非法值回落为 day，避免拼进 SQL 与数组下标。
     *
     * @return 'day'|'week'|'month'|'year'
     */
    private function normalizePeriod(string $period): string
    {
        return match ($period) {
            'week' => 'week',
            'month' => 'month',
            'year' => 'year',
            default => 'day',
        };
    }

    /**
     * 短链分页列表（附每个短码的今日/累计点击）。
     *
     * @return array<string, mixed>
     */
    public function links(int $page, int $perPage, string $query): array
    {
        $page = max(1, $page);
        $perPage = min(100, max(1, $perPage));

        $result = $this->urls->paginate($perPage, ($page - 1) * $perPage, $query);
        $codes = array_map(static fn (array $item): string => $item['code'], $result['items']);
        $totals = $this->clicks->totalByCodes($codes);
        $todays = $this->clicks->todayByCodes($codes);

        $items = [];
        foreach ($result['items'] as $item) {
            $items[] = [
                'code' => $item['code'],
                'url' => $item['url'],
                'created_at' => $item['created_at'],
                'clicks' => $totals[$item['code']] ?? 0,
                'clicks_today' => $todays[$item['code']] ?? 0,
            ];
        }

        return [
            'total' => $result['total'],
            'page' => $page,
            'per_page' => $perPage,
            'items' => $items,
        ];
    }

    /**
     * 编辑短链：可改目标 URL 与短码（二者至少传其一，缺省保持原值）。
     *
     * @param mixed $payload 请求体（未校验类型）
     *
     * @return array{code: string, url: string}
     */
    public function updateLink(string $code, mixed $payload): array
    {
        $currentUrl = $this->urls->findByCode($code);
        if ($currentUrl === null) {
            throw new ShortCodeNotFoundException();
        }

        $body = is_array($payload) ? $payload : [];

        $newCode = $code;
        if (array_key_exists('code', $body)) {
            if (!is_string($body['code'])) {
                throw new ValidationException('短码必须为字符串');
            }
            $newCode = trim($body['code']);
        }

        $url = $currentUrl;
        if (array_key_exists('url', $body)) {
            if (!is_string($body['url'])) {
                throw new ValidationException('目标链接必须为字符串');
            }
            $url = $body['url'];
        }

        $this->assertCodeValid($newCode);
        if ($newCode !== $code && $this->urls->exists($newCode)) {
            throw new ConflictException();
        }

        $validatedUrl = $this->validator->validate($url);
        $this->urls->update($code, $newCode, $validatedUrl);

        return ['code' => $newCode, 'url' => $validatedUrl];
    }

    public function deleteLink(string $code): void
    {
        if (!$this->urls->exists($code)) {
            throw new ShortCodeNotFoundException();
        }

        $this->urls->delete($code);
    }

    /**
     * 单链统计：总点击、今日点击、独立访客、按粒度聚合的趋势、来源域名 Top 10、设备分布。
     *
     * @param string $period 趋势粒度：day / week / month / year
     *
     * @return array<string, mixed>
     */
    public function linkStats(string $code, string $period = 'day'): array
    {
        $url = $this->urls->findByCode($code);
        if ($url === null) {
            throw new ShortCodeNotFoundException();
        }

        $period = $this->normalizePeriod($period);

        return [
            'code' => $code,
            'url' => $url,
            'total_clicks' => $this->clicks->totalByCodes([$code])[$code] ?? 0,
            'clicks_today' => $this->clicks->todayByCodes([$code])[$code] ?? 0,
            'visitors' => $this->clicks->visitors($code),
            'period' => $period,
            'daily' => $this->fillSeries($this->clicks->series($code, $period, self::PERIOD_BUCKETS[$period]), $period),
            'referers' => $this->clicks->topRefererHosts($code, 10),
            'devices' => $this->clicks->deviceSplit($code),
        ];
    }

    private function assertCodeValid(string $code): void
    {
        if ($code === '') {
            throw new ValidationException('短码不能为空');
        }

        if (preg_match(self::CODE_PATTERN, $code) !== 1) {
            throw new ValidationException('短码只能包含 1-32 位英文字母或数字');
        }

        if (in_array(strtolower($code), self::RESERVED_CODES, true)) {
            throw new ValidationException('该短码为系统保留，请换一个');
        }
    }

    /**
     * 把聚合查询返回的稀疏序列补齐为连续桶（UTC）：
     * day → 最近 14 天；week → 最近 12 周（周一为桶起点）；
     * month → 最近 12 个月；year → 最近 5 年。桶数与 SQL 侧 rangeStartExpression 保持一致。
     *
     * @param list<array{date: string, clicks: int}> $series
     * @param string $period 已规范化的粒度
     *
     * @return list<array{date: string, clicks: int}>
     */
    private function fillSeries(array $series, string $period): array
    {
        $byDate = [];
        foreach ($series as $point) {
            $byDate[$point['date']] = $point['clicks'];
        }

        $filled = [];
        // epoch 整除 86400 即当前 UTC 日零点，与 SQLite date('now') 口径一致
        $today = intdiv(time(), 86400) * 86400;

        foreach ($this->bucketStarts($today, $period) as $date) {
            $filled[] = ['date' => $date, 'clicks' => $byDate[$date] ?? 0];
        }

        return $filled;
    }

    /**
     * 生成连续桶的起始日列表（升序，末位为当前桶）。
     *
     * @return list<string>
     */
    private function bucketStarts(int $today, string $period): array
    {
        $count = self::PERIOD_BUCKETS[$period] ?? 14;
        $dates = [];

        for ($i = $count - 1; $i >= 0; $i--) {
            $dates[] = match ($period) {
                // 周一为桶起点：strftime %w 中 0=周日，(w+6)%7 为距本周一的天数
                'week' => gmdate('Y-m-d', $this->weekStart($today) - $i * 7 * 86400),
                'month' => $this->monthStart($today, $i),
                'year' => $this->yearStart($today, $i),
                default => gmdate('Y-m-d', $today - $i * 86400),
            };
        }

        return $dates;
    }

    private function weekStart(int $today): int
    {
        $weekday = (int) gmdate('w', $today); // 0=周日

        return $today - ((($weekday + 6) % 7) * 86400);
    }

    private function monthStart(int $today, int $monthsAgo): string
    {
        $year = (int) gmdate('Y', $today);
        $month = (int) gmdate('n', $today) - $monthsAgo;
        while ($month < 1) {
            $month += 12;
            $year--;
        }

        return sprintf('%04d-%02d-01', $year, $month);
    }

    private function yearStart(int $today, int $yearsAgo): string
    {
        return sprintf('%04d-01-01', (int) gmdate('Y', $today) - $yearsAgo);
    }
}
