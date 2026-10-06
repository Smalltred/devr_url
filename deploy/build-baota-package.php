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
 *   ├── update/          增量更新：相对"已部署基线"需要覆盖到服务器的文件 + 更新说明.txt
 *   └── 部署说明.md
 *
 * 用法：
 *   php deploy/build-baota-package.php                     生成/刷新部署包与 update/ 增量
 *   php deploy/build-baota-package.php --mark-deployed     上传完成后执行：把基线推进到当前包，
 *                                                          之后的 update/ 只包含真正的增量
 *
 * 前置：先在项目根目录执行 npm run build 生成 dist/。
 * 后端依赖：设置环境变量 COMPOSER_PHAR 指向 composer.phar 时以 --no-dev 重新安装（包更小）；
 *          未设置则直接复制现有 vendor/（含开发工具，体积较大但离线可用）。
 */

$projectRoot = dirname(__DIR__);
$distDir = $projectRoot.'/dist';
$backendDir = $projectRoot.'/backend';
$packageDir = $projectRoot.'/baota-package';
$templateDir = __DIR__.'/baota';
$deployedManifestFile = $projectRoot.'/deploy/.deployed-manifest.json';

// ---------- 0) --mark-deployed：把部署基线推进到当前包（表示服务器已更新到此版本） ----------
if (in_array('--mark-deployed', $argv ?? [], true)) {
    if (!is_dir($packageDir) || !is_file($packageDir.'/public/index.php')) {
        fwrite(STDERR, "未找到部署包，请先不带参数运行一次 php deploy/build-baota-package.php\n");
        exit(1);
    }

    file_put_contents($deployedManifestFile, (string) json_encode(build_manifest($packageDir), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    $updateDir = $packageDir.'/update';
    remove_directory($updateDir);
    if (mkdir($updateDir, 0777, true)) {
        file_put_contents($updateDir.'/更新说明.txt', "基线已对齐当前版本（".date('Y-m-d H:i')."）。\n"
            ."服务器已更新到此包。下次项目更新后再生成部署包，update/ 将只包含需要替换的增量文件。\n");
    }

    echo "部署基线已对齐当前包。之后 update/ 只包含相对此版本的增量。\n";
    exit(0);
}

if (!is_file($distDir.'/index.html')) {
    fwrite(STDERR, "缺少 dist/index.html，请先在项目根目录执行 npm run build\n");
    exit(1);
}

// ---------- 0.1) 增量基线：服务器已部署版本的清单（永不自动推进） ----------
$previous = null;
$baseline = '未标记（无法确定服务器当前版本，本次 update/ 为全量文件）';
if (is_file($deployedManifestFile)) {
    $decoded = json_decode((string) file_get_contents($deployedManifestFile), true);
    if (is_array($decoded)) {
        $previous = $decoded;
        $baseline = '上次标记部署的版本（--mark-deployed）';
    }
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

// ---------- 8) 增量更新文件夹（update/：相对"已部署基线"需要替换的文件） ----------
$current = build_manifest($packageDir);

$updateDir = $packageDir.'/update';
remove_directory($updateDir);
if (!mkdir($updateDir, 0777, true)) {
    fwrite(STDERR, "无法创建目录：$updateDir\n");
    exit(1);
}

$added = $modified = [];
if ($previous === null) {
    // 无部署基线：全量（排除数据库、日志与 .env，避免覆盖服务器数据与配置）
    $added = array_keys($current);
    $deleted = [];
    $note = '尚未标记部署基线（无法确定服务器当前版本），update/ 内为全量文件。'
        ."\n覆盖到服务器后，请执行 php deploy/build-baota-package.php --mark-deployed 对齐基线，"
        ."之后 update/ 将只包含真正的增量。";
} else {
    foreach ($current as $relPath => $hash) {
        if (!array_key_exists($relPath, $previous)) {
            $added[] = $relPath;
        } elseif ($previous[$relPath] !== $hash) {
            $modified[] = $relPath;
        }
    }
    $deleted = array_keys(array_diff_key($previous, $current));
    $note = count($added) === 0 && count($modified) === 0 && count($deleted) === 0
        ? '服务器已与此版本一致，无需上传任何文件。'
        : '把 update/ 内的文件按相同相对路径覆盖到服务器站点目录即可（不含数据库与 .env，服务器数据与配置不受影响）。';
}

foreach (array_merge($added, $modified) as $relPath) {
    $target = $updateDir.'/'.$relPath;
    $parent = dirname($target);
    if (!is_dir($parent) && !mkdir($parent, 0777, true)) {
        fwrite(STDERR, "无法创建目录：$parent\n");
        exit(1);
    }
    copy($packageDir.'/'.$relPath, $target);
}

$instruction = "增量更新清单（生成时间 ".date('Y-m-d H:i')."，基线：{$baseline}）\n"
    .str_repeat('=', 40)."\n\n$note\n\n"
    ."需覆盖的文件（".count(array_merge($added, $modified))." 个）：\n";
foreach ($added as $relPath) {
    $instruction .= "  [新增] $relPath\n";
}
foreach ($modified as $relPath) {
    $instruction .= "  [修改] $relPath\n";
}
$instruction .= "\n需从服务器删除的文件（".count($deleted)." 个，旧版本残留）：\n";
$instruction .= count($deleted) === 0 ? "  （无）\n" : '';
foreach ($deleted as $relPath) {
    $instruction .= "  [-] $relPath\n";
}
$instruction .= "\n注意：\n"
    ."  1. update/ 不会包含 storage/short-url.sqlite3 与 .env（服务器数据与配置请勿被包内空库/默认值覆盖）；\n"
    ."  2. 上传完成后执行 php deploy/build-baota-package.php --mark-deployed 对齐基线；\n"
    ."  3. 上传完成后可访问 /check.php 验证；排障完成后请删除服务器上的 public/check.php。\n";
file_put_contents($updateDir.'/更新说明.txt', $instruction);

$changeCount = count(array_merge($added, $modified));
echo "增量更新：$changeCount 个文件需要替换（见 baota-package/update/）\n";
echo "部署包已生成：$packageDir\n";

/**
 * 计算包内文件清单（相对路径 => md5），排除数据库、日志、.env 与 update 自身。
 *
 * @return array<string, string>
 */
function build_manifest(string $dir): array
{
    $manifest = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY,
    );
    foreach ($iterator as $item) {
        if (!$item->isFile()) {
            continue;
        }

        $relPath = str_replace('\\', '/', substr($item->getPathname(), strlen($dir) + 1));
        if (
            str_starts_with($relPath, 'storage/short-url.sqlite3')
            || str_starts_with($relPath, 'storage/logs/')
            || str_starts_with($relPath, 'update/')
            || $relPath === '.env'
        ) {
            continue;
        }

        $manifest[$relPath] = md5_file($item->getPathname());
    }

    ksort($manifest);

    return $manifest;
}

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
