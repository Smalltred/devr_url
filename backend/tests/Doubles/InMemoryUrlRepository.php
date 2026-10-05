<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\UrlRepository;

/**
 * 内存仓库替身：供 Feature 测试使用，行为对齐 SqliteUrlRepository。
 */
final class InMemoryUrlRepository implements UrlRepository
{
    private int $counter = 0;

    /** @var array<string, string> */
    public array $map = [];

    public function nextId(): int
    {
        return ++$this->counter;
    }

    public function save(string $code, string $url): void
    {
        $this->map[$code] = $url;
    }

    public function findByCode(string $code): ?string
    {
        return $this->map[$code] ?? null;
    }

    public function exists(string $code): bool
    {
        return isset($this->map[$code]);
    }

    /**
     * 模拟原 Node 项目写入的存量数据。
     *
     * @param array<string, string> $map
     */
    public function seed(int $counterValue, array $map): void
    {
        $this->counter = $counterValue;
        $this->map = $map;
    }
}
