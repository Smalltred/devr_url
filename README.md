# Short URL（PHP 8.2 版）

将长链接转为短链接的小工具，完全开源、免费、无需登录，可私有化部署，短链接可永久有效。

体验地址 👉 [缩啦 —— 简单易用的短链接生成工具，链接永久有效！](https://3ii.cc)

> 本仓库已完成 **Node.js/Express → PHP 8.2** 后端迁移重构，并将存储层从 **Redis 迁移到 SQLite**：
> - 短码算法、API 行为与原版**完全兼容**；SQLite 单文件永久化，无需独立的数据库服务；
> - 前端 React 代码保持不变，仅 API 地址改为可配置；
> - 迁移说明见 [docs/MIGRATION.md](docs/MIGRATION.md)（Node.js → PHP）与 [docs/SQLITE_MIGRATION.md](docs/SQLITE_MIGRATION.md)（Redis → SQLite）。

![Demo](https://cdn.jsdelivr.net/gh/onee-io/short-url/docs/demo1.gif)

## 架构

```text
React 18 前端（src/）
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
- NodeJS 16+（仅构建前端用）

## 快速开始（本地开发）

```bash
# 1. 前端依赖
npm install

# 2. PHP 后端依赖
cd backend && composer install

# 3. 配置环境变量：复制 .env.example 为 .env（SQLite 默认路径即可直接使用）

# 4. 启动 PHP 后端（端口 3001）
composer serve        # 等价于 php -S 0.0.0.0:3001 -t public public/index.php

# 5. 启动 React 前端开发服务（端口 3000，API 经 proxy 转发到 3001）
npm start
```

访问 <http://localhost:3000> 即可使用；直接调用 API 见 [docs/API.md](docs/API.md)。

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

### 方式二：单容器（fly.io / 单机）

```bash
docker build -t short-url .        # 默认 target：nginx + php-fpm 单容器
docker run -d -p 3001:80 short-url
```

注意：单容器未挂载卷时，重建容器会丢失 SQLite 数据；持久化部署请为 `/app/backend/storage` 挂载卷。

push 到 master 后 GitHub Actions 会自动部署到 fly.io（见 `.github/workflows/fly.yml`）。

### 方式三：宝塔面板 / 裸机 Nginx + PHP-FPM

前端先构建：项目根目录执行 `npm run build`（生成 build 目录，不要删除）。

Nginx 站点配置与逐项说明见 **[docs/BAOTA_DEPLOY.md](docs/BAOTA_DEPLOY.md)**，参考配置文件为 [deploy/nginx/short-url.conf](deploy/nginx/short-url.conf)。

要点：

- 网站根目录指向 `build/`；
- PHP 版本 8.2，需启用 pdo_sqlite、mbstring、fileinfo 扩展；
- 伪静态/回退规则：非静态资源一律转发到 `backend/public/index.php`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| DATABASE_PATH | backend/storage/short-url.sqlite3 | SQLite 数据库文件路径 |
| APP_ENV | production | 运行环境 |
| APP_DEBUG | false | 调试模式，生产必须 false |
| APP_URL | 空 | 站点对外地址（预留） |
| APP_PORT | 3001 | 本地开发服务器端口 |
| REACT_APP_API_BASE_URL | 空 | 前端 API 地址，留空为同源 |

## 目录结构

```text
short-url/
├── backend/               # PHP 8.2 后端
│   ├── app/               # Controller / Service / Repository / Http / Validation
│   ├── config/            # 唯一读取环境变量的地方
│   ├── public/index.php   # 前端控制器
│   ├── routes/web.php     # POST /url、POST /api/url、GET /{code}
│   ├── storage/           # SQLite 数据库（short-url.sqlite3）与 app.log / error.log
│   └── tests/             # PHPUnit（Unit / Feature）
├── src/ public/           # React 前端（CRA）
├── deploy/                # Nginx 配置与 supervisord
├── docs/                  # API / 迁移 / 宝塔部署文档
├── Dockerfile             # 多阶段构建（默认：nginx+php-fpm 单容器）
└── docker-compose.yml     # 双容器部署（web + app）
```

## License

MIT（见 [License](License)）
