<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 管理端设置仓库契约（settings 表，字符串键值对）。
 * 生产实现为 SQLite（SqliteSettingsRepository），测试实现为内存替身。
 */
interface SettingsRepository
{
    /**
     * 全部已保存的设置（不含默认值，由上层合并）。
     *
     * @return array<string, string>
     */
    public function all(): array;

    public function set(string $key, string $value): void;
}
