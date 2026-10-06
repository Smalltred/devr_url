<?php

declare(strict_types=1);

/**
 * 极简 memcached 文本协议服务端（仅供本地验证 MemcachedStore 真实链路）。
 * 支持 get / set / delete / stats / version 命令，单进程串行处理。
 * 用法：php storage/mock-memcached.php [port]
 */

$port = (int) ($argv[1] ?? 11211);
$server = stream_socket_server("tcp://127.0.0.1:$port", $errno, $errstr);
if ($server === false) {
    fwrite(STDERR, "listen failed: $errstr\n");
    exit(1);
}
fwrite(STDOUT, "mock memcached listening on 127.0.0.1:$port\n");

/** @var array<string, array{value: string, flags: int, expires: int}> $store */
$store = [];
$hits = 0;
$misses = 0;

/**
 * 精确读取 $length 字节（TCP 分包时一次 fread 可能读不满）。
 */
function readExact($conn, int $length): string
{
    $data = '';
    while (strlen($data) < $length) {
        $chunk = fread($conn, $length - strlen($data));
        if ($chunk === false || $chunk === '') {
            break;
        }
        $data .= $chunk;
    }

    return $data;
}

/**
 * 把 memcached 的 exptime 换算成绝对过期时间戳。
 * 协议规定：≤ 30 天（2592000 秒）视为相对秒数，> 30 天视为绝对 Unix 时间戳，0 表示永不过期。
 */
function expiresAt(int $expires): int
{
    if ($expires === 0) {
        return 0;
    }
    if ($expires > 2592000) {
        return $expires;
    }

    return time() + $expires;
}

while (true) {
    $conn = @stream_socket_accept($server, -1);
    if ($conn === false) {
        continue;
    }

    while (($line = fgets($conn)) !== false) {
        $line = rtrim($line, "\r\n");
        if ($line === '') {
            continue;
        }

        $parts = explode(' ', $line);
        $command = strtolower($parts[0]);

        if ($command === 'get') {
            $key = $parts[1] ?? '';
            if (isset($store[$key]) && ($store[$key]['expires'] === 0 || $store[$key]['expires'] > time())) {
                $hits++;
                $entry = $store[$key];
                fwrite($conn, sprintf(
                    "VALUE %s %d %d\r\n%s\r\nEND\r\n",
                    $key,
                    $entry['flags'],
                    strlen($entry['value']),
                    $entry['value'],
                ));
            } else {
                $misses++;
                unset($store[$key]);
                fwrite($conn, "END\r\n");
            }
            continue;
        }

        // set <key> <flags> <exptime> <bytes> [noreply]
        if ($command === 'set') {
            $key = $parts[1] ?? '';
            $flags = (int) ($parts[2] ?? 0);
            $expires = (int) ($parts[3] ?? 0);
            $bytes = (int) ($parts[4] ?? 0);
            $value = $bytes > 0 ? readExact($conn, $bytes) : '';
            readExact($conn, 2); // 数据块后的 CRLF
            $store[$key] = ['value' => $value, 'flags' => $flags, 'expires' => expiresAt($expires)];
            if (($parts[5] ?? '') !== 'noreply') {
                fwrite($conn, "STORED\r\n");
            }
            continue;
        }

        // add / replace 等同 set 处理（验证场景够用）
        if ($command === 'add' || $command === 'replace') {
            $key = $parts[1] ?? '';
            $exptime = (int) ($parts[3] ?? 0);
            $bytes = (int) ($parts[4] ?? 0);
            $exists = isset($store[$key]);
            if (($command === 'add' && $exists) || ($command === 'replace' && !$exists)) {
                $value = $bytes > 0 ? readExact($conn, $bytes) : '';
                readExact($conn, 2);
                fwrite($conn, "NOT_STORED\r\n");
                continue;
            }
            $value = $bytes > 0 ? readExact($conn, $bytes) : '';
            readExact($conn, 2);
            $store[$key] = ['value' => $value, 'flags' => (int) ($parts[2] ?? 0), 'expires' => expiresAt($exptime)];
            fwrite($conn, "STORED\r\n");
            continue;
        }

        if ($command === 'delete') {
            unset($store[$parts[1] ?? '']);
            fwrite($conn, "DELETED\r\n");
            continue;
        }

        if ($command === 'stats') {
            fwrite($conn, sprintf("STAT get_hits %d\r\n", $hits));
            fwrite($conn, sprintf("STAT get_misses %d\r\n", $misses));
            fwrite($conn, sprintf("STAT curr_items %d\r\n", count($store)));
            fwrite($conn, "END\r\n");
            continue;
        }

        if (in_array($command, ['version', 'verbosity', 'quit'], true)) {
            if ($command === 'quit') {
                break;
            }
            fwrite($conn, "VERSION 1.6.0-mock\r\n");
            continue;
        }

        fwrite($conn, "ERROR\r\n");
    }

    fclose($conn);
}
