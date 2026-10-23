# 宝塔面板部署文档（Node.js 24 + Nginx + SQLite）

> **快捷方式**：不想从源码折腾，可直接使用开箱即用部署包 **`baota-package.zip`**
> （项目根目录，含编译好的前端、Node 后端源码与依赖清单）。
> 生成方式：`npm run build` 后执行 `node deploy/build-baota-package.mjs`。
> zip 内**不含数据库**（`backend/storage/` 为空目录），覆盖解压不会影响已有数据。
> 详细步骤见包内 `部署说明.md`。

目标：把 devr 部署到宝塔面板的 `/www/wwwroot/short-url`，短码路由 `/xxxxx` 正确交给 Node，
静态资源正常访问。

## 1. 环境准备（宝塔软件商店）

| 组件 | 要求 |
| --- | --- |
| Nginx | 任意近期版本（1.20+） |
| Node.js | **24+**（必需：使用内置 `node:sqlite`） |
| Node 项目管理器 | 宝塔软件商店安装，用于守护进程与开机自启 |
| SQLite | Node 内置，无需单独安装数据库服务 |
| Memcached | **可选**：短链跳转缓存；未安装时自动降级为直连数据库，功能不受影响 |

> Node.js 安装：宝塔「软件商店 → Node.js 版本管理器」安装 24.x，并在 Node 项目管理器中选择该版本。

## 2. 上传代码

```bash
cd /www/wwwroot
# 方式 A：git clone（推荐，便于更新）
git clone <仓库地址> short-url
# 方式 B：上传 baota-package.zip 后解压到 short-url/
```

## 3. 安装依赖与构建

```bash
cd /www/wwwroot/short-url

# 前端构建（生成 dist 目录，不要删除）
npm install
npm run build

# 后端依赖（生产依赖只有 bcryptjs）
cd backend
npm install --omit=dev
```

## 4. 环境变量

```bash
cd /www/wwwroot/short-url/backend
cp ../.env.example .env
```

编辑 `backend/.env`，至少修改：

```ini
APP_ENV=production
APP_DEBUG=false
APP_URL=https://你的域名
# 管理后台密码（二选一；哈希优先）
ADMIN_PASSWORD=你的强密码
# ADMIN_PASSWORD_HASH=...
# 数据库路径，留空使用 backend/storage/short-url.sqlite3
# DATABASE_PATH=
# 缓存（可选）
# MEMCACHED_SERVERS=127.0.0.1:11211
# 外链巡检（进程内每日定时任务，默认 12:00；后台「设置」页可改）
# HEALTH_SCAN_ENABLED=true
# HEALTH_SCAN_HOUR=12
# HEALTH_SCAN_MINUTE=0
# HEALTH_DEAD_THRESHOLD=3
```

目录权限（Node 进程需要写 SQLite）：

```bash
chown -R www:www /www/wwwroot/short-url/backend/storage
chmod -R 775 /www/wwwroot/short-url/backend/storage
```

## 5. 启动 Node 服务

**推荐：宝塔「Node 项目管理器」**

- 添加项目 → 项目目录：`/www/wwwroot/short-url/backend`
- 启动命令：`node src/server.js`
- 端口：`3001`
- 运行用户：`www`，勾选开机自启

**或使用 PM2**：

```bash
cd /www/wwwroot/short-url/backend
npm install -g pm2
pm2 start src/server.js --name devr
pm2 save && pm2 startup
```

验证：`curl http://127.0.0.1:3001/healthz` 返回 `{"ok":true,...}`。

## 6. 宝塔站点设置

### 6.1 运行目录

网站 → 设置 → 网站目录 → 运行目录选择 **`/dist`** → 保存。

### 6.2 伪静态（关键）

网站 → 设置 → 伪静态 → 粘贴以下内容并保存：

```nginx
location ~ (^|/)\.(env|git|svn|hg)|\.(sqlite3?|db|log|bak|swp|old|ini|sh)$ {
    deny all;
    return 404;
}
location ~ ^/(backend|storage|src|node_modules|tests|deploy|docs)/ {
    deny all;
    return 404;
}
location ~* \.(?:js|css|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|map|json|txt|html|webmanifest)$ {
    try_files $uri =404;
    expires 30d;
    access_log off;
}
location / {
    try_files $uri $uri/ @backend;
}
location @backend {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

完整参考见 [deploy/nginx/short-url.conf](../deploy/nginx/short-url.conf)。

## 7. SQLite 数据

- 数据库文件：`backend/storage/short-url.sqlite3`（首次访问自动创建，WAL 模式）；
- **备份 = 拷贝这一个文件**；
- 从 PHP 版本迁移：把旧 `backend/storage/short-url.sqlite3` 直接覆盖过来即可，
  表结构与短码算法完全一致，后台改过的密码继续有效。

## 8. 验证

```bash
# 健康检查
curl -s http://127.0.0.1:3001/healthz
# {"ok":true,"links":12}

# 创建短链
curl -s -X POST http://127.0.0.1:3001/url \
    -H 'Content-Type: application/json' -H "Origin: http://127.0.0.1:3001" \
    -d '{"url":"https://github.com/onee-io/short-url"}'
# {"url":"https://github.com/onee-io/short-url","code":"SB"}

# 跳转
curl -sI http://127.0.0.1:3001/SB
# HTTP/1.1 302 Found
# location: https://github.com/onee-io/short-url
```

浏览器打开站点首页与 `/admin` 应正常显示。

## 9. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 首页正常但所有接口 404 | 伪静态未生效，检查 `location @backend` 是否已保存 |
| 接口 403 `Cross-site request rejected` | 反向代理未保留原始 Host：确认 `proxy_set_header Host $http_host` |
| 登录后立刻掉登录态 | 站点为 HTTPS 但代理未传 `X-Forwarded-Proto`，Cookie 的 Secure 属性判定异常 |
| 启动报找不到 `node:sqlite` | Node 版本低于 24，升级 Node |
| `SQLITE_CANTOPEN` / 503 | `backend/storage` 不可写，按第 4 节调整属主权限 |
| 外链巡检不执行 | 检查 `HEALTH_SCAN_ENABLED`，以及进程是否常驻（PM2/宝塔守护） |
