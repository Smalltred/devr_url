<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Exceptions\InvalidUrlException;
use App\Validation\UrlValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class UrlValidatorTest extends TestCase
{
    private UrlValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new UrlValidator();
    }

    #[DataProvider('validUrlProvider')]
    public function testValidUrls(string $input, string $expected): void
    {
        self::assertSame($expected, $this->validator->validate($input));
    }

    public static function validUrlProvider(): \Generator
    {
        yield 'http' => ['http://example.com', 'http://example.com'];
        yield 'https' => ['https://example.com', 'https://example.com'];
        yield '带路径' => ['https://example.com/path', 'https://example.com/path'];
        yield '带查询串' => ['https://example.com?a=1&b=2', 'https://example.com?a=1&b=2'];
        yield '多级路径' => ['https://example.com/a/b?q=1', 'https://example.com/a/b?q=1'];
        yield '中文路径自动编码' => ['https://example.com/中文', 'https://example.com/%E4%B8%AD%E6%96%87'];
        yield '中文查询参数' => ['https://example.com/中文', 'https://example.com/%E4%B8%AD%E6%96%87'];
        yield 'IPv4' => ['https://192.168.1.1/x', 'https://192.168.1.1/x'];
        yield 'IPv6 带端口' => ['http://[::1]:8080/x', 'http://[::1]:8080/x'];
        yield '端口' => ['http://example.com:8080/x', 'http://example.com:8080/x'];
        yield '前后空白被裁剪' => ['  https://example.com  ', 'https://example.com'];
        yield '孤立百分号转义' => ['https://example.com/100%', 'https://example.com/100%25'];
        yield '已编码不二次编码' => ['https://a.com/%E4%B8%AD', 'https://a.com/%E4%B8%AD'];
    }

    #[DataProvider('invalidUrlProvider')]
    public function testInvalidUrls(mixed $input): void
    {
        $this->expectException(InvalidUrlException::class);
        $this->validator->validate($input);
    }

    public static function invalidUrlProvider(): \Generator
    {
        yield 'null' => [null];
        yield '数字' => [123];
        yield '数组' => [['https://example.com']];
        yield '空字符串' => [''];
        yield '纯空白' => ['   '];
        yield '缺少协议' => ['example.com'];
        yield '双斜杠开头' => ['//example.com'];
        yield 'ftp 协议' => ['ftp://example.com'];
        yield 'javascript 协议' => ['javascript:alert(1)'];
        yield '协议后无主机' => ['http://'];
        yield '含空格' => ['http://exa mple.com'];
        yield '含换行' => ["https://example.com/\nx"];
        yield '含制表符' => ["https://example.com/\tx"];
        yield '端口超范围' => ['https://example.com:99999/'];
    }
}
