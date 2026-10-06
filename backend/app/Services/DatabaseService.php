<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\StorageException;
use App\Support\Config;
use PDO;
use PDOException;

/**
 * SQLite 统一出入口：负责连接、建库建表与异常转译。
 * WAL 模式适配 PHP-FPM 多进程（读写并发、busy_timeout 等待锁）；
 * 连接惰性建立，所有 PDO 异常统一转译为 StorageException（HTTP 503）。
 * 需要多语句原子性的写操作（如计数器自增）由调用方用 BEGIN IMMEDIATE 包裹。
 */
final class DatabaseService
{
    private const SCHEMA = [
        'CREATE TABLE IF NOT EXISTS short_urls (
            code TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))
        )',
        'CREATE TABLE IF NOT EXISTS short_url_counter (
            id INTEGER NOT NULL
        )',
        'INSERT INTO short_url_counter (id) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM short_url_counter)',
        'CREATE TABLE IF NOT EXISTS short_url_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            clicked_at TEXT NOT NULL DEFAULT (datetime(\'now\')),
            referer TEXT,
            referer_host TEXT,
            device TEXT,
            ip_hash TEXT
        )',
        'CREATE INDEX IF NOT EXISTS idx_clicks_code_time ON short_url_clicks (code, clicked_at)',
        'CREATE INDEX IF NOT EXISTS idx_clicks_time ON short_url_clicks (clicked_at)',
        'CREATE TABLE IF NOT EXISTS auth_tokens (
            token_hash TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS auth_throttle (
            ip_hash TEXT PRIMARY KEY,
            fails INTEGER NOT NULL,
            window_start INTEGER NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS request_throttle (
            scope TEXT NOT NULL,
            subject TEXT NOT NULL,
            window_start INTEGER NOT NULL,
            hits INTEGER NOT NULL,
            PRIMARY KEY (scope, subject)
        )',
        'CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            prefix TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),
            last_used_at TEXT
        )',
    ];

    private ?PDO $pdo = null;

    public function __construct(private readonly Config $config)
    {
    }

    /**
     * 执行一次数据库操作，PDO 异常统一转译为 StorageException。
     *
     * @template T
     *
     * @param callable(PDO): T $work
     *
     * @return T
     */
    public function execute(callable $work): mixed
    {
        try {
            return $work($this->connection());
        } catch (StorageException $exception) {
            throw $exception;
        } catch (PDOException $exception) {
            throw new StorageException('SQLite operation failed', 0, $exception);
        }
    }

    private function connection(): PDO
    {
        return $this->pdo ??= $this->connect();
    }

    private function connect(): PDO
    {
        $path = (string) $this->config->get('database.path', '');
        if ($path === '') {
            throw new StorageException('SQLite path is not configured');
        }

        $directory = dirname($path);
        if (!is_dir($directory) && !@mkdir($directory, 0777, true) && !is_dir($directory)) {
            throw new StorageException('Unable to create SQLite directory: '.$directory);
        }

        try {
            $pdo = new PDO('sqlite:'.$path, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        } catch (PDOException $exception) {
            throw new StorageException('Unable to open SQLite database: '.$path, 0, $exception);
        }

        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 2500');
        foreach (self::SCHEMA as $statement) {
            $pdo->exec($statement);
        }

        return $pdo;
    }
}
