<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\Request;
use App\Http\Response;
use App\Security\SecurityHeaders;
use App\Services\AuthService;
use App\Services\SettingsService;

/**
 * 登录/登出/会话查询。login 返回的 Set-Cookie 由 AuthService 生成。
 * me() 附带 require_login，供首页判断是否需要跳转登录。
 */
final class AuthController
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly SettingsService $settings,
    ) {
    }

    public function login(Request $request): Response
    {
        $body = $request->json();
        $username = is_array($body) ? ($body['username'] ?? null) : null;
        $password = is_array($body) ? ($body['password'] ?? null) : null;

        $secure = SecurityHeaders::isSecureRequest($request);
        $cookie = $this->auth->login($username, $password, $request->clientIp(), $secure);

        return Response::json(['ok' => true], 200, ['set-cookie' => $cookie]);
    }

    public function logout(Request $request): Response
    {
        $cookie = $this->auth->logout($request, SecurityHeaders::isSecureRequest($request));

        return Response::json(['ok' => true], 200, ['set-cookie' => $cookie]);
    }

    public function me(Request $request): Response
    {
        return Response::json([
            'authenticated' => $this->auth->isAuthenticated($request),
            'require_login' => $this->settings->requireLogin(),
        ]);
    }
}
