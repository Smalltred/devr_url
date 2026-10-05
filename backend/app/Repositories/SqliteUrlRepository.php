<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * SQLite 仓库实现：短链数据永久化于 DATABASE_PATH 指定的单一文件。
 * 计数器自增在 BEGIN IMMEDIATE 事务中执行，保证多进程（FPM）下短码不重复；
 * 短码生成规则不变（ID → encode），与原 Node.js 版逐位一致。
 */
final class SqliteUrlRepository implements UrlRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function nextId(): int
    {
        return $this->database->execute(static function (PDO $pdo): int {
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                $select = $pdo->prepare('SELECT id FROM short_url_counter LIMIT 1');
                $select->execute();
                /** @var array<string, mixed>|false $row */
                $row = $select->fetch(PDO::FETCH_ASSOC);
                $next = ($row === false ? 0 : (int) $row['id']) + 1;

                if ($row === false) {
                    $statement = $pdo->prepare('INSERT INTO short_url_counter (id) VALUES (:id)');
                } else {
                    $statement = $pdo->prepare('UPDATE short_url_counter SET id = :id WHERE id = :previous');
                }
                $statement->bindValue(':id', $next, PDO::PARAM_INT);
                if ($row !== false) {
                    $statement->bindValue(':previous', (int) $row['id'], PDO::PARAM_INT);
                }
                $statement->execute();

                $pdo->exec('COMMIT');

                return $next;
            } catch (\Throwable $exception) {
                $pdo->exec('ROLLBACK');

                throw $exception;
            }
        });
    }

    public function save(string $code, string $url): void
    {
        $this->database->execute(static function (PDO $pdo) use ($code, $url): void {
            $statement = $pdo->prepare('INSERT INTO short_urls (code, url) VALUES (:code, :url)');
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->bindValue(':url', $url, PDO::PARAM_STR);
            $statement->execute();
        });
    }

    public function findByCode(string $code): ?string
    {
        $row = $this->database->execute(static function (PDO $pdo) use ($code): ?array {
            $statement = $pdo->prepare('SELECT url FROM short_urls WHERE code = :code');
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->execute();
            /** @var array<string, mixed>|false $result */
            $result = $statement->fetch(PDO::FETCH_ASSOC);

            return $result === false ? null : $result;
        });

        return is_array($row) && is_string($row['url']) ? $row['url'] : null;
    }

    public function exists(string $code): bool
    {
        return $this->database->execute(static function (PDO $pdo) use ($code): bool {
            $statement = $pdo->prepare('SELECT 1 FROM short_urls WHERE code = :code');
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->execute();

            return $statement->fetchColumn() !== false;
        });
    }
}
