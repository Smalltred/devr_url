<?php

declare(strict_types=1);

use App\Controllers\AdminController;
use App\Controllers\AuthController;
use App\Controllers\OpenApiController;
use App\Controllers\UrlController;
use App\Http\Request;
use App\Http\Response;
use App\Http\Router;
use App\Security\CsrfGuard;
use App\Security\RequestRateLimiter;
use App\Services\ApiKeyService;
use App\Services\AuthService;
use App\Services\SettingsService;

/**
 * 路由注册。
 * 注意：
 * - POST /url 是原 Node 后端的既有接口，必须保留以兼容原前端与存量调用；POST /api/url 为规范化别名。
 * - GET /admin 必须注册在 GET /{code} 之前，否则会被单段短码兜底路由吞掉。
 * - /api/admin/* 一律经 $guard 施加登录校验（401）；创建短链在开启 require_login 后同样需要登录。
 * - /api/open/* 经 $openGuard 校验 API Key（Bearer 或 X-API-Key 头），不受 require_login 影响。
 * - 跨站来源校验（CSRF）与请求体体积上限（413）由 App::handle() 统一施加，早于任何处理器。
 * - 创建类接口额外经 $rateLimiter 限流（429），避免被批量刷短码。
 */
return static function (Router $router, UrlController $url, AuthController $auth, AdminController $admin, OpenApiController $open, AuthService $authService, ApiKeyService $apiKeyService, SettingsService $settings, CsrfGuard $csrfGuard, RequestRateLimiter $rateLimiter): void {
    $publicGuard = static function (callable $handler) use ($authService, $settings, $rateLimiter): callable {
        return static function (Request $request) use ($authService, $settings, $rateLimiter, $handler): Response {
            if ($settings->requireLogin()) {
                $authService->requireAuth($request);
            }

            $rateLimiter->assertAllowed($request, RequestRateLimiter::SCOPE_CREATE);

            return $handler($request);
        };
    };

    $openGuard = static function (callable $handler) use ($apiKeyService, $rateLimiter): callable {
        return static function (Request $request) use ($apiKeyService, $rateLimiter, $handler): Response {
            $apiKeyService->requireValidKey($request);
            $rateLimiter->assertAllowed($request, RequestRateLimiter::SCOPE_CREATE);

            return $handler($request);
        };
    };

    $router->post('/url', $publicGuard([$url, 'create']));
    $router->post('/api/url', $publicGuard([$url, 'create']));

    $router->post('/api/open/shorten', $openGuard([$open, 'shorten']));

    $router->post('/api/auth/login', [$auth, 'login']);
    $router->post('/api/auth/logout', [$auth, 'logout']);
    $router->get('/api/auth/me', [$auth, 'me']);

    $guard = static function (callable $handler) use ($authService): callable {
        return static function (Request $request) use ($authService, $handler): Response {
            $authService->requireAuth($request);

            return $handler($request);
        };
    };

    $router->get('/api/admin/overview', $guard([$admin, 'overview']));
    $router->get('/api/admin/links', $guard([$admin, 'links']));
    $router->put('/api/admin/links/{code}', $guard([$admin, 'update']));
    $router->delete('/api/admin/links/{code}', $guard([$admin, 'delete']));
    $router->get('/api/admin/links/{code}/stats', $guard([$admin, 'stats']));
    $router->get('/api/admin/settings', $guard([$admin, 'settings']));
    $router->put('/api/admin/settings', $guard([$admin, 'updateSettings']));
    $router->post('/api/admin/settings/password', $guard([$admin, 'changePassword']));

    $router->get('/api/admin/keys', $guard([$admin, 'keys']));
    $router->post('/api/admin/keys', $guard([$admin, 'createKey']));
    $router->post('/api/admin/keys/{id}/reset', $guard([$admin, 'resetKey']));
    $router->delete('/api/admin/keys/{id}', $guard([$admin, 'deleteKey']));

    $router->get('/admin', [$admin, 'page']);

    $router->get('/{code}', [$url, 'redirect']);
};
