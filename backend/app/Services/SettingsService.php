<?php

declare(strict_types=1);

namespace App\Services;

use App\Repositories\SettingsRepository;

/**
 * 管理端设置：短码长度与随机性、创建短链是否需要登录、后台修改后的密码哈希、缓存 TTL。
 * 默认值与历史行为完全一致（顺序短码、不限长度、无需登录），保证存量部署升级无感。
 * 缓存 TTL 缺省取自环境变量配置，后台可覆盖为数据库值。
 * 缓存按请求生命周期生效（PHP-FPM 每请求重建实例）。
 */
final class SettingsService
{
    public const KEY_CODE_MIN_LENGTH = 'code_min_length';

    public const KEY_CODE_RANDOM = 'code_random';

    public const KEY_REQUIRE_LOGIN = 'require_login';

    public const KEY_ADMIN_PASSWORD_HASH = 'admin_password_hash';

    public const KEY_CACHE_TTL = 'cache_ttl';

    public const KEY_CACHE_NEGATIVE_TTL = 'cache_negative_ttl';

    private const DEFAULTS = [
        self::KEY_CODE_MIN_LENGTH => '1',
        self::KEY_CODE_RANDOM => '0',
        self::KEY_REQUIRE_LOGIN => '0',
    ];

    /** @var array<string, string>|null */
    private ?array $cache = null;

    /**
     * @param int $defaultCacheTtl 环境变量提供的缓存 TTL 缺省值（CACHE_TTL）
     * @param int $defaultNegativeTtl 环境变量提供的负缓存 TTL 缺省值（CACHE_NEGATIVE_TTL）
     */
    public function __construct(
        private readonly SettingsRepository $repository,
        private readonly int $defaultCacheTtl = 300,
        private readonly int $defaultNegativeTtl = 30,
    ) {
    }

    /**
     * 合并默认值后的全部设置（含密码哈希，禁止直接对外输出）。
     *
     * @return array<string, string>
     */
    public function all(): array
    {
        if ($this->cache === null) {
            $this->cache = array_merge(self::DEFAULTS, [self::KEY_ADMIN_PASSWORD_HASH => ''], $this->repository->all());
        }

        return $this->cache;
    }

    /**
     * 短码最小长度（1-16，超出范围的存量值按边界收敛）。
     */
    public function codeMinLength(): int
    {
        return max(1, min(16, (int) ($this->all()[self::KEY_CODE_MIN_LENGTH] ?? '1')));
    }

    public function codeRandom(): bool
    {
        return $this->flag(self::KEY_CODE_RANDOM);
    }

    public function requireLogin(): bool
    {
        return $this->flag(self::KEY_REQUIRE_LOGIN);
    }

    /**
     * 短链缓存 TTL（秒）。默认取自环境变量（CACHE_TTL），后台可覆盖；0 = 不缓存。
     */
    public function cacheTtl(): int
    {
        $raw = $this->all()[self::KEY_CACHE_TTL] ?? (string) $this->defaultCacheTtl;

        return max(0, min(86400, (int) $raw));
    }

    /**
     * 负缓存 TTL（秒）：缓存“短码不存在”的时间，0 = 不写负缓存。
     */
    public function cacheNegativeTtl(): int
    {
        $raw = $this->all()[self::KEY_CACHE_NEGATIVE_TTL] ?? (string) $this->defaultNegativeTtl;

        return max(0, min(3600, (int) $raw));
    }

    /**
     * 后台修改密码后落库的哈希；空串表示未自定义（沿用环境变量配置）。
     */
    public function adminPasswordHash(): string
    {
        return (string) ($this->all()[self::KEY_ADMIN_PASSWORD_HASH] ?? '');
    }

    public function hasCustomPassword(): bool
    {
        return $this->adminPasswordHash() !== '';
    }

    /**
     * @param array<string, string> $values
     */
    public function save(array $values): void
    {
        foreach ($values as $key => $value) {
            $this->repository->set($key, $value);
        }
        $this->cache = null;
    }

    private function flag(string $key): bool
    {
        return in_array($this->all()[$key] ?? '0', ['1', 'true'], true);
    }
}
