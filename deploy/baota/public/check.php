<?php

declare(strict_types=1);

/**
 * 宝塔部署包 · 环境自检（public/check.php，访问 /check.php?token=xxxx）
 *
 * 安全检查（防止把部署细节暴露给公网）：
 *   - 必须携带访问令牌：令牌由打包脚本随机生成，存放于包根 .check-token（Web 根之外），
 *     通过 hash_equals 常量时间比较；未生成令牌文件时本页直接拒绝运行；
 *   - 页面不显示任何文件路径、数据库路径或配置值，只显示通过/失败与修复提示；
 *   - 全链路实测与数据写入必须显式带 run=1，且写入的探针短链在本次请求内清理干净。
 *
 * 检查内容：
 *   A. 服务器端：PHP 版本、扩展（pdo_sqlite/mbstring/json）、storage 可写、数据库可打开；
 *   B. 路由转发（伪静态）：POST /url 是否能到达 PHP（用非法参数探测，不写数据）；
 *   C. 后端全链路内部实测（仅 run=1）：创建短链 → 跳转 → 清理。
 *
 * 排障完成后请删除本文件。
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');

$baseDir = dirname(__DIR__);
$tokenFile = $baseDir.'/.check-token';

// ---------- 0. 访问令牌校验 ----------
$expected = is_file($tokenFile) ? trim((string) file_get_contents($tokenFile)) : '';
$provided = isset($_GET['token']) && is_string($_GET['token']) ? trim($_GET['token']) : '';

if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden\n\n";
    echo "本页需要在 URL 上携带访问令牌：/check.php?token=<令牌>\n";
    echo $expected === ''
        ? "令牌文件 .check-token 不存在：请重新执行 php deploy/build-baota-package.php 生成部署包。\n"
        : "令牌已生成，见部署包根目录 .check-token（或运行部署脚本后的输出）。\n";
    exit;
}

$runFullChain = isset($_GET['run']) && $_GET['run'] === '1';

$checks = [];

$add = function (string $name, string $value, bool $ok, string $hint) use (&$checks): void {
    $checks[] = ['name' => $name, 'value' => $value, 'ok' => $ok, 'hint' => $hint];
};

$add('PHP 版本', PHP_VERSION, version_compare(PHP_VERSION, '8.2.0', '>='), '需要 PHP 8.2+：宝塔 → 网站 → 设置 → PHP 版本（本应用使用了 8.1+ 语法，8.0 及以下会直接 500）');

$drivers = class_exists(PDO::class) ? PDO::getAvailableDrivers() : [];
$pdoOk = in_array('sqlite', $drivers, true);
$add('pdo_sqlite 扩展', $pdoOk ? '已加载' : '未加载', $pdoOk, '宝塔 → 软件商店 → PHP 设置 → 安装扩展 pdo_sqlite');

$mbOk = extension_loaded('mbstring');
$add('mbstring 扩展', $mbOk ? '已加载' : '未加载', $mbOk, '宝塔 → 软件商店 → PHP 设置 → 安装扩展 mbstring（缺失时创建短链会 500）');

$jsonOk = extension_loaded('json');
$add('json 扩展', $jsonOk ? '已加载' : '未加载', $jsonOk, '宝塔 → 软件商店 → PHP 设置 → 安装扩展 json');

$envOk = is_file($baseDir.'/.env');
$add('.env 配置文件', $envOk ? '存在' : '缺失', $envOk, '重新上传部署包，或按 部署说明.md 手工创建');

$autoloadOk = is_file($baseDir.'/vendor/autoload.php');
$add('后端依赖（vendor/）', $autoloadOk ? '存在' : '缺失', $autoloadOk, 'vendor/ 未上传完整，请重新解压部署包');

$storageDir = $baseDir.'/storage';
$storageOk = false;
$storageHint = '宝塔文件管理中把 storage 目录及子项权限设为 775，属主 www（防跨站攻击 open_basedir 也会导致此项失败）';
if (is_dir($storageDir)) {
    $probe = $storageDir.'/check-'.uniqid('', true).'.tmp';
    $storageOk = @file_put_contents($probe, 'ok') !== false;
    if ($storageOk) {
        @unlink($probe);
    }
} else {
    $storageOk = @mkdir($storageDir, 0777, true);
    $storageHint = 'storage 目录缺失且无法创建，请重新上传部署包';
}
$add('storage/ 可写（SQLite 与日志）', $storageOk ? '可写' : '不可写', $storageOk, $storageHint);

$dbMessage = '未检测';
$dbOk = false;
$database = null;
if ($autoloadOk && $envOk && $storageOk) {
    try {
        require $baseDir.'/vendor/autoload.php';
        App\Support\Env::load($baseDir.'/.env');
        $config = new App\Support\Config(require $baseDir.'/config/config.php');
        $database = new App\Services\DatabaseService($config);
        $database->execute(static function (PDO $pdo): void {
            $pdo->query('SELECT 1');
        });
        $dbOk = true;
        $dbMessage = '连接正常';
    } catch (\Throwable $exception) {
        // 只回显异常类型，不回显路径等细节
        $dbMessage = '失败：'.$exception::class;
    }
} else {
    $dbMessage = '因前置检查未通过而跳过';
}
$add('SQLite 数据库', $dbMessage, $dbOk, '确认 .env 的 DATABASE_PATH 指向可写目录，且 storage/ 权限正确');

// ---------- C. 后端全链路内部实测（仅 run=1，且写入后立即清理） ----------
$internalMessage = $runFullChain ? '未检测（前置检查未通过）' : '未执行（加 &run=1 可运行，会写入并清理一条探针短链）';
$internalOk = false;
if ($runFullChain && $autoloadOk && $envOk) {
    try {
        require $baseDir.'/vendor/autoload.php';
        App\Support\Env::load($baseDir.'/.env');
        $configArray = require $baseDir.'/config/config.php';
        // 仅在自检内部临时开启 debug，使真实错误信息可见；正式请求不受影响
        $configArray['app']['debug'] = true;
        $app = App\Foundation\App::create(new App\Support\Config($configArray));

        $probeUrl = 'https://check.example.com/probe-'.bin2hex(random_bytes(4));
        // 与浏览器同源：带上 Host 与同源 Origin，否则会被 CSRF 来源校验拒绝
        $headers = ['host' => (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'), 'origin' => 'http://'.(string) ($_SERVER['HTTP_HOST'] ?? 'localhost')];
        $created = $app->handle(new App\Http\Request('POST', '/url', (string) json_encode(['url' => $probeUrl]), [], $headers));
        $payload = $created->decodedJson();
        $code = is_array($payload) ? (string) ($payload['code'] ?? '') : '';

        if ($created->status() !== 200 || $code === '') {
            $internalMessage = '创建失败：HTTP '.$created->status().' '
                .substr((string) json_encode($payload, JSON_UNESCAPED_UNICODE), 0, 300);
        } else {
            $redirect = $app->handle(new App\Http\Request('GET', '/'.$code, ''));
            // 探针数据不进业务库：本次请求内删掉（连同点击记录）
            if ($database !== null) {
                $database->execute(static function (PDO $pdo) use ($code): void {
                    $delete = $pdo->prepare('DELETE FROM short_urls WHERE code = :code');
                    $delete->execute([':code' => $code]);
                    $clicks = $pdo->prepare('DELETE FROM short_url_clicks WHERE code = :code');
                    $clicks->execute([':code' => $code]);
                });
            }
            if ($redirect->status() === 302) {
                $internalOk = true;
                $internalMessage = '创建 + 跳转全链路正常（探针短链已清理，未残留数据）';
            } else {
                $internalMessage = '跳转失败：HTTP '.$redirect->status().'（探针短链已清理）';
            }
        }
    } catch (\Throwable $exception) {
        $internalMessage = '真实异常：'.$exception::class.' '.$exception->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>short-url 环境自检</title>
<style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; color: #1f2328; }
    h1 { font-size: 22px; } h2 { font-size: 17px; margin-top: 28px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    td, th { border: 1px solid #d8dee4; padding: 6px 10px; text-align: left; }
    .ok { color: #1a7f37; font-weight: 600; } .bad { color: #cf222e; font-weight: 600; }
    .hint { color: #57606a; font-size: 12px; }
    .card { border: 1px solid #d8dee4; border-radius: 8px; padding: 12px 16px; margin: 10px 0; font-size: 14px; word-break: break-all; }
    .pass { border-color: #1a7f37; background: #dafbe1; }
    .fail { border-color: #cf222e; background: #ffebe9; }
    code { background: #f6f8fa; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<h1>short-url 环境自检</h1>
<p class="hint">本页含部署环境信息，已启用令牌访问。排障完成后请删除 <code>public/check.php</code>，并撤销令牌文件。</p>

<h2>A. 服务器环境</h2>
<table>
    <tr><th>检查项</th><th>结果</th><th>状态</th><th>修复提示</th></tr>
    <?php foreach ($checks as $check): ?>
    <tr>
        <td><?= htmlspecialchars($check['name']) ?></td>
        <td><?= htmlspecialchars($check['value']) ?></td>
        <td class="<?= $check['ok'] ? 'ok' : 'bad' ?>"><?= $check['ok'] ? '通过' : '失败' ?></td>
        <td class="hint"><?= $check['ok'] ? '-' : htmlspecialchars($check['hint']) ?></td>
    </tr>
    <?php endforeach; ?>
</table>

<h2>C. 后端全链路内部实测</h2>
<div class="card <?= $internalOk ? 'pass' : 'fail' ?>">
    <span class="<?= $internalOk ? 'ok' : 'bad' ?>"><?= $internalOk ? '通过' : '未通过' ?></span>：
    <?= htmlspecialchars($internalMessage) ?>
</div>
<p class="hint">此项在服务器内部直接执行"创建短链 → 跳转"完整链路，不经过 Nginx；失败时会显示真实异常。
探针短链会在本次请求内自动删除。真实请求仍返回 500 而这里通过时，请查看 <code>storage/logs/error.log</code>。

<h2>B. 路由转发（伪静态）实测</h2>
<div id="route-result" class="card">检测中…</div>
<p class="hint">说明：本页是真实的 .php 文件，能打开即代表 PHP 已启用；但短码 <code>GET /{code}</code> 与
创建接口 <code>POST /url</code> 需要伪静态把请求转发给 <code>public/index.php</code>。实测不通过时请：
宝塔 → 网站 → 设置 → 伪静态 → 粘贴部署包内 <code>nginx-rewrite.conf</code> 全部内容 → 保存。
（Apache 环境检查 <code>.htaccess</code> 是否位于 public/ 目录内。）</p>

<script>
// 仅探测路由连通性，不写入任何数据
async function checkRoute() {
    const box = document.getElementById('route-result');
    const items = [];

    try {
        const post = await fetch('/url', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: 'route-check-probe'}),
        });
        const postText = await post.text();
        const postOk = post.status === 400 && postText.includes('Incorrect URL format');
        items.push({name: 'POST /url（创建接口连通性）', ok: postOk, detail: post.status + ' ' + postText.slice(0, 60)});
    } catch (e) {
        items.push({name: 'POST /url（创建接口连通性）', ok: false, detail: String(e)});
    }

    try {
        const probe = await fetch('/route-check-' + Math.random().toString(36).slice(2));
        const probeText = await probe.text();
        const probeOk = probe.status === 404 && probeText.includes('Unknown URL');
        items.push({name: 'GET /随机路径（辅助探测）', ok: probeOk,
            detail: probe.status + ' ' + (probeText.includes('Unknown URL') ? 'JSON 404（已到 PHP）' : 'HTML 404（Web 服务器/防火墙拦截）')});
    } catch (e) {
        items.push({name: 'GET /随机路径（辅助探测）', ok: false, detail: String(e)});
    }

    const allOk = items.every(function (i) { return i.ok; });
    box.className = 'card ' + (allOk ? 'pass' : 'fail');

    let html = allOk
        ? '<strong class="ok">路由转发正常</strong>。'
        : '<strong class="bad">未通过</strong>：';
    html += '<ul style="margin:8px 0 0 18px;padding:0">';
    items.forEach(function (i) {
        html += '<li>' + i.name + '：<span class="' + (i.ok ? 'ok' : 'bad') + '">' + (i.ok ? '通过' : '未通过') + '</span>'
            + ' <span class="hint">（' + String(i.detail).replace(/</g, '&lt;') + '）</span></li>';
    });
    html += '</ul>';
    if (!allOk) {
        html += '<p style="margin:8px 0 0">修复：宝塔 → 网站 → 设置 → 伪静态 → 粘贴 <code>nginx-rewrite.conf</code> 内容并保存；'
            + '随机路径探测被防火墙/防扫描规则拦截通常不影响真实短链。</p>';
    }
    box.innerHTML = html;
}
checkRoute();
</script>
</body>
</html>
