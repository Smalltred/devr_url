<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 键值元数据仓库契约（app_meta 表）。
 * 用于存放安装级随机数据（如 IP 哈希盐值），生产实现为 SQLite，测试实现为内存替身。
 */
interface MetaRepository
{
    public function get(string $key): ?string;

    public function set(string $key, string $value): void;
}
