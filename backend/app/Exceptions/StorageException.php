<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * 存储层（SQLite）连接/操作失败：HTTP 503。
 */
final class StorageException extends \RuntimeException
{
}
