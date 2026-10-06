<?php

declare(strict_types=1);

namespace App\Cache;

use App\Support\Logger;

/**
 * Memcached 缓存驱动（ext-memcached）。
 *
 * 可用性策略：扩展缺失、连接失败或运行中读写异常都只降级为“未命中”语义，
 * 绝不向调用方抛异常——短链跳转的可用性优先于缓存收益。
 * 运行期失败后进入冷却期（默认 30 秒），避免服务不可用时每个请求都等待超时；
 * 扩展缺失属配置问题，不刷日志，由管理端「设置」页的状态区展示。
 * 键名统一加 devr: 前缀，避免与同实例上的其他应用冲突。
 */
final class MemcachedStore implements Store
{
    private const KEY_PREFIX = 'devr:';

    private const FAILURE_COOLDOWN_SECONDS = 30;

    private const MAX_TTL_SECONDS = 2592000;

    private ?\Memcached $client = null;

    private bool $extensionLoaded;

    private int $failedAt = 0;

    /**
     * @param list<string> $servers host:port 列表
     */
    public function __construct(
        private readonly Logger $logger,
        private readonly array $servers,
        private readonly int $ttl,
        private readonly int $negativeTtl,
        private readonly int $timeoutMs = 200,
    ) {
        $this->extensionLoaded = extension_loaded('memcached');
    }

    public function get(string $key): string|false
    {
        if (!$this->usable()) {
            return false;
        }

        try {
            $value = $this->client()->get(self::KEY_PREFIX.$key);
            $code = $this->client()->getResultCode();
            if ($code === \Memcached::RES_NOTFOUND) {
                return false;
            }
            if ($code !== \Memcached::RES_SUCCESS) {
                $this->degrade('get', 'result code '.$code);

                return false;
            }

            // 只存字符串；类型不符（脏数据）按未命中处理
            return is_string($value) ? $value : false;
        } catch (\Throwable $exception) {
            $this->degrade('get', $exception->getMessage());

            return false;
        }
    }

    public function set(string $key, string $value, int $ttlSeconds): bool
    {
        if (!$this->usable()) {
            return false;
        }

        try {
            // TTL 超过 30 天会被 Memcached 当作绝对时间戳，统一压到 30 天以内
            $ttl = max(1, min($ttlSeconds, self::MAX_TTL_SECONDS));

            return $this->client()->set(self::KEY_PREFIX.$key, $value, $ttl) === true;
        } catch (\Throwable $exception) {
            $this->degrade('set', $exception->getMessage());

            return false;
        }
    }

    public function delete(string $key): bool
    {
        if (!$this->usable()) {
            return true;
        }

        try {
            $this->client()->delete(self::KEY_PREFIX.$key);

            return true;
        } catch (\Throwable $exception) {
            $this->degrade('delete', $exception->getMessage());

            return false;
        }
    }

    public function status(): array
    {
        return [
            'driver' => 'memcached',
            'enabled' => true,
            'available' => $this->usable(),
            'servers' => $this->servers,
            'ttl' => $this->ttl,
            'negative_ttl' => $this->negativeTtl,
        ];
    }

    public function stats(): array
    {
        if (!$this->usable()) {
            return ['hits' => 0, 'misses' => 0, 'items' => 0];
        }

        try {
            $stats = $this->client()->getStats();
            if (!is_array($stats)) {
                return ['hits' => 0, 'misses' => 0, 'items' => 0];
            }

            $totals = ['hits' => 0, 'misses' => 0, 'items' => 0];
            foreach ($stats as $server) {
                if (!is_array($server)) {
                    continue;
                }
                $totals['hits'] += (int) ($server['get_hits'] ?? 0);
                $totals['misses'] += (int) ($server['get_misses'] ?? 0);
                $totals['items'] += (int) ($server['curr_items'] ?? 0);
            }

            return $totals;
        } catch (\Throwable $exception) {
            $this->degrade('stats', $exception->getMessage());

            return ['hits' => 0, 'misses' => 0, 'items' => 0];
        }
    }

    /**
     * 是否处于可用状态（扩展已装 + 服务列表非空 + 不在失败冷却期）。
     */
    private function usable(): bool
    {
        if (!$this->extensionLoaded || $this->servers === []) {
            return false;
        }

        if ($this->failedAt !== 0 && time() - $this->failedAt < self::FAILURE_COOLDOWN_SECONDS) {
            return false;
        }

        return true;
    }

    private function client(): \Memcached
    {
        if ($this->client !== null) {
            return $this->client;
        }

        $client = new \Memcached('devr-short-url');
        if ($client->getServerList() === []) {
            // 使用文本协议：memcached 1.6 起官方已弃用二进制协议，文本协议兼容性更好
            // （与 memcached 兼容实现如云托管缓存服务也能互通）
            $client->setOption(\Memcached::OPT_CONNECT_TIMEOUT, $this->timeoutMs);
            $client->setOption(\Memcached::OPT_SEND_TIMEOUT, $this->timeoutMs * 1000);
            $client->setOption(\Memcached::OPT_RECV_TIMEOUT, $this->timeoutMs * 1000);
            $client->setOption(\Memcached::OPT_POLL_TIMEOUT, $this->timeoutMs);
            // 序列化器显式指定，避免 igbinary 未编译时抛错
            $client->setOption(
                \Memcached::OPT_SERIALIZER,
                defined('\Memcached::HAVE_IGBINARY') && \Memcached::HAVE_IGBINARY
                    ? \Memcached::SERIALIZER_IGBINARY
                    : \Memcached::SERIALIZER_PHP,
            );
            $client->addServers(self::normalizeServers($this->servers));
        }

        return $this->client = $client;
    }

    /**
     * @param list<string> $servers
     *
     * @return list<array{0: string, 1: int, 2: int}>
     */
    private static function normalizeServers(array $servers): array
    {
        $normalized = [];
        foreach ($servers as $server) {
            $parts = explode(':', trim($server), 2);
            $host = trim($parts[0]);
            if ($host === '') {
                continue;
            }
            $port = isset($parts[1]) && preg_match('/^\d+$/', $parts[1]) === 1 ? (int) $parts[1] : 11211;
            $normalized[] = [$host, $port, 1];
        }

        return $normalized;
    }

    private function degrade(string $operation, string $reason): void
    {
        $this->failedAt = time();
        $this->logger->error('memcached degraded', [
            'operation' => $operation,
            'reason' => $reason,
        ]);
    }
}
