<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Exceptions\ValidationException;
use App\Http\Request;
use App\Http\Response;
use App\Services\AdminService;
use App\Services\AuthService;

/**
 * 管理端接口与 /admin 面板页（返回前端构建产物 dist/index.html）。
 * 鉴权由 routes/web.php 中的路由闭包统一施加，控制器不重复校验。
 */
final class AdminController
{
    public function __construct(
        private readonly AdminService $service,
        private readonly AuthService $auth,
        private readonly string $distIndexPath,
    ) {
    }

    public function overview(): Response
    {
        return Response::json($this->service->overview());
    }

    public function links(Request $request): Response
    {
        $page = (int) ($request->queryParam('page') ?? '1');
        $perPage = (int) ($request->queryParam('per_page') ?? '20');
        $query = (string) ($request->queryParam('q') ?? '');

        return Response::json($this->service->links($page, $perPage, $query));
    }

    public function update(Request $request): Response
    {
        $result = $this->service->updateLink($request->routeParam('code'), $request->json());

        return Response::json($result);
    }

    public function delete(Request $request): Response
    {
        $this->service->deleteLink($request->routeParam('code'));

        return Response::json(['ok' => true]);
    }

    public function stats(Request $request): Response
    {
        return Response::json($this->service->linkStats($request->routeParam('code')));
    }

    public function settings(): Response
    {
        return Response::json($this->service->settingsView());
    }

    public function updateSettings(Request $request): Response
    {
        return Response::json($this->service->updateSettings($request->json()));
    }

    public function changePassword(Request $request): Response
    {
        $body = $request->json();
        $current = is_array($body) && is_string($body['current_password'] ?? null) ? $body['current_password'] : '';
        $new = is_array($body) && is_string($body['new_password'] ?? null) ? $body['new_password'] : '';

        if ($current === '' || $new === '') {
            throw new ValidationException('请填写当前密码与新密码');
        }

        $this->auth->changePassword($current, $new);

        return Response::json(['ok' => true]);
    }

    /**
     * /admin 单页入口。生产由本路由返回 dist/index.html（Nginx 无需为 SPA 配置回退）；
     * 前端未构建时给出可读提示。
     */
    public function page(): Response
    {
        $html = is_file($this->distIndexPath) ? @file_get_contents($this->distIndexPath) : false;
        if ($html === false || $html === '') {
            return Response::text('Frontend build not found. Run "npm run build" first.', 404);
        }

        return Response::html($html);
    }
}
