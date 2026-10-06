<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\ShortCodeNotFoundException;
use App\Exceptions\UnauthorizedException;
use App\Exceptions\ValidationException;
use App\Http\Request;
use App\Repositories\ApiKeyRepository;
use App\Support\Logger;

/**
 * 开放 API Key 管理（创建/重置/删除/列表）与鉴权。
 * 安全模型：明文 Key 仅在创建/重置响应中出现一次，库存 sha256 哈希；
 * 列表与详情只暴露展示用前缀，泄露后可重置或删除即时失效。
 */
final class ApiKeyService
{
    private const KEY_PREFIX = 'devr_';

    private const KEY_RANDOM_BYTES = 16;

    /** 列表展示用的 Key 前缀长度（devr_ + 7 位十六进制） */
    public const DISPLAY_PREFIX_LENGTH = 12;

    private const MAX_NAME_LENGTH = 64;

    public function __construct(
        private readonly ApiKeyRepository $repository,
        private readonly Logger $logger,
    ) {
    }

    /**
     * 创建 Key，响应中唯一一次返回明文。
     *
     * @return array{id: int, name: string, prefix: string, key: string}
     */
    public function create(mixed $name): array
    {
        $normalizedName = $this->normalizeName($name);
        $key = $this->generateKey();
        $prefix = $this->prefixOf($key);
        $id = $this->repository->create($normalizedName, hash('sha256', $key), $prefix);
        $this->logger->info('api key created', ['id' => $id]);

        return ['id' => $id, 'name' => $normalizedName, 'prefix' => $prefix, 'key' => $key];
    }

    /**
     * 重置 Key：生成新明文，旧 Key 立即失效，名称与创建时间保持不变。
     *
     * @return array{id: int, name: string, prefix: string, key: string}
     */
    public function reset(int $id): array
    {
        $row = $this->repository->find($id);
        if ($row === null) {
            throw new ShortCodeNotFoundException('API Key 不存在');
        }

        $key = $this->generateKey();
        $prefix = $this->prefixOf($key);
        $this->repository->updateKeyHash($id, hash('sha256', $key), $prefix);
        $this->logger->info('api key reset', ['id' => $id]);

        return ['id' => $id, 'name' => $row['name'], 'prefix' => $prefix, 'key' => $key];
    }

    public function delete(int $id): void
    {
        if (!$this->repository->delete($id)) {
            throw new ShortCodeNotFoundException('API Key 不存在');
        }
        $this->logger->info('api key deleted', ['id' => $id]);
    }

    /**
     * @return list<array{id: int, name: string, prefix: string, created_at: string, last_used_at: ?string}>
     */
    public function list(): array
    {
        return $this->repository->findAll();
    }

    /**
     * 开放 API 鉴权门卫：无效或缺失 Key 抛 UnauthorizedException（HTTP 401）。
     */
    public function requireValidKey(Request $request): void
    {
        $key = $this->keyFromRequest($request);
        if ($key === null || !$this->authenticate($key)) {
            throw new UnauthorizedException('Invalid API Key');
        }
    }

    public function authenticate(string $key): bool
    {
        $id = $this->repository->findIdByKeyHash(hash('sha256', $key));
        if ($id === null) {
            return false;
        }

        // 最近使用时间属遥测信息，写失败不阻断本次 API 调用
        try {
            $this->repository->touchLastUsed($id);
        } catch (\Throwable $exception) {
            $this->logger->error('api key touch failed', [
                'id' => $id,
                'exception' => $exception::class,
            ]);
        }

        return true;
    }

    /**
     * 从请求头提取 Key：Authorization: Bearer <key> 或 X-API-Key: <key>。
     */
    public function keyFromRequest(Request $request): ?string
    {
        $authorization = $request->header('authorization');
        if (is_string($authorization) && preg_match('/^Bearer\s+(\S+)$/i', $authorization, $matches) === 1) {
            return $matches[1];
        }

        $apiKey = $request->header('x-api-key');

        return is_string($apiKey) && trim($apiKey) !== '' ? trim($apiKey) : null;
    }

    private function generateKey(): string
    {
        return self::KEY_PREFIX.bin2hex(random_bytes(self::KEY_RANDOM_BYTES));
    }

    private function prefixOf(string $key): string
    {
        return substr($key, 0, self::DISPLAY_PREFIX_LENGTH);
    }

    private function normalizeName(mixed $name): string
    {
        if (!is_string($name)) {
            throw new ValidationException('Key 名称必须为字符串');
        }

        $trimmed = trim($name);
        if ($trimmed === '' || mb_strlen($trimmed) > self::MAX_NAME_LENGTH) {
            throw new ValidationException('Key 名称需为 1-'.self::MAX_NAME_LENGTH.' 个字符');
        }

        return $trimmed;
    }
}
