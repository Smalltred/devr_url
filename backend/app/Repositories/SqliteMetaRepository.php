<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * app_meta 表的 SQLite 实现：set 采用 upsert，惰性建键。
 */
final class SqliteMetaRepository implements MetaRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function get(string $key): ?string
    {
        return $this->database->execute(static function (PDO $pdo) use ($key): ?string {
            $statement = $pdo->prepare('SELECT value FROM app_meta WHERE key = :key');
            $statement->bindValue(':key', $key, PDO::PARAM_STR);
            $statement->execute();
            $result = $statement->fetchColumn();

            return is_string($result) ? $result : null;
        });
    }

    public function set(string $key, string $value): void
    {
        $this->database->execute(static function (PDO $pdo) use ($key, $value): void {
            $statement = $pdo->prepare(
                'INSERT INTO app_meta (key, value) VALUES (:key, :value)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            );
            $statement->bindValue(':key', $key, PDO::PARAM_STR);
            $statement->bindValue(':value', $value, PDO::PARAM_STR);
            $statement->execute();
        });
    }
}
