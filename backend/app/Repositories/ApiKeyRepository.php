<?php

declare(strict_types=1);

namespace App\Repositories;

/**
 * 开放 API Key 仓库契约（api_keys 表）。
 * 库中只存 key 的 sha256 哈希与展示用前缀，明文仅在创建/重置时返回一次。
 * 生产实现为 SQLite（SqliteApiKeyRepository），测试实现为内存替身。
 */
interface ApiKeyRepository
{
    /**
     * 写入新 Key，返回自增 ID。
     */
    public function create(string $name, string $keyHash, string $prefix): int;

    /**
     * 全部 Key（新创建在前），不含哈希。
     *
     * @return list<array{id: int, name: string, prefix: string, created_at: string, last_used_at: ?string}>
     */
    public function findAll(): array;

    /**
     * 按 ID 查找；不存在返回 null。
     *
     * @return array{id: int, name: string, prefix: string, created_at: string, last_used_at: ?string}|null
     */
    public function find(int $id): ?array;

    /**
     * 按 Key 哈希查找 ID（鉴权用）；不存在返回 null。
     */
    public function findIdByKeyHash(string $keyHash): ?int;

    /**
     * 更新最近使用时间（UTC）。
     */
    public function touchLastUsed(int $id): void;

    /**
     * 重置 Key 哈希与前缀；Key 不存在返回 false。
     */
    public function updateKeyHash(int $id, string $keyHash, string $prefix): bool;

    /**
     * 删除 Key；不存在返回 false。
     */
    public function delete(int $id): bool;
}
