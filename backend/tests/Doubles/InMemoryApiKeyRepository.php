<?php

declare(strict_types=1);

namespace Tests\Doubles;

use App\Repositories\ApiKeyRepository;

/**
 * 内存 API Key 仓库替身：行为对齐 SqliteApiKeyRepository（新创建在前、哈希唯一由服务层保证）。
 */
final class InMemoryApiKeyRepository implements ApiKeyRepository
{
    private int $nextId = 1;

    /** @var list<array{id: int, name: string, key_hash: string, prefix: string, created_at: string, last_used_at: ?string}> */
    public array $rows = [];

    public function create(string $name, string $keyHash, string $prefix): int
    {
        $id = $this->nextId++;
        $this->rows[] = [
            'id' => $id,
            'name' => $name,
            'key_hash' => $keyHash,
            'prefix' => $prefix,
            'created_at' => gmdate('Y-m-d H:i:s'),
            'last_used_at' => null,
        ];

        return $id;
    }

    public function findAll(): array
    {
        $views = [];
        foreach (array_reverse($this->rows) as $row) {
            $views[] = $this->toView($row);
        }

        return $views;
    }

    public function find(int $id): ?array
    {
        foreach ($this->rows as $row) {
            if ($row['id'] === $id) {
                return $this->toView($row);
            }
        }

        return null;
    }

    public function findIdByKeyHash(string $keyHash): ?int
    {
        foreach ($this->rows as $row) {
            if ($row['key_hash'] === $keyHash) {
                return $row['id'];
            }
        }

        return null;
    }

    public function touchLastUsed(int $id): void
    {
        foreach ($this->rows as $index => $row) {
            if ($row['id'] === $id) {
                $this->rows[$index]['last_used_at'] = gmdate('Y-m-d H:i:s');
            }
        }
    }

    public function updateKeyHash(int $id, string $keyHash, string $prefix): bool
    {
        foreach ($this->rows as $index => $row) {
            if ($row['id'] === $id) {
                $this->rows[$index]['key_hash'] = $keyHash;
                $this->rows[$index]['prefix'] = $prefix;

                return true;
            }
        }

        return false;
    }

    public function delete(int $id): bool
    {
        $kept = [];
        $found = false;
        foreach ($this->rows as $row) {
            if ($row['id'] === $id) {
                $found = true;

                continue;
            }
            $kept[] = $row;
        }

        if ($found) {
            $this->rows = $kept;
        }

        return $found;
    }

    /**
     * @param array{id: int, name: string, key_hash: string, prefix: string, created_at: string, last_used_at: ?string} $row
     *
     * @return array{id: int, name: string, prefix: string, created_at: string, last_used_at: ?string}
     */
    private function toView(array $row): array
    {
        return [
            'id' => $row['id'],
            'name' => $row['name'],
            'prefix' => $row['prefix'],
            'created_at' => $row['created_at'],
            'last_used_at' => $row['last_used_at'],
        ];
    }
}
