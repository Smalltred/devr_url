# Redis → SQLite 迁移说明

本文记录 short-url 后端存储层从 Redis 迁移到 SQLite 的完整变更清单。短码算法、API 行为、
响应结构与 Redis 版完全一致，前端无需任何改动。

## 1. 迁移总览

| 原始（Redis） | 现状（SQLite） |
| --- | --- |
| `RedisService`（phpredis 扩展，pconnect 长连接） | `DatabaseService`（PDO SQLite，WAL 模式，惰性连接） |
| `RedisUrlRepository`（INCR / HSET / HGET / HEXISTS） | `SqliteUrlRepository`（事务自增 / INSERT / SELECT） |
| `short-url:code` 计数器、`short-url:map` 哈希 | `short_url_counter` 表、`short_urls` 表 |
| 需要独立 Redis 服务（本机/Docker/外部） | 单文件 `backend/storage/short-url.sqlite3`，零外部依赖 |
| `RedisConnectionException` → 503 | `StorageException` → 503 |

## 2. 数据模型

存储迁移时的核心表（与 Redis 两个 key 对应）：

```sql
CREATE TABLE short_urls (
    code       TEXT PRIMARY KEY,          -- 短码（与 Redis map 的 field 等价）
    url        TEXT NOT NULL,             -- 原链接
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE short_url_counter (
    id INTEGER NOT NULL                 -- 单行计数器（与 short-url:code 等价）
);
```

当前版本（v0.3.0，随管理后台功能）的完整表结构，首次连接时自动建库建表：

| 表 | 用途 |
| --- | --- |
| `short_urls` | 短码 → 原链接 |
| `short_url_counter` | 单行自增计数器（短码 ID 源） |
| `short_url_clicks` | 点击记录（时间、referer、referer_host、device、ip_hash），带 code+time 与 time 两个索引 |
| `auth_tokens` | 管理端登录态（token 的 sha256 哈希、创建/过期时间戳） |
| `auth_throttle` | 登录失败限流（IP 匿名哈希 → 失败次数、窗口起点） |
| `settings` | 运行时设置（短码最小长度、随机码、require_login、自定义密码哈希） |
| `app_meta` | 内部元数据（IP 哈希的安装级随机盐等） |

短码仍由 ID 经 `ShortCodeService::encode()` 生成，字符表与算法不变，`encode(1) = 'S'` 等向量不变。

## 3. 关键实现点

- **原子自增**：`nextId()` 在 `BEGIN IMMEDIATE` 事务内完成「读计数 → +1 → 写回」，
  多进程（PHP-FPM）下不会产生重复短码；WAL 模式 + `busy_timeout = 2500ms` 保证读写并发；
- **建库建表**：首次连接时自动 `CREATE TABLE IF NOT EXISTS` 并初始化计数器为 0，
  首个自增值为 1，与 Redis 版 `INCR` 语义一致；
- **目录自动创建**：`DATABASE_PATH` 的父目录不存在时自动创建；
- **异常语义**：所有 PDO 异常统一转译为 `App\Exceptions\StorageException`，HTTP 层仍返回
  503 `Service Unavailable`，与原 Redis 连接失败行为一致。

## 4. 环境变量变更

| Redis 版 | SQLite 版 | 说明 |
| --- | --- | --- |
| REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD / REDIS_DATABASE | （删除） | 不再需要 |
| （无） | DATABASE_PATH | SQLite 文件路径，默认 `backend/storage/short-url.sqlite3` |

## 5. 部署形态变化

- **Docker Compose**：由三容器（nginx + php-fpm + redis）简化为双容器（nginx + php-fpm），
  命名卷 `app-data` 挂载到 `/app/backend/storage` 持久化数据库；
- **Dockerfile**：php-fpm 镜像改为 `docker-php-ext-install pdo_sqlite`（不再 pecl 安装 redis）；
- **宝塔部署**：不再需要安装/维护 Redis 服务，确认 PHP 8.2 已启用 `pdo_sqlite` 即可。

## 6. 数据迁移（Redis → SQLite）

若仍在使用旧 Redis 版且有存量短链，可用一次性脚本把 `short-url:map` 哈希逐条写入
`short_urls` 表，并把 `short-url:code` 的值写入 `short_url_counter`。本项目未随附该脚本
（Redis 版数据如为空可直接启用 SQLite 版）。

## 7. 回滚方案

Git 回滚到上一版本即可恢复 Redis 存储；两套实现的 `UrlRepository` 契约一致，
`Tests\Doubles\InMemoryUrlRepository` 与全部 Feature 测试在两个版本下均可运行。
