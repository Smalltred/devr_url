# devr（Short URL · PHP 8.2 版）

将长链接转为短链接的小工具，完全开源、免费，可私有化部署，短链接可永久有效。

体验地址 👉 [devr —— 简单易用的短链接生成工具，链接永久有效！](https://3ii.cc)

> 本仓库已完成 **Node.js/Express → PHP 8.2** 后端迁移重构，并将存储层从 **Redis 迁移到 SQLite**：
> - 短码算法、API 行为与原版**完全兼容**；SQLite 单文件永久化，无需独立的数据库服务；
> - 前端已用 Vue 3 + Vite 重写，视觉与交互与原版保持一致；
> - 迁移说明见 [docs/MIGRATION.md](docs/MIGRATION.md)（Node.js → PHP）与 [docs/SQLITE_MIGRATION.md](docs/SQLITE_MIGRATION.md)（Redis → SQLite）。

![Demo](https://cdn.jsdelivr.net/gh/onee-io/short-url/docs/demo1.gif)

## 架构

```text
Vue 3 前端（src/，Vite 构建）
    ↓ HTTP
Nginx（静态资源 /，其余转发）
    ↓ FastCGI
PHP 8.2 API（backend/，Controller → Service → Repository）
    ↓ PDO
SQLite（backend/storage/short-url.sqlite3，单文件永久化）
```

## 环境依赖

- PHP 8.2+（扩展：pdo_sqlite、json、mbstring）
- Composer 2.x
- NodeJS 20+（仅构建前端用，Vite 6 要求）

## 快速开始（本地开发）

```bash
# 1. 前端依赖
npm install

# 2. PHP 后端依赖
cd backend && composer install

# 3. 配置环境变量：复制 .env.example 为 .env（SQLite 默认路径即可直接使用）

# 4. 启动 PHP 后端（端口 3001）
composer serve        # 等价于 php -S 0.0.0.0:3001 -t public public/index.php

# 5. 启动 Vue 前端开发服务（端口 3000，API 经 Vite proxy 转发到 3001）
npm run dev
```

访问 <http://localhost:3000> 即可使用；直接调用 API 见 [docs/API.md](docs/API.md)。

## 管理后台

访问 `/admin` 进入管理面板（首页页脚也有入口），支持：

- **登录**：单管理员账号，凭据由环境变量配置；登录态为 HttpOnly + SameSite=Strict Cookie，有效期默认 7 天；
- **统计**：全站概览（短链总数/累计/今日点击）、近 14 天趋势、点击 Top 10；单链维度含独立访客、来源域名 Top 10、设备分布（统计按 UTC 日切分）；
- **编辑**：修改目标链接与短码（改短码后旧码立即失效，点击统计自动迁移）；
- **删除**：删除短链并级联清除点击记录。

默认账号 `admin` / `admin123`，**生产环境务必修改**（推荐直接在后台「设置」页修改，或设置 `ADMIN_PASSWORD_HASH`）。

### 设置页

「设置」选项卡提供四项运行时配置（即时生效，存于 SQLite，无需改环境变量重启）：

- **短链最小长度**（1-16）：新短码不足该长度时自动补齐，已有短链不受影响；
- **随机短码**：开启后新短码随机生成、不可预测（要求长度 ≥ 3，落库前查重）；
- **创建短链需要登录**：开启后首页仅管理员可生成短链，未登录访问首页将跳转登录页；
- **修改密码**：校验当前密码后更新，哈希优先于环境变量配置，并**撤销全部登录态**（所有端强制重新登录）。

关闭后台自定义密码（恢复环境变量密码）目前需清空数据库 `settings` 表的 `admin_password_hash` 键。

```bash
# 生成密码哈希（用于 ADMIN_PASSWORD_HASH）
php -r "echo password_hash('你的密码', PASSWORD_DEFAULT);"
```

```bash
# Docker Compose 部署时在 backend 同级 .env 或 docker-compose.yml 中注入：
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2y$10$...
```

## 质量工具（backend/ 目录内执行）

```bash
composer test      # PHPUnit：单元 + Feature（含 SQLite 仓库集成测试）
composer analyse   # PHPStan level 8 静态分析
composer lint      # PHP-CS-Fixer 代码风格检查（lint:fix 自动修复）
```

## 部署

### 方式一：Docker Compose（nginx + php-fpm，推荐）

```bash
docker compose up -d --build
# 访问 http://localhost:3001
```

SQLite 数据文件通过命名卷 `app-data` 持久化（挂载到容器内 `/app/backend/storage`）。

### 方式二：单容器（单机）

```bash
docker build -t short-url .        # 默认 target：nginx + php-fpm 单容器
docker run -d -p 3001:80 short-url
```

注意：单容器未挂载卷时，重建容器会丢失 SQLite 数据；持久化部署请为 `/app/backend/storage` 挂载卷。

### 方式三：宝塔面板 / 裸机 Nginx + PHP-FPM

前端先构建：项目根目录执行 `npm run build`（生成 dist 目录，不要删除）。

Nginx 站点配置与逐项说明见 **[docs/BAOTA_DEPLOY.md](docs/BAOTA_DEPLOY.md)**，参考配置文件为 [deploy/nginx/short-url.conf](deploy/nginx/short-url.conf)。

要点：

- 网站根目录指向 `dist/`；
- PHP 版本 8.2，需启用 pdo_sqlite、mbstring、fileinfo 扩展；
- 伪静态/回退规则：非静态资源一律转发到 `backend/public/index.php`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| DATABASE_PATH | backend/storage/short-url.sqlite3 | SQLite 数据库文件路径 |
| APP_ENV | production | 运行环境 |
| APP_DEBUG | false | 调试模式，生产必须 false |
| APP_URL | 空 | 站点对外地址；为 https 时登录 Cookie 附带 Secure |
| APP_PORT | 3001 | 本地开发服务器端口 |
| ADMIN_USERNAME | admin | 管理后台用户名 |
| ADMIN_PASSWORD | admin123 | 管理后台密码（生产务必修改） |
| ADMIN_PASSWORD_HASH | 空 | 密码哈希，设置后优先于 ADMIN_PASSWORD |
| ADMIN_TOKEN_TTL_DAYS | 7 | 登录态有效期（天） |
| VITE_API_BASE_URL | 空 | 前端 API 地址，留空为同源 |

## 目录结构

```text
short-url/
├── backend/               # PHP 8.2 后端
│   ├── app/               # Controller / Service / Repository / Http / Validation
│   ├── config/            # 唯一读取环境变量的地方
│   ├── public/index.php   # 前端控制器
│   ├── routes/web.php     # 公开接口 + /api/auth/*、/api/admin/*、GET /admin、GET /{code}
│   ├── storage/           # SQLite 数据库（short-url.sqlite3）与 app.log / error.log
│   └── tests/             # PHPUnit（Unit / Feature）
├── src/ public/           # Vue 3 前端（Vite）
├── deploy/                # Nginx 配置与 supervisord
├── docs/                  # API / 迁移 / 宝塔部署文档
├── Dockerfile             # 多阶段构建（默认：nginx+php-fpm 单容器）
└── docker-compose.yml     # 双容器部署（web + app）
```

## License

MIT（见 [License](License)）
