<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\SettingsRepository;

/**
 * 内存设置仓库替身：仅存显式保存过的键（默认值由 SettingsService 合并）。
 */
final class InMemorySettingsRepository implements SettingsRepository
{
    /** @var array<string, string> */
    public array $values = [];

    public function all(): array
    {
        return $this->values;
    }

    public function set(string $key, string $value): void
    {
        $this->values[$key] = $value;
    }
}
