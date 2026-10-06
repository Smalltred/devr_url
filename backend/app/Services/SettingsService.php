<?php

declare(strict_types=1);

namespace App\Services;

use App\Repositories\SettingsRepository;

/**
 * 管理端设置：短码长度与随机性、创建短链是否需要登录、后台修改后的密码哈希。
 * 默认值与历史行为完全一致（顺序短码、不限长度、无需登录），保证存量部署升级无感。
 * 缓存按请求生命周期生效（PHP-FPM 每请求重建实例）。
 */
final class SettingsService
{
    public const KEY_CODE_MIN_LENGTH = 'code_min_length';

    public const KEY_CODE_RANDOM = 'code_random';

    public const KEY_REQUIRE_LOGIN = 'require_login';

    public const KEY_ADMIN_PASSWORD_HASH = 'admin_password_hash';

    private const DEFAULTS = [
        self::KEY_CODE_MIN_LENGTH => '1',
        self::KEY_CODE_RANDOM => '0',
        self::KEY_REQUIRE_LOGIN => '0',
    ];

    /** @var array<string, string>|null */
    private ?array $cache = null;

    public function __construct(private readonly SettingsRepository $repository)
    {
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
