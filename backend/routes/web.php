<?php

declare(strict_types=1);

use App\Controllers\AdminController;
use App\Controllers\AuthController;
use App\Controllers\UrlController;
use App\Http\Request;
use App\Http\Response;
use App\Http\Router;
use App\Services\AuthService;
use App\Services\SettingsService;

/**
 * 路由注册。
 * 注意：
 * - POST /url 是原 Node 后端的既有接口，必须保留以兼容原前端与存量调用；POST /api/url 为规范化别名。
 * - GET /admin 必须注册在 GET /{code} 之前，否则会被单段短码兜底路由吞掉。
 * - /api/admin/* 一律经 $guard 施加登录校验（401）；创建短链在开启 require_login 后同样需要登录。
 */
return static function (Router $router, UrlController $url, AuthController $auth, AdminController $admin, AuthService $authService, SettingsService $settings): void {
    $publicGuard = static function (callable $handler) use ($authService, $settings): callable {
        return static function (Request $request) use ($authService, $settings, $handler): Response {
            if ($settings->requireLogin()) {
                $authService->requireAuth($request);
            }

            return $handler($request);
        };
    };

    $router->post('/url', $publicGuard([$url, 'create']));
    $router->post('/api/url', $publicGuard([$url, 'create']));

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

    $router->get('/admin', [$admin, 'page']);

    $router->get('/{code}', [$url, 'redirect']);
};
