<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\ShortCodeService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * 短码兼容测试：期望值全部来自原 Node.js 实现（backend/tools/gen-code-vectors.js 生成）。
 */
final class ShortCodeServiceTest extends TestCase
{
    private ShortCodeService $service;

    protected function setUp(): void
    {
        $this->service = new ShortCodeService();
    }

    #[DataProvider('codeVectorProvider')]
    public function testEncodeMatchesLegacyNodeImplementation(int $id, string $expectedCode): void
    {
        self::assertSame($expectedCode, $this->service->encode($id));
    }

    public static function codeVectorProvider(): \Generator
    {
        $vectors = require __DIR__.'/../Compat/expected_codes.php';
        self::assertIsArray($vectors);

        foreach ($vectors as $id => $code) {
            yield 'id='.$id => [(int) $id, (string) $code];
        }
    }

    public function testEncodeZeroReturnsEmptyString(): void
    {
        self::assertSame('', $this->service->encode(0));
    }

    public function testNegativeIdThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->encode(-1);
    }

    public function testAlphabetHasSixtyTwoUniqueCharacters(): void
    {
        $reflection = new \ReflectionClass(ShortCodeService::class);
        $alphabet = (string) $reflection->getConstant('ALPHABET');

        self::assertSame(62, strlen($alphabet), '字母表必须为 62 个字符');
        self::assertSame(62, strlen((string) count_chars($alphabet, 3)), '字母表不得有重复字符');
    }
}
