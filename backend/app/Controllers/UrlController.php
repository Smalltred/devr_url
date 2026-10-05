<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\Request;
use App\Http\Response;
use App\Services\ShortUrlService;

/**
 * HTTP 控制器：只做参数提取与响应封装，业务在 ShortUrlService。
 * 响应结构保持与原 Node 后端一致：{url, code} / {error}。
 */
final class UrlController
{
    public function __construct(private readonly ShortUrlService $service)
    {
    }

    public function create(Request $request): Response
    {
        $body = $request->json();
        $url = is_array($body) ? ($body['url'] ?? null) : null;

        $result = $this->service->create($url);

        return Response::json([
            'url' => $result->url,
            'code' => $result->code,
        ]);
    }

    public function redirect(Request $request): Response
    {
        $originUrl = $this->service->resolve($request->routeParam('code'));

        return Response::redirect($originUrl);
    }
}
