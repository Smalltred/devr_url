<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Cache\Store;
use App\Services\SettingsService;

/**
 * 短链仓储的缓存装饰器：跳转解析（findByCode）走缓存，写操作主动失效。
 *
 * 缓存策略：
 * - 命中：直接返回缓存值，不再查库（热点跳转的关键收益点）；
 * - 未命中：查库后回填；查不到时写入“负缓存”（短码不存在是同样高频的探测场景，
 *   尤其在有扫描流量的公网环境下），避免不存在的短码持续打库；
 * - 写操作（新增/编辑/删除）失效相关短码的缓存，保证改完立即可见；
 *   改短码时新旧两个短码都失效，防止旧短码继续命中；
 * - 缓存层任何失败都静默穿透数据库，由 Store 实现保证不抛异常。
 */
final class CachedUrlRepository implements UrlRepository
{
    /** 负缓存占位值：短码不存在。用控制字符避免与合法 URL 冲突 */
    private const NOT_FOUND_MARKER = "\0__devr_miss__";

    private const KEY_PREFIX = 'url:';

    public function __construct(
        private readonly UrlRepository $inner,
        private readonly Store $cache,
        private readonly SettingsService $settings,
    ) {
    }

    public function nextId(): int
    {
        return $this->inner->nextId();
    }

    public function save(string $code, string $url): void
    {
        $this->inner->save($code, $url);
        // 该短码可能刚被负缓存过（不存在的探测），必须清掉
        $this->cache->delete(self::KEY_PREFIX.$code);
    }

    public function findByCode(string $code): ?string
    {
        if ($code === '') {
            return null;
        }

        $cached = $this->cache->get(self::KEY_PREFIX.$code);
        if (is_string($cached)) {
            return $cached === self::NOT_FOUND_MARKER ? null : $cached;
        }

        $url = $this->inner->findByCode($code);
        if ($url === null) {
            $negativeTtl = $this->settings->cacheNegativeTtl();
            if ($negativeTtl > 0) {
                $this->cache->set(self::KEY_PREFIX.$code, self::NOT_FOUND_MARKER, $negativeTtl);
            }

            return null;
        }

        $ttl = $this->settings->cacheTtl();
        if ($ttl > 0) {
            $this->cache->set(self::KEY_PREFIX.$code, $url, $ttl);
        }

        return $url;
    }

    public function exists(string $code): bool
    {
        return $this->inner->exists($code);
    }

    public function countAll(): int
    {
        return $this->inner->countAll();
    }

    public function paginate(int $limit, int $offset, string $query): array
    {
        return $this->inner->paginate($limit, $offset, $query);
    }

    public function update(string $code, string $newCode, string $url): void
    {
        $this->inner->update($code, $newCode, $url);
        $this->cache->delete(self::KEY_PREFIX.$code);
        if ($newCode !== $code) {
            $this->cache->delete(self::KEY_PREFIX.$newCode);
        }
    }

    public function delete(string $code): void
    {
        $this->inner->delete($code);
        $this->cache->delete(self::KEY_PREFIX.$code);
    }
}
