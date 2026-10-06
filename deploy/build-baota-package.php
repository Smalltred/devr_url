<?php

declare(strict_types=1);

/**
 * 生成宝塔开箱即用部署包（标准 PHP 项目结构）：项目根目录/baota-package/
 *
 *   baota-package/            ← 解压后直接上传文件夹内容到站点目录
 *   ├── public/               Web 运行目录（index.php 前端控制器 + check.php 自检 + 前端产物 + .htaccess）
 *   ├── app/ config/ routes/ vendor/
 *   ├── storage/              运行目录（空的 logs/）：数据库与日志由程序在服务器上自动创建，不随包提供
 *   ├── .env / .env.example   生产配置（首次部署用；覆盖更新时请保护服务器上已改过的 .env）
 *   ├── nginx-rewrite.conf
 *   └── 部署说明.md
 *
 *   baota-package.zip         ← 单文件发布包：上传到宝塔站点目录解压覆盖即完成更新
 *
 * 用法：先在项目根目录 npm run build，然后 php deploy/build-baota-package.php
 *
 * zip 内容约定（重要）：
 *   - **不包含** `storage/`（SQLite 数据库与日志）：覆盖解压永远不会影响服务器上的短链数据；
 *     数据库由程序在首次访问时自动创建（含全部表结构），无需手动初始化；
 *   - 包含 `.env`：覆盖解压会替换服务器配置（管理员密码等），更新时请保护服务器的 `.env`
 *     （宝塔解压时跳过同名文件，或先备份再恢复）；服务器尚未配置过则无需处理。
 *   详见包内 部署说明.md 的「更新部署」章节。
 *
 * 后端依赖：设置环境变量 COMPOSER_PHAR 指向 composer.phar 时以 --no-dev 重新安装（包更小）；
 *          未设置则直接复制现有 vendor/（含开发工具，体积较大但离线可用）。
 */

$projectRoot = dirname(__DIR__);
$distDir = $projectRoot.'/dist';
$backendDir = $projectRoot.'/backend';
$packageDir = $projectRoot.'/baota-package';
$zipPath = $projectRoot.'/baota-package.zip';
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

// ---------- 7) 打包为单文件 zip（上传这个文件即可；不含数据库文件） ----------
if (!class_exists(ZipArchive::class)) {
    fwrite(STDERR, "PHP zip 扩展未启用，无法生成 {$zipPath}（可手动压缩 baota-package/ 目录）\n");
    exit(1);
}

if (is_file($zipPath)) {
    @unlink($zipPath);
}

$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    fwrite(STDERR, "无法创建 zip：{$zipPath}\n");
    exit(1);
}

// 空目录（storage/ 与 storage/logs/）：解压即存在，避免首次部署时权限/自动建目录问题
$zip->addEmptyDir('storage');
$zip->addEmptyDir('storage/logs');

$fileCount = 0;
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($packageDir, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::LEAVES_ONLY,
);
foreach ($iterator as $item) {
    if (!$item->isFile()) {
        continue;
    }

    $relPath = str_replace('\\', '/', substr($item->getPathname(), strlen($packageDir) + 1));
    // 数据库与日志一律不入包：覆盖解压永不触碰服务器数据
    if (str_starts_with($relPath, 'storage/')) {
        continue;
    }
    if ($zip->addFile($item->getPathname(), $relPath)) {
        $fileCount++;
    }
}
$zip->close();

$sizeKb = max(1, (int) round(filesize($zipPath) / 1024));
echo "单文件发布包：{$zipPath}（{$fileCount} 个文件，{$sizeKb} KB，不含数据库）\n";
echo "部署包目录：$packageDir\n";

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
