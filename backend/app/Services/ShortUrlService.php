<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\ShortCodeNotFoundException;
use App\Repositories\UrlRepository;
use App\Validation\UrlValidator;

/**
 * 业务编排：验证 URL → 取自增 ID → 生成短码 → 落库 → 返回结果。
 * 与原项目保持一致：不做 URL 去重（同一 URL 多次提交会产生多个短码）。
 */
final class ShortUrlService
{
    public function __construct(
        private readonly UrlRepository $repository,
        private readonly ShortCodeService $shortCode,
        private readonly UrlValidator $validator,
    ) {
    }

    public function create(mixed $rawUrl): UrlResult
    {
        $url = $this->validator->validate($rawUrl);
        $id = $this->repository->nextId();
        $code = $this->shortCode->encode($id);
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
}
