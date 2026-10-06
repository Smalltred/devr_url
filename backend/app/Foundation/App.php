<?php

declare(strict_types=1);

namespace App\Foundation;

use App\Controllers\AdminController;
use App\Controllers\AuthController;
use App\Controllers\OpenApiController;
use App\Controllers\UrlController;
use App\Exceptions\ConfigurationException;
use App\Exceptions\PayloadTooLargeException;
use App\Http\ExceptionHandler;
use App\Http\Request;
use App\Http\Response;
use App\Http\Router;
use App\Repositories\ApiKeyRepository;
use App\Repositories\AuthRepository;
use App\Repositories\ClickRepository;
use App\Repositories\RequestThrottleRepository;
use App\Repositories\SettingsRepository;
use App\Repositories\SqliteApiKeyRepository;
use App\Repositories\SqliteAuthRepository;
use App\Repositories\SqliteClickRepository;
use App\Repositories\SqliteMetaRepository;
use App\Repositories\SqliteRequestThrottleRepository;
use App\Repositories\SqliteSettingsRepository;
use App\Repositories\SqliteUrlRepository;
use App\Repositories\UrlRepository;
use App\Security\CsrfGuard;
use App\Security\RequestRateLimiter;
use App\Security\SecurityHeaders;
use App\Services\AdminService;
use App\Services\ApiKeyService;
use App\Services\AuthService;
use App\Services\ClickTracker;
use App\Services\DatabaseService;
use App\Services\SettingsService;
use App\Services\ShortCodeService;
use App\Services\ShortUrlService;
use App\Support\Config;
use App\Support\IpHasher;
use App\Support\Logger;
use App\Validation\UrlValidator;

/**
 * 组合根：手动装配 Controller → Service → Repository → SQLite，
 * 并在 handle() 中兜底所有异常。测试可注入内存仓库替身。
 * 请求体上限、跨站来源校验与安全响应头在此统一施加，早于/晚于任何处理器。
 */
final class App
{
    /**
     * @param list<string> $cspScriptExtra
     * @param list<string> $cspConnectExtra
     */
    private function __construct(
        private readonly Router $router,
        private readonly ExceptionHandler $exceptionHandler,
        private readonly ?CsrfGuard $csrfGuard = null,
        private readonly int $maxBodyBytes = 0,
        private readonly array $cspScriptExtra = [],
        private readonly array $cspConnectExtra = [],
        private readonly int $hstsMaxAge = 0,
    ) {
    }

    public static function create(
        Config $config,
        ?UrlRepository $repository = null,
        ?Logger $logger = null,
        ?ClickRepository $clickRepository = null,
        ?AuthRepository $authRepository = null,
        ?SettingsRepository $settingsRepository = null,
        ?ApiKeyRepository $apiKeyRepository = null,
        ?RequestThrottleRepository $throttleRepository = null,
    ): self {
        $logger ??= new Logger((string) $config->get('logging.path', sys_get_temp_dir().'/short-url-logs'));
        $database = new DatabaseService($config);

        $repository ??= new SqliteUrlRepository($database);
        $clickRepository ??= new SqliteClickRepository($database);
        $authRepository ??= new SqliteAuthRepository($database);
        $settingsRepository ??= new SqliteSettingsRepository($database);
        $apiKeyRepository ??= new SqliteApiKeyRepository($database);
        $throttleRepository ??= new SqliteRequestThrottleRepository($database);
        $settings = new SettingsService($settingsRepository);
        $apiKeyService = new ApiKeyService($apiKeyRepository, $logger);

        $validator = new UrlValidator();
        $ipHasher = new IpHasher(
            new SqliteMetaRepository($database),
            (string) $config->get('security.ip_hash_secret', ''),
        );

        $shortUrlService = new ShortUrlService($repository, new ShortCodeService(), $validator, $settings);
        $urlController = new UrlController(
            $shortUrlService,
            new ClickTracker($clickRepository, $ipHasher, $config->get('privacy.store_full_referer') === true),
            $logger,
        );

        $authService = new AuthService($authRepository, $config, $logger, $ipHasher, $settings);
        $authController = new AuthController($authService, $settings);

        $adminService = new AdminService($repository, $clickRepository, $validator, $settings);
        $adminController = new AdminController(
            $adminService,
            $authService,
            $apiKeyService,
            (string) $config->get('app.dist_index', dirname(__DIR__, 3).'/dist/index.html'),
        );

        $openController = new OpenApiController($shortUrlService);

        $csrfGuard = new CsrfGuard(
            self::stringList($config->get('security.allowed_origins')),
            $config->get('security.csrf_allow_missing_origin') === true,
        );
        $rateLimiter = new RequestRateLimiter(
            $throttleRepository,
            $ipHasher,
            (int) $config->get('ratelimit.create_max', 0),
            (int) $config->get('ratelimit.create_window_seconds', 60),
        );

        $router = new Router();

        $register = require dirname(__DIR__, 2).'/routes/web.php';
        if (!$register instanceof \Closure) {
            throw new ConfigurationException('routes/web.php must return a Closure');
        }

        $register(
            $router,
            $urlController,
            $authController,
            $adminController,
            $openController,
            $authService,
            $apiKeyService,
            $settings,
            $csrfGuard,
            $rateLimiter,
        );

        return new self(
            $router,
            new ExceptionHandler($config, $logger),
            $csrfGuard,
            (int) $config->get('app.max_body_bytes', 0),
            self::stringList($config->get('security.csp_script_extra')),
            self::stringList($config->get('security.csp_connect_extra')),
            (int) $config->get('security.hsts_max_age', 0),
        );
    }

    /**
     * 请求体大小与跨站来源校验：两者都必须在任何处理器之前生效，
     * 否则超限请求或跨站写操作会先被业务逻辑处理。
     */
    public function handle(Request $request): Response
    {
        try {
            if ($this->maxBodyBytes > 0 && strlen($request->rawBody()) > $this->maxBodyBytes) {
                throw new PayloadTooLargeException('Request body exceeds '.$this->maxBodyBytes.' bytes');
            }

            $this->csrfGuard?->assertSafe($request);

            $response = $this->router->dispatch($request);

            return SecurityHeaders::apply(
                $response,
                $this->cspScriptExtra,
                $this->cspConnectExtra,
                SecurityHeaders::isSecureRequest($request) ? $this->hstsMaxAge : 0,
            );
        } catch (\Throwable $exception) {
            return SecurityHeaders::apply(
                $this->exceptionHandler->render($exception),
                $this->cspScriptExtra,
                $this->cspConnectExtra,
                SecurityHeaders::isSecureRequest($request) ? $this->hstsMaxAge : 0,
            );
        }
    }

    /**
     * @return list<string>
     */
    private static function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $list = [];
        foreach ($value as $item) {
            if (is_string($item) && trim($item) !== '') {
                $list[] = trim($item);
            }
        }

        return $list;
    }
}
