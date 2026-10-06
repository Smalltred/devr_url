<?php

declare(strict_types=1);

/**
 * 生成宝塔开箱即用部署包（标准 PHP 项目结构）：项目根目录/baota-package/
 *
 *   baota-package/
 *   ├── public/          Web 运行目录（index.php 前端控制器 + check.php 自检 + 前端产物 + .htaccess）
 *   ├── app/ config/ routes/ vendor/
 *   ├── storage/         SQLite 数据库与日志
 *   ├── .env / .env.example
 *   ├── nginx-rewrite.conf
 *   └── 部署说明.md
 *
 * 用法：php deploy/build-baota-package.php
 * 前置：先在项目根目录执行 npm run build 生成 dist/。
 * 后端依赖：设置环境变量 COMPOSER_PHAR 指向 composer.phar 时以 --no-dev 重新安装（包更小）；
 *          未设置则直接复制现有 vendor/（含开发工具，体积较大但离线可用）。
 */

$projectRoot = dirname(__DIR__);
$distDir = $projectRoot.'/dist';
$backendDir = $projectRoot.'/backend';
$packageDir = $projectRoot.'/baota-package';
$templateDir = __DIR__.'/baota';

if (!is_file($distDir.'/index.html')) {
    fwrite(STDERR, "缺少 dist/index.html，请先在项目根目录执行 npm run build\n");
    exit(1);
}

// ---------- 1) 重建包目录 ----------
remove_directory($packageDir);
foreach ([$packageDir, $packageDir.'/public', $packageDir.'/storage/logs'] as $dir) {
    if (!is_dir($dir) && !mkdir($dir, 0777, true)) {
        fwrite(STDERR, "无法创建目录：$dir\n");
        exit(1);
    }
}

// ---------- 2) 前端产物平铺到 public/（Web 运行目录） ----------
recurse_copy($distDir, $packageDir.'/public');

// ---------- 3) 后端代码（app/config/routes 提升到包根，public 由模板提供） ----------
foreach (['app', 'config', 'routes'] as $name) {
    recurse_copy($backendDir.'/'.$name, $packageDir.'/'.$name);
}
copy($backendDir.'/composer.json', $packageDir.'/composer.json');
copy($backendDir.'/composer.lock', $packageDir.'/composer.lock');

// ---------- 4) 依赖 ----------
$composerPhar = (string) (getenv('COMPOSER_PHAR') ?: '');
$installed = false;
if ($composerPhar !== '' && is_file($composerPhar)) {
    $originalDir = getcwd();
    chdir($packageDir);
    passthru(
        escapeshellarg(PHP_BINARY).' '.escapeshellarg($composerPhar)
        .' install --no-dev --optimize-autoloader --no-interaction --no-progress 2>&1',
        $exitCode,
    );
    if ($originalDir !== false) {
        chdir($originalDir);
    }
    $installed = $exitCode === 0 && is_dir($packageDir.'/vendor');
    if (!$installed) {
        fwrite(STDERR, "composer install 失败，回退为复制现有 vendor/\n");
    }
}
if (!$installed) {
    recurse_copy($backendDir.'/vendor', $packageDir.'/vendor');
}

// ---------- 5) 生产环境配置 ----------
file_put_contents($packageDir.'/.env', "APP_ENV=production\nAPP_DEBUG=false\nAPP_URL=\nAPP_PORT=3001\nDATABASE_PATH=\n");
file_put_contents($packageDir.'/.env.example', "APP_ENV=production\nAPP_DEBUG=false\nAPP_URL=\nAPP_PORT=3001\nDATABASE_PATH=\n");

// ---------- 6) 模板（public 运行目录 + 根目录说明文件） ----------
foreach (['index.php', 'check.php', '.htaccess'] as $name) {
    copy($templateDir.'/public/'.$name, $packageDir.'/public/'.$name);
}
foreach (['nginx-rewrite.conf', '部署说明.md'] as $name) {
    copy($templateDir.'/'.$name, $packageDir.'/'.$name);
}

// ---------- 7) 直接初始化数据库（建全全部表结构，首个请求即可写入） ----------
require $packageDir.'/vendor/autoload.php';
App\Support\Env::load($packageDir.'/.env');
$packageConfig = new App\Support\Config(require $packageDir.'/config/config.php');
$database = new App\Services\DatabaseService($packageConfig);
$database->execute(static function (PDO $pdo): void {
    $pdo->query('SELECT 1');
});
unset($database);
echo "数据库已初始化\n";

echo "部署包已生成：$packageDir\n";

function recurse_copy(string $src, string $dst): void
{
    if (!is_dir($dst) && !mkdir($dst, 0777, true)) {
        fwrite(STDERR, "无法创建目录：$dst\n");
        exit(1);
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST,
    );
    foreach ($iterator as $item) {
        $target = $dst.DIRECTORY_SEPARATOR.$iterator->getSubPathName();
        if ($item->isDir()) {
            if (!is_dir($target) && !mkdir($target, 0777, true)) {
                fwrite(STDERR, "无法创建目录：$target\n");
                exit(1);
            }
        } else {
            copy($item->getPathname(), $target);
        }
    }
}

function remove_directory(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }

    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );
    foreach ($items as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($dir);
}
