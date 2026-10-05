<?php

declare(strict_types=1);

namespace App\Support;

/**
 * 极简 .env 加载器：KEY=VALUE，支持引号与注释行。
 * 已存在的真实环境变量优先，不被 .env 覆盖（便于 Docker/宝塔直接注入）。
 */
final class Env
{
    public static function load(string ...$paths): void
    {
        foreach ($paths as $path) {
            if (!is_file($path)) {
                continue;
            }

            $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if ($lines === false) {
                continue;
            }

            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#')) {
                    continue;
                }

                $separator = strpos($line, '=');
                if ($separator === false) {
                    continue;
                }

                $key = trim(substr($line, 0, $separator));
                $value = trim(substr($line, $separator + 1));
                $value = self::stripQuotes($value);

                if ($key === '' || getenv($key) !== false) {
                    continue;
                }

                putenv($key.'='.$value);
                $_ENV[$key] = $value;
                $_SERVER[$key] = $value;
            }
        }
    }

    private static function stripQuotes(string $value): string
    {
        if (strlen($value) >= 2) {
            $first = $value[0];
            $last = $value[strlen($value) - 1];

            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                return substr($value, 1, -1);
            }
        }

        return $value;
    }
}
