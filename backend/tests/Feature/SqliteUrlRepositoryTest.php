<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Foundation\App;
use App\Repositories\SqliteClickRepository;
use App\Repositories\SqliteUrlRepository;
use App\Services\DatabaseService;
use App\Services\ShortCodeService;
use App\Support\Config;
use PHPUnit\Framework\TestCase;
use Tests\Support\TestApp;

/**
 * SQLite 仓库集成测试：真实落库（临时文件），验证计数器自增、
 * 重启后旧短链可读、计数进度延续，以及生产装配链（App::create 默认 SQLite 仓库）端到端可用。
 * 短码向量沿用原 Node.js encode 的生成结果（tests/Compat/expected_codes.php）。
 */
final class SqliteUrlRepositoryTest extends TestCase
{
    private string $path;

    protected function setUp(): void
    {
        $this->path = sys_get_temp_dir().'/short-url-sqlite-test-'.uniqid('', true).'.sqlite3';
    }

    protected function tearDown(): void
    {
        foreach (['', '-wal', '-shm'] as $suffix) {
            if (is_file($this->path.$suffix)) {
                @unlink($this->path.$suffix);
            }
        }
    }

    public function testCounterIncrementsFromOne(): void
    {
        $repository = $this->repository();

        self::assertSame(1, $repository->nextId());
        self::assertSame(2, $repository->nextId());
        self::assertSame(3, $repository->nextId());
    }

    public function testSaveFindAndExists(): void
    {
        $repository = $this->repository();
        $repository->save('abc', 'https://example.com');

        self::assertSame('https://example.com', $repository->findByCode('abc'));
        self::assertTrue($repository->exists('abc'));
        self::assertFalse($repository->exists('missing'));
        self::assertNull($repository->findByCode('missing'));
    }

    public function testDataSurvivesRestartAndCounterContinues(): void
    {
        $first = $this->repository();
        $first->save('abc', 'https://example.com');
        for ($i = 0; $i < 100; $i++) {
            $first->nextId();
        }

        // 模拟进程重启：全新连接实例指向同一数据库文件
        $restarted = $this->repository();

        self::assertSame('https://example.com', $restarted->findByCode('abc'), '重启后旧短码必须可读');
        self::assertSame(101, $restarted->nextId(), '计数器必须从上次进度继续');

        $vectors = require __DIR__.'/../Compat/expected_codes.php';
        self::assertIsArray($vectors);
        self::assertArrayHasKey(101, $vectors);
        self::assertSame(
            $vectors[101],
            (new ShortCodeService())->encode(101),
            '新短码必须与原 Node.js encode(101) 一致',
        );
    }

    public function testEndToEndThroughAppUsesSqlite(): void
    {
        $app = App::create(self::config($this->path));

        $created = $app->handle(TestApp::request('POST', '/url', '{"url":"https://example.com"}'));
        self::assertSame(200, $created->status());
        self::assertSame(['url' => 'https://example.com', 'code' => 'S'], $created->decodedJson());

        $redirect = $app->handle(TestApp::request('GET', '/S'));
        self::assertSame(302, $redirect->status());
        self::assertSame('https://example.com', $redirect->header('location'));
    }

    public function testUpdateMigratesClicksWhenCodeChanges(): void
    {
        $repository = $this->repository();
        $repository->save('abc', 'https://example.com');

        $clicks = new SqliteClickRepository(new DatabaseService(self::config($this->path)));
        $clicks->record('abc', ['referer' => null, 'referer_host' => null, 'device' => 'desktop', 'ip_hash' => null]);
        $clicks->record('abc', ['referer' => null, 'referer_host' => null, 'device' => 'desktop', 'ip_hash' => null]);

        $repository->update('abc', 'xyz', 'https://changed.example.com');

        self::assertSame('https://changed.example.com', $repository->findByCode('xyz'));
        self::assertFalse($repository->exists('abc'));
        self::assertSame(['xyz' => 2], $clicks->totalByCodes(['xyz']), '改短码后点击统计必须跟随迁移');
    }

    public function testDeleteCascadesClicks(): void
    {
        $repository = $this->repository();
        $repository->save('abc', 'https://example.com');

        $clicks = new SqliteClickRepository(new DatabaseService(self::config($this->path)));
        $clicks->record('abc', ['referer' => null, 'referer_host' => null, 'device' => 'desktop', 'ip_hash' => null]);

        $repository->delete('abc');

        self::assertFalse($repository->exists('abc'));
        self::assertSame(0, $clicks->totalAll(), '删除短链必须级联删除点击记录');
    }

    public function testPaginateFiltersSearchesAndCounts(): void
    {
        $repository = $this->repository();
        $repository->save('alpha', 'https://foo.com/a');
        $repository->save('beta', 'https://bar.com/b');
        $repository->save('gamma', 'https://foo.com/g');

        $all = $repository->paginate(2, 0, '');
        self::assertSame(3, $all['total']);
        self::assertCount(2, $all['items']);

        $byUrl = $repository->paginate(10, 0, 'bar.com');
        self::assertSame(1, $byUrl['total']);
        self::assertSame('beta', $byUrl['items'][0]['code']);

        // LIKE 通配符必须被转义，不产生误匹配
        $wildcard = $repository->paginate(10, 0, '%');
        self::assertSame(0, $wildcard['total']);
    }

    private function repository(): SqliteUrlRepository
    {
        return new SqliteUrlRepository(new DatabaseService(self::config($this->path)));
    }

    private static function config(string $path): Config
    {
        return new Config([
            'app' => ['env' => 'testing', 'debug' => false, 'url' => '', 'port' => 3001],
            'database' => ['path' => $path],
            'logging' => ['path' => sys_get_temp_dir().'/short-url-test-logs'],
        ]);
    }
}
