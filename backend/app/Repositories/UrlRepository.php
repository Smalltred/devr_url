<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 短链存储仓库契约。
 * 生产实现为 SQLite（SqliteUrlRepository），测试实现为内存替身。
 */
interface UrlRepository
{
    /**
     * 原子自增并返回下一个短链 ID，保证多进程下短码不重复。
     */
    public function nextId(): int;

    /**
     * 保存短码到原链接的映射。
     */
    public function save(string $code, string $url): void;

    /**
     * 按短码查找原链接，不存在返回 null。
     */
    public function findByCode(string $code): ?string;

    /**
     * 判断短码是否已存在。
     */
    public function exists(string $code): bool;
}
