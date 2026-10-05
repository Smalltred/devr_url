<?php

declare(strict_types=1);

namespace App\Foundation;

use App\Controllers\UrlController;
use App\Exceptions\ConfigurationException;
use App\Http\ExceptionHandler;
use App\Http\Request;
use App\Http\Response;
use App\Http\Router;
use App\Repositories\SqliteUrlRepository;
use App\Repositories\UrlRepository;
use App\Services\DatabaseService;
use App\Services\ShortCodeService;
use App\Services\ShortUrlService;
use App\Support\Config;
use App\Support\Logger;
use App\Validation\UrlValidator;

/**
 * 组合根：手动装配 Controller → Service → Repository → SQLite，
 * 并在 handle() 中兜底所有异常。测试可注入内存仓库替身。
 */
final class App
{
    private function __construct(
        private readonly Router $router,
        private readonly ExceptionHandler $exceptionHandler,
    ) {
    }

    public static function create(Config $config, ?UrlRepository $repository = null, ?Logger $logger = null): self
    {
        $logger ??= new Logger((string) $config->get('logging.path', sys_get_temp_dir().'/short-url-logs'));
        $repository ??= new SqliteUrlRepository(new DatabaseService($config));

        $controller = new UrlController(new ShortUrlService($repository, new ShortCodeService(), new UrlValidator()));
        $router = new Router();

        $register = require dirname(__DIR__, 2).'/routes/web.php';
        if (!$register instanceof \Closure) {
            throw new ConfigurationException('routes/web.php must return a Closure');
        }

        $register($router, $controller);

        return new self($router, new ExceptionHandler($config, $logger));
    }

    public function handle(Request $request): Response
    {
        try {
            return $this->router->dispatch($request);
        } catch (\Throwable $exception) {
            return $this->exceptionHandler->render($exception);
        }
    }
}
