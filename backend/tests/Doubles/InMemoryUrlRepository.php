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

    public function countAll(): int
    {
        return count($this->map);
    }

    public function paginate(int $limit, int $offset, string $query): array
    {
        $filtered = [];
        foreach ($this->map as $code => $url) {
            if ($query !== '' && stripos($code, $query) === false && stripos($url, $query) === false) {
                continue;
            }
            $filtered[] = ['code' => $code, 'url' => $url, 'created_at' => '1970-01-01 00:00:00'];
        }

        $items = array_slice(array_reverse($filtered), $offset, $limit);

        return ['items' => $items, 'total' => count($filtered)];
    }

    public function update(string $code, string $newCode, string $url): void
    {
        if (!isset($this->map[$code])) {
            return;
        }
        unset($this->map[$code]);
        $this->map[$newCode] = $url;
    }

    public function delete(string $code): void
    {
        unset($this->map[$code]);
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
