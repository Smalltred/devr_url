<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Services\DatabaseService;
use PDO;

/**
 * 点击统计（short_url_clicks）的 SQLite 实现。
 * 单表聚合查询为主，索引覆盖 (code, clicked_at) 与 (clicked_at)。
 */
final class SqliteClickRepository implements ClickRepository
{
    public function __construct(private readonly DatabaseService $database)
    {
    }

    public function record(string $code, array $context): void
    {
        $this->database->execute(static function (PDO $pdo) use ($code, $context): void {
            $statement = $pdo->prepare(
                'INSERT INTO short_url_clicks (code, referer, referer_host, device, ip_hash)
                 VALUES (:code, :referer, :referer_host, :device, :ip_hash)',
            );
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->bindValue(':referer', $context['referer'], PDO::PARAM_STR);
            $statement->bindValue(':referer_host', $context['referer_host'], PDO::PARAM_STR);
            $statement->bindValue(':device', $context['device'], PDO::PARAM_STR);
            $statement->bindValue(':ip_hash', $context['ip_hash'], PDO::PARAM_STR);
            $statement->execute();
        });
    }

    public function totalByCodes(array $codes): array
    {
        if ($codes === []) {
            return [];
        }

        return $this->database->execute(static function (PDO $pdo) use ($codes): array {
            $placeholders = implode(', ', array_fill(0, count($codes), '?'));
            $statement = $pdo->prepare(
                'SELECT code, COUNT(*) AS clicks FROM short_url_clicks WHERE code IN ('.$placeholders.') GROUP BY code',
            );
            $statement->execute($codes);
            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            return self::codeCountMap($rows);
        });
    }

    public function todayByCodes(array $codes): array
    {
        if ($codes === []) {
            return [];
        }

        return $this->database->execute(static function (PDO $pdo) use ($codes): array {
            $placeholders = implode(', ', array_fill(0, count($codes), '?'));
            $statement = $pdo->prepare(
                'SELECT code, COUNT(*) AS clicks FROM short_url_clicks
                 WHERE code IN ('.$placeholders.') AND clicked_at >= date(\'now\') GROUP BY code',
            );
            $statement->execute($codes);

            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            return self::codeCountMap($rows);
        });
    }

    public function totalAll(): int
    {
        return $this->database->execute(static function (PDO $pdo): int {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM short_url_clicks');
            $statement->execute();

            return (int) $statement->fetchColumn();
        });
    }

    public function todayAll(): int
    {
        return $this->database->execute(static function (PDO $pdo): int {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM short_url_clicks WHERE clicked_at >= date(\'now\')');
            $statement->execute();

            return (int) $statement->fetchColumn();
        });
    }

    public function topCodes(int $limit): array
    {
        return $this->database->execute(static function (PDO $pdo) use ($limit): array {
            $statement = $pdo->prepare(
                'SELECT code, COUNT(*) AS clicks FROM short_url_clicks GROUP BY code ORDER BY clicks DESC, code ASC LIMIT :limit',
            );
            $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
            $statement->execute();

            return self::countList($statement);
        });
    }

    public function dailySeries(?string $code, int $days): array
    {
        return $this->database->execute(static function (PDO $pdo) use ($code, $days): array {
            $sql = 'SELECT substr(clicked_at, 1, 10) AS date, COUNT(*) AS clicks FROM short_url_clicks
                    WHERE clicked_at >= date(\'now\', :range)';
            if ($code !== null) {
                $sql .= ' AND code = :code';
            }
            $sql .= ' GROUP BY date ORDER BY date ASC';

            $statement = $pdo->prepare($sql);
            $statement->bindValue(':range', sprintf('-%d days', $days - 1), PDO::PARAM_STR);
            if ($code !== null) {
                $statement->bindValue(':code', $code, PDO::PARAM_STR);
            }
            $statement->execute();

            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            $series = [];
            foreach ($rows as $row) {
                $series[] = [
                    'date' => (string) $row['date'],
                    'clicks' => (int) $row['clicks'],
                ];
            }

            return $series;
        });
    }

    public function visitors(string $code): int
    {
        return $this->database->execute(static function (PDO $pdo) use ($code): int {
            $statement = $pdo->prepare(
                'SELECT COUNT(DISTINCT ip_hash) FROM short_url_clicks WHERE code = :code AND ip_hash IS NOT NULL',
            );
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->execute();

            return (int) $statement->fetchColumn();
        });
    }

    public function topRefererHosts(string $code, int $limit): array
    {
        return $this->database->execute(static function (PDO $pdo) use ($code, $limit): array {
            $statement = $pdo->prepare(
                'SELECT referer_host, COUNT(*) AS clicks FROM short_url_clicks
                 WHERE code = :code AND referer_host IS NOT NULL AND referer_host != \'\'
                 GROUP BY referer_host ORDER BY clicks DESC, referer_host ASC LIMIT :limit',
            );
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
            $statement->execute();

            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            $hosts = [];
            foreach ($rows as $row) {
                $hosts[] = [
                    'referer_host' => (string) $row['referer_host'],
                    'clicks' => (int) $row['clicks'],
                ];
            }

            return $hosts;
        });
    }

    public function deviceSplit(string $code): array
    {
        return $this->database->execute(static function (PDO $pdo) use ($code): array {
            $statement = $pdo->prepare(
                'SELECT device, COUNT(*) AS clicks FROM short_url_clicks
                 WHERE code = :code AND device IN (\'mobile\', \'desktop\') GROUP BY device',
            );
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->execute();
            /** @var list<array<string, mixed>> $rows */
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

            $split = ['mobile' => 0, 'desktop' => 0];
            foreach ($rows as $row) {
                $device = (string) $row['device'];
                if (isset($split[$device])) {
                    $split[$device] = (int) $row['clicks'];
                }
            }

            return $split;
        });
    }

    public function deleteByCode(string $code): void
    {
        $this->database->execute(static function (PDO $pdo) use ($code): void {
            $statement = $pdo->prepare('DELETE FROM short_url_clicks WHERE code = :code');
            $statement->bindValue(':code', $code, PDO::PARAM_STR);
            $statement->execute();
        });
    }

    /**
     * @param list<array<string, mixed>> $rows
     *
     * @return array<string, int>
     */
    private static function codeCountMap(array $rows): array
    {
        $map = [];
        foreach ($rows as $row) {
            $map[(string) $row['code']] = (int) $row['clicks'];
        }

        return $map;
    }

    /**
     * @return list<array{code: string, clicks: int}>
     */
    private static function countList(\PDOStatement $statement): array
    {
        /** @var list<array<string, mixed>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        $list = [];
        foreach ($rows as $row) {
            $list[] = [
                'code' => (string) $row['code'],
                'clicks' => (int) $row['clicks'],
            ];
        }

        return $list;
    }
}
