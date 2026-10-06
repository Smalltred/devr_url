<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\ShortCodeNotFoundException;
use App\Exceptions\StorageException;
use App\Repositories\UrlRepository;
use App\Validation\UrlValidator;

/**
 * 业务编排：验证 URL → 取自增 ID → 生成短码 → 落库 → 返回结果。
 * 与原项目保持一致：不做 URL 去重（同一 URL 多次提交会产生多个短码）。
 * 短码形态由管理端设置决定：最小长度（不足左补）与随机性（随机码查重后落库）。
 */
final class ShortUrlService
{
    private const RANDOM_MAX_ATTEMPTS = 20;

    public function __construct(
        private readonly UrlRepository $repository,
        private readonly ShortCodeService $shortCode,
        private readonly UrlValidator $validator,
        private readonly SettingsService $settings,
    ) {
    }

    public function create(mixed $rawUrl): UrlResult
    {
        $url = $this->validator->validate($rawUrl);
        $id = $this->repository->nextId();
        $code = $this->generateCode($id);
        $this->repository->save($code, $url);

        return new UrlResult($url, $code);
    }

    public function resolve(string $code): string
    {
        if ($code === '') {
            throw new ShortCodeNotFoundException();
        }

        $originUrl = $this->repository->findByCode($code);
        if ($originUrl === null) {
            throw new ShortCodeNotFoundException();
        }

        return $originUrl;
    }

    private function generateCode(int $id): string
    {
        $natural = $this->shortCode->encode($id);
        $targetLength = max($this->settings->codeMinLength(), strlen($natural));

        // 确定性策略：左补到目标长度；正常情况下必然唯一，仅在历史上启用过
        // 随机码且恰好冲突时走随机兜底
        if (!$this->settings->codeRandom()) {
            $deterministic = $this->shortCode->padTo($natural, $targetLength);
            if (!$this->repository->exists($deterministic)) {
                return $deterministic;
            }
        }

        for ($attempt = 0; $attempt < self::RANDOM_MAX_ATTEMPTS; $attempt++) {
            $candidate = $this->shortCode->randomCode($targetLength);
            if (!$this->repository->exists($candidate)) {
                return $candidate;
            }
        }

        throw new StorageException('Unable to generate a unique short code');
    }
}
