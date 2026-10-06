<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\Request;
use App\Http\Response;
use App\Services\ClickTracker;
use App\Services\ShortUrlService;
use App\Support\Logger;

/**
 * HTTP 控制器：只做参数提取与响应封装，业务在 ShortUrlService。
 * 响应结构保持与原 Node 后端一致：{url, code} / {error}。
 */
final class UrlController
{
    public function __construct(
        private readonly ShortUrlService $service,
        private readonly ClickTracker $tracker,
        private readonly Logger $logger,
    ) {
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
        $code = $request->routeParam('code');
        $originUrl = $this->service->resolve($code);

        // HEAD 是预检请求，不计入统计；采集失败只记日志，绝不阻塞跳转
        if ($request->method !== 'HEAD') {
            try {
                $this->tracker->track($request, $code);
            } catch (\Throwable $exception) {
                $this->logger->error('click tracking failed', [
                    'exception' => $exception::class,
                    'message' => $exception->getMessage(),
                ]);
            }
        }

        return Response::redirect($originUrl);
    }
}
