<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * api_keys 表的 SQLite 实现：key_hash 唯一索引加速鉴权查找。
 */
final class SqliteApiKeyRepository implements ApiKeyRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function create(string $name, string $keyHash, string $prefix): int
    {
        return $this->database->execute(static function (PDO $pdo) use ($name, $keyHash, $prefix): int {
            $statement = $pdo->prepare(
                'INSERT INTO api_keys (name, key_hash, prefix) VALUES (:name, :key_hash, :prefix)',
            );
            $statement->bindValue(':name', $name, PDO::PARAM_STR);
            $statement->bindValue(':key_hash', $keyHash, PDO::PARAM_STR);
            $statement->bindValue(':prefix', $prefix, PDO::PARAM_STR);
            $statement->execute();

            return (int) $pdo->lastInsertId();
        });
    }

    public function findAll(): array
    {
        return $this->database->execute(static function (PDO $pdo): array {
            $statement = $pdo->prepare(
                'SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY id DESC',
            );
            $statement->execute();

            return self::rowsToViews($statement);
        });
    }

    public function find(int $id): ?array
    {
        return $this->database->execute(static function (PDO $pdo) use ($id): ?array {
            $statement = $pdo->prepare(
                'SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE id = :id',
            );
            $statement->bindValue(':id', $id, PDO::PARAM_INT);
            $statement->execute();

            return self::rowsToViews($statement)[0] ?? null;
        });
    }

    public function findIdByKeyHash(string $keyHash): ?int
    {
        return $this->database->execute(static function (PDO $pdo) use ($keyHash): ?int {
            $statement = $pdo->prepare('SELECT id FROM api_keys WHERE key_hash = :key_hash');
            $statement->bindValue(':key_hash', $keyHash, PDO::PARAM_STR);
            $statement->execute();
            $result = $statement->fetchColumn();

            return is_int($result) || is_string($result) ? (int) $result : null;
        });
    }

    public function touchLastUsed(int $id): void
    {
        $this->database->execute(static function (PDO $pdo) use ($id): void {
            $statement = $pdo->prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = :id");
            $statement->bindValue(':id', $id, PDO::PARAM_INT);
            $statement->execute();
        });
    }

    public function updateKeyHash(int $id, string $keyHash, string $prefix): bool
    {
        return $this->database->execute(static function (PDO $pdo) use ($id, $keyHash, $prefix): bool {
            $statement = $pdo->prepare('UPDATE api_keys SET key_hash = :key_hash, prefix = :prefix WHERE id = :id');
            $statement->bindValue(':key_hash', $keyHash, PDO::PARAM_STR);
            $statement->bindValue(':prefix', $prefix, PDO::PARAM_STR);
            $statement->bindValue(':id', $id, PDO::PARAM_INT);
            $statement->execute();

            return $statement->rowCount() > 0;
        });
    }

    public function delete(int $id): bool
    {
        return $this->database->execute(static function (PDO $pdo) use ($id): bool {
            $statement = $pdo->prepare('DELETE FROM api_keys WHERE id = :id');
            $statement->bindValue(':id', $id, PDO::PARAM_INT);
            $statement->execute();

            return $statement->rowCount() > 0;
        });
    }

    /**
     * @return list<array{id: int, name: string, prefix: string, created_at: string, last_used_at: ?string}>
     */
    private static function rowsToViews(\PDOStatement $statement): array
    {
        /** @var list<array<string, mixed>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        $views = [];
        foreach ($rows as $row) {
            $lastUsed = $row['last_used_at'];
            $views[] = [
                'id' => (int) $row['id'],
                'name' => (string) $row['name'],
                'prefix' => (string) $row['prefix'],
                'created_at' => (string) $row['created_at'],
                'last_used_at' => is_string($lastUsed) && $lastUsed !== '' ? $lastUsed : null,
            ];
        }

        return $views;
    }
}
