<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\Request;
use App\Http\Response;
use App\Services\ShortUrlService;

/**
 * 开放 API：供外部程序以 API Key 鉴权调用，鉴权由 routes/web.php 的路由闭包统一施加。
 * 响应结构与公开创建接口一致：{url, code}，短码同样遵循后台的长度/随机性设置。
 */
final class OpenApiController
{
    public function __construct(private readonly ShortUrlService $service)
    {
    }

    public function shorten(Request $request): Response
    {
        $body = $request->json();
        $url = is_array($body) ? ($body['url'] ?? null) : null;

        $result = $this->service->create($url);

        return Response::json([
            'url' => $result->url,
            'code' => $result->code,
        ]);
    }
}
