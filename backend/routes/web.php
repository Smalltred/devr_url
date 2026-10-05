<?php

declare(strict_types=1);

use App\Controllers\UrlController;
use App\Http\Router;

/**
 * 路由注册。
 * 注意：POST /url 是原 Node 后端的既有接口，必须保留以兼容原前端与存量调用；
 * POST /api/url 为新增的规范化别名。
 */
return static function (Router $router, UrlController $controller): void {
    $router->post('/url', [$controller, 'create']);
    $router->post('/api/url', [$controller, 'create']);
    $router->get('/{code}', [$controller, 'redirect']);
};
