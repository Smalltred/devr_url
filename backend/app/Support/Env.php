<?php

declare(strict_types=1);

namespace App\Support;

/**
 * 极简 .env 加载器：KEY=VALUE，支持引号与注释行。
 * 已存在的真实环境变量优先，不被 .env 覆盖（便于 Docker/宝塔直接注入）。
 * 刻意不使用 putenv()（宝塔等环境默认禁用该函数）：.env 值存入内存，
 * 由 env() 助手按「真实环境变量 → .env → 默认值」的顺序读取。
 */
final class Env
{
    /** @var array<string, string> */
    private static array $values = [];

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

                if ($key === '' || getenv($key) !== false || array_key_exists($key, self::$values)) {
                    continue;
                }

                self::$values[$key] = $value;
                $_ENV[$key] = $value;
                $_SERVER[$key] = $value;
            }
        }
    }

    /**
     * 读取环境变量：真实环境变量 → .env 已加载值 → 默认值。
     * 空字符串一律视为未设置（.env 中"留空 = 默认值"）。
     */
    public static function get(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);
        if (is_string($value) && $value !== '') {
            return $value;
        }

        $value = self::$values[$key] ?? null;
        if (is_string($value) && $value !== '') {
            return $value;
        }

        return $default;
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
