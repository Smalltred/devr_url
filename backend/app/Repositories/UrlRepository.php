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

    /**
     * 全部短链数量（管理端概览用）。
     */
    public function countAll(): int;

    /**
     * 管理端分页查询。$query 非空时对 code / url 做 LIKE 模糊匹配；
     * 按创建时间倒序，同秒内按插入顺序倒序。
     *
     * @return array{items: list<array{code: string, url: string, created_at: string}>, total: int}
     */
    public function paginate(int $limit, int $offset, string $query): array;

    /**
     * 更新目标 URL 与短码。实现必须在同一事务内完成：
     * 若短码变更，需同步把点击记录迁移到新短码，保证统计不丢。
     */
    public function update(string $code, string $newCode, string $url): void;

    /**
     * 删除短链。实现必须在同一事务内级联删除其点击记录。
     */
    public function delete(string $code): void;
}
