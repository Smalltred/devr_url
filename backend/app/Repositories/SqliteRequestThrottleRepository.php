<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * request_throttle 表的 SQLite 实现。
 * upsert 在 BEGIN IMMEDIATE 事务内完成，保证并发请求下计数不丢失（不互相覆盖）。
 */
final class SqliteRequestThrottleRepository implements RequestThrottleRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function hit(string $scope, string $subject, int $windowStart): int
    {
        return $this->database->execute(static function (PDO $pdo) use ($scope, $subject, $windowStart): int {
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                // 同一窗口内自增；窗口已过期则重置为 1
                $statement = $pdo->prepare(
                    'INSERT INTO request_throttle (scope, subject, window_start, hits)
                     VALUES (:scope, :subject, :window_start, 1)
                     ON CONFLICT(scope, subject) DO UPDATE SET
                        hits = CASE WHEN request_throttle.window_start = excluded.window_start
                                    THEN request_throttle.hits + 1
                                    ELSE 1 END,
                        window_start = excluded.window_start',
                );
                $statement->bindValue(':scope', $scope, PDO::PARAM_STR);
                $statement->bindValue(':subject', $subject, PDO::PARAM_STR);
                $statement->bindValue(':window_start', $windowStart, PDO::PARAM_INT);
                $statement->execute();

                $select = $pdo->prepare(
                    'SELECT hits FROM request_throttle WHERE scope = :scope AND subject = :subject',
                );
                $select->bindValue(':scope', $scope, PDO::PARAM_STR);
                $select->bindValue(':subject', $subject, PDO::PARAM_STR);
                $select->execute();

                $pdo->exec('COMMIT');

                return (int) $select->fetchColumn();
            } catch (\Throwable $exception) {
                $pdo->exec('ROLLBACK');

                throw $exception;
            }
        });
    }
}
