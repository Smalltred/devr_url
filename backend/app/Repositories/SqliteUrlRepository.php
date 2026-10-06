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

    public function countAll(): int
    {
        return $this->database->execute(static function (PDO $pdo): int {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM short_urls');
            $statement->execute();

            return (int) $statement->fetchColumn();
        });
    }

    public function paginate(int $limit, int $offset, string $query): array
    {
        return $this->database->execute(static function (PDO $pdo) use ($limit, $offset, $query): array {
            $like = self::likePattern($query);
            $where = $like === null ? '' : 'WHERE code LIKE :like ESCAPE \'\\\' OR url LIKE :like ESCAPE \'\\\'';

            $countStatement = $pdo->prepare('SELECT COUNT(*) FROM short_urls '.$where);
            if ($like !== null) {
                $countStatement->bindValue(':like', $like, PDO::PARAM_STR);
            }
            $countStatement->execute();
            $total = (int) $countStatement->fetchColumn();

            $statement = $pdo->prepare(
                'SELECT code, url, created_at FROM short_urls '.$where.' ORDER BY created_at DESC, rowid DESC LIMIT :limit OFFSET :offset',
            );
            if ($like !== null) {
                $statement->bindValue(':like', $like, PDO::PARAM_STR);
            }
            $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
            $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
            $statement->execute();

            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            $items = [];
            foreach ($rows as $row) {
                $items[] = [
                    'code' => (string) $row['code'],
                    'url' => (string) $row['url'],
                    'created_at' => (string) $row['created_at'],
                ];
            }

            return ['items' => $items, 'total' => $total];
        });
    }

    public function update(string $code, string $newCode, string $url): void
    {
        $this->database->execute(static function (PDO $pdo) use ($code, $newCode, $url): void {
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                $statement = $pdo->prepare('UPDATE short_urls SET code = :new_code, url = :url WHERE code = :code');
                $statement->bindValue(':new_code', $newCode, PDO::PARAM_STR);
                $statement->bindValue(':url', $url, PDO::PARAM_STR);
                $statement->bindValue(':code', $code, PDO::PARAM_STR);
                $statement->execute();

                if ($newCode !== $code) {
                    $migrate = $pdo->prepare('UPDATE short_url_clicks SET code = :new_code WHERE code = :code');
                    $migrate->bindValue(':new_code', $newCode, PDO::PARAM_STR);
                    $migrate->bindValue(':code', $code, PDO::PARAM_STR);
                    $migrate->execute();
                }

                $pdo->exec('COMMIT');
            } catch (\Throwable $exception) {
                $pdo->exec('ROLLBACK');

                throw $exception;
            }
        });
    }

    public function delete(string $code): void
    {
        $this->database->execute(static function (PDO $pdo) use ($code): void {
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                $statement = $pdo->prepare('DELETE FROM short_urls WHERE code = :code');
                $statement->bindValue(':code', $code, PDO::PARAM_STR);
                $statement->execute();

                $clicks = $pdo->prepare('DELETE FROM short_url_clicks WHERE code = :code');
                $clicks->bindValue(':code', $code, PDO::PARAM_STR);
                $clicks->execute();

                $pdo->exec('COMMIT');
            } catch (\Throwable $exception) {
                $pdo->exec('ROLLBACK');

                throw $exception;
            }
        });
    }

    /**
     * 构造 LIKE 模式（两侧通配），转义 % _ \ 通配符；空查询返回 null 表示不过滤。
     */
    private static function likePattern(string $query): ?string
    {
        $trimmed = trim($query);
        if ($trimmed === '') {
            return null;
        }

        return '%'.str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $trimmed).'%';
    }
}
