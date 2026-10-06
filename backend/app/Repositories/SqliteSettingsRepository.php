<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * settings 表的 SQLite 实现：set 采用 upsert。
 */
final class SqliteSettingsRepository implements SettingsRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function all(): array
    {
        return $this->database->execute(static function (PDO $pdo): array {
            $statement = $pdo->prepare('SELECT key, value FROM settings');
            $statement->execute();
            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            $values = [];
            foreach ($rows as $row) {
                $values[(string) $row['key']] = (string) $row['value'];
            }

            return $values;
        });
    }

    public function set(string $key, string $value): void
    {
        $this->database->execute(static function (PDO $pdo) use ($key, $value): void {
            $statement = $pdo->prepare(
                'INSERT INTO settings (key, value) VALUES (:key, :value)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            );
            $statement->bindValue(':key', $key, PDO::PARAM_STR);
            $statement->bindValue(':value', $value, PDO::PARAM_STR);
            $statement->execute();
        });
    }
}
