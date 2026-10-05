<?php

declare(strict_types=1);

namespace App\Validation;

use App\Exceptions\InvalidUrlException;

/**
 * URL 校验与归一化（对原 Node 版 encodeURI + 正则方案的重新设计）：
 *
 * - 必须是字符串、非空、http/https 开头、存在 host；
 * - 拒绝任意 ASCII 空白字符（原版会把空格编码后放行，属缺陷）；
 * - 孤立的 %（未跟两位十六进制）转义为 %25，对齐 encodeURI 行为；
 * - 已经是合法 %XX 的序列不再二次编码（修复原版 encodeURI 的 %25 缺陷）；
 * - 非 ASCII 字符（如中文路径/查询参数）按 UTF-8 百分号编码；
 * - 支持 IPv4 / IPv6 / 端口。
 */
final class UrlValidator
{
    private const SCHEME_PATTERN = '#^https?://#i';

    private const ISOLATED_PERCENT_PATTERN = '/%(?![0-9A-Fa-f]{2})/';

    private const NON_ASCII_PATTERN = '/[\x80-\xFF]/';

    public function validate(mixed $value): string
    {
        if (!is_string($value)) {
            throw new InvalidUrlException();
        }

        $url = trim($value);
        if ($url === '') {
            throw new InvalidUrlException();
        }

        if (preg_match('/\s/', $url) === 1) {
            throw new InvalidUrlException();
        }

        if (preg_match(self::SCHEME_PATTERN, $url) !== 1) {
            throw new InvalidUrlException();
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            throw new InvalidUrlException();
        }

        $host = $parts['host'] ?? null;
        if (!is_string($host) || $host === '') {
            throw new InvalidUrlException();
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true)) {
            throw new InvalidUrlException();
        }

        $port = $parts['port'] ?? null;
        if (is_int($port) && ($port < 1 || $port > 65535)) {
            throw new InvalidUrlException();
        }

        return $this->normalize($url);
    }

    private function normalize(string $url): string
    {
        $url = preg_replace_callback(
            self::ISOLATED_PERCENT_PATTERN,
            static fn (): string => '%25',
            $url,
        );

        return (string) preg_replace_callback(
            self::NON_ASCII_PATTERN,
            static fn (array $match): string => rawurlencode($match[0]),
            $url ?? '',
        );
    }
}
