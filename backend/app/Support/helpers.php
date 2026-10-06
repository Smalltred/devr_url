<?php

declare(strict_types=1);

namespace App\Support;

if (!function_exists(__NAMESPACE__.'\env')) {
    /**
     * 读取环境变量（.env 与真实环境变量统一入口）。
     * 变量不存在或为空字符串均视为未设置，返回默认值（.env 中"留空 = 默认值"）。
     * 经由 Env::get 读取，不依赖 putenv（宝塔等环境默认禁用该函数）。
     */
    function env(string $key, ?string $default = null): ?string
    {
        return Env::get($key, $default);
    }
}

if (!function_exists(__NAMESPACE__.'\env_bool')) {
    function env_bool(string $key, bool $default = false): bool
    {
        $value = env($key);
        if ($value === null) {
            return $default;
        }

        return in_array(strtolower($value), ['1', 'true', 'on', 'yes'], true);
    }
}

if (!function_exists(__NAMESPACE__.'\env_int')) {
    function env_int(string $key, int $default): int
    {
        $value = env($key);
        if ($value === null || preg_match('/^\d+$/', $value) !== 1) {
            return $default;
        }

        return (int) $value;
    }
}
