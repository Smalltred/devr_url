<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 配置缺失或非法：HTTP 500，生产环境对外隐藏细节。
 */
final class ConfigurationException extends \RuntimeException
{
}
