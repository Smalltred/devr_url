# 宝塔面板部署文档（Nginx + PHP 8.2 + PHP-FPM + SQLite）

> **快捷方式**：不想从源码折腾，可直接使用开箱即用部署包 **`baota-package/`**（项目根目录，
> 已含编译好的前后端与生产配置，标准 PHP 结构：`public/` 为 Web 运行目录）。
> 步骤：上传到站点目录 → 运行目录选 `/public` → PHP 8.2+（pdo_sqlite）→ Nginx 粘贴一次伪静态
> （Apache 零配置）。生成/更新方式：`npm run build` 后执行 `php deploy/build-baota-package.php`，
> 详细步骤与自检页（`/check.php`）说明见包内 `部署说明.md`。本文其余部分描述"从仓库源码部署"的完整流程。

目标：把 short-url 部署到宝塔面板的 `/www/wwwroot/short-url`，短码路由 `/xxxxx` 正确交给 PHP，静态资源正常访问。

## 1. 环境准备（宝塔软件商店）

| 组件 | 要求 |
| --- | --- |
| Nginx | 任意近期版本（1.20+） |
| PHP | **8.2**（多版本共存时，站点需单独选中 8.2） |
| SQLite | PHP 内置 pdo_sqlite 驱动，无需单独安装数据库服务 |

PHP 8.2 扩展（宝塔 → 软件商店 → PHP 8.2 → 设置 → 安装扩展）：

- `pdo_sqlite`（必须，宝塔官方包一般默认内置）
- `fileinfo`（必须，一般默认已装）
- `mbstring`、`json`（必须，官方包默认内置，确认未被卸载）

检查：宝塔 → PHP 8.2 → phpinfo，搜索 `pdo_sqlite` 确认驱动已加载。

## 2. 上传代码

```bash
cd /www/wwwroot
git clone https://github.com/<你的仓库>/short-url.git
cd short-url
```

## 3. 安装依赖与构建

```bash
# 前端构建（生成 dist 目录，不要删除）
npm install
npm run build

# PHP 后端依赖
cd backend
composer install --no-dev --optimize-autoloader
```

> 宝塔终端如无 composer：`curl -sS https://getcomposer.org/installer | php82`，
> 然后用 `php82 composer.phar install` 代替。

## 4. 环境变量

```bash
cd /www/wwwroot/short-url
cp .env.example .env
vi .env
```

```text
APP_ENV=production
APP_DEBUG=false
# 留空使用默认路径 backend/storage/short-url.sqlite3
DATABASE_PATH=
```

权限：PHP-FPM 运行用户（宝塔默认 www）需要可写 `backend/storage/`（SQLite 数据库与日志都在这里）：

```bash
chown -R www:www /www/wwwroot/short-url/backend/storage
chmod -R 775 /www/wwwroot/short-url/backend/storage
```

`.env` 已在 `.gitignore` 中，不要提交。

## 5. 宝塔站点设置

宝塔 → 网站 → 添加站点：

- 域名：你的域名
- 根目录：`/www/wwwroot/short-url/dist`   ← 注意是 dist，不是 short-url
- PHP 版本：8.2
- 不创建数据库

### 5.1 运行目录

站点设置 → 网站目录：运行目录无需修改（根目录已是 build）。

### 5.2 伪静态（关键）

站点设置 → 伪静态，粘贴以下内容（等价于 [deploy/nginx/short-url.conf](../deploy/nginx/short-url.conf) 的三段 location）：

```nginx
location ~* \.(?:js|css|png|jpe?g|gif|ico|svg|woff2?|ttf|map|json|txt|html)$ {
    try_files $uri =404;
    expires 30d;
    access_log off;
}

location / {
    try_files $uri $uri/ @backend;
}

location @backend {
    fastcgi_pass unix:/tmp/php-cgi-82.sock;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /www/wwwroot/short-url/backend/public/index.php;
    fastcgi_param HTTPS $https if_not_empty;
}
```

说明：

- 静态资源（js/css/图片等）命中第一条规则直接返回，**不会被当成短码**；
- 其余路径（`POST /url`、`POST /api/url`、`GET /{code}`）经 `@backend` 交给 PHP；
- 宝塔 PHP 8.2 默认 unix socket 为 `/tmp/php-cgi-82.sock`；若你的环境是 TCP 方式，
  改为 `fastcgi_pass 127.0.0.1:9000;`（可在宝塔 PHP 8.2 → 设置 → 性能调整 中确认）。

### 5.3 配置文件方式（可选）

若在站点「配置文件」中整体管理，把 root/index 与三个 location 合入宝塔生成的 server 段，
**不要删除**宝塔自动生成的 404、SSL、日志等段落。

## 6. SQLite 数据

- 数据库文件默认为 `backend/storage/short-url.sqlite3`，随请求自动创建（含 WAL 文件 `-wal`/`-shm`）；
- 备份：直接拷贝该文件即可（建议先停 PHP 或使用 `sqlite3 ... ".backup"` 保证一致性）；
- 移动存储位置：修改 `.env` 的 `DATABASE_PATH` 并把数据库文件移动到新路径。

## 7. 验证

```bash
# 创建短链
curl -s -X POST https://你的域名/url \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://github.com/onee-io/short-url"}'
# {"url":"https://github.com/onee-io/short-url","code":"SB"}

# 跳转
curl -sI https://你的域名/SB | head -2
# HTTP/2 302
# location: https://github.com/onee-io/short-url

# 静态页面
curl -sI https://你的域名/ | head -1
# HTTP/2 200
```

浏览器打开首页，输入链接生成短链、复制、下载二维码（二维码由前端生成）。

## 8. 常见问题

| 现象 | 排查 |
| --- | --- |
| 502 Bad Gateway | PHP 8.2 未启动；或 socket 路径不对（`ls /tmp/php-cgi-*.sock`） |
| 短码返回 404 但数据库里有数据 | SCRIPT_FILENAME 路径错误，确认 `/www/wwwroot/short-url/backend/public/index.php` 存在；或 `DATABASE_PATH` 与数据实际位置不一致 |
| `{"error":"Service Unavailable"}` | SQLite 打不开：检查 `DATABASE_PATH` 目录是否存在且对 www 可写（`chown -R www:www backend/storage`） |
| 创建返回 400 | URL 必须以 http(s):// 开头且无空白字符 |
| 日志无内容/报权限错 | `chown -R www:www backend/storage`；日志在 `backend/storage/logs/app.log`、`error.log` |
| 页面白屏/资源 404 | 根目录未指向 `dist/`，或未执行 `npm run build` |

## 9. 安全清单

- [ ] `APP_DEBUG=false`（生产必须）
- [ ] `.env` 权限 640，属主 root:www，不进 Git
- [ ] `backend/storage/`（含 SQLite 数据库）不在站点根内，不会被公网下载
- [ ] 建议开启 HTTPS（宝塔 SSL，强制 HTTPS）
