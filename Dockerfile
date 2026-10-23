# syntax=docker/dockerfile:1
#
# devr 多阶段构建（Node.js 24 + 内置 SQLite）：
#   docker build                          -> nginx + node 单容器（单机部署）
#   docker build --target app             -> Node 应用镜像（docker-compose 的 app 服务）
#   docker build --target web             -> nginx 镜像（docker-compose 的 web 服务）

########## Stage 1: Vue 3 前端构建（Vite，apple-frontend 为默认前端）##########
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# 前端源码在 apple-frontend/，产物输出到 /app/dist
COPY apple-frontend ./apple-frontend
RUN npm run build

########## Stage 2: Node 后端（生产依赖只有 bcryptjs，纯 JS 无需编译）##########
FROM node:24-alpine AS backend-base
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/src ./src
COPY backend/tools ./tools
# /admin 需要 dist/index.html：compose 的 app 容器也用它（静态资源本身由 nginx 直出）
COPY --from=frontend /app/dist /app/dist
# SQLite 目录必须在镜像内预建：命名卷挂载到这里时会继承属主，重建容器不丢数据
RUN mkdir -p /app/backend/storage/logs \
    && chown -R node:node /app/backend/storage
ENV NODE_ENV=production \
    APP_ENV=production \
    APP_DEBUG=false
EXPOSE 3001
CMD ["node", "src/server.js"]

########## Target: app（docker-compose 应用服务）##########
FROM backend-base AS app

########## Target: web（docker-compose nginx 服务）##########
FROM nginx:1.27-alpine AS web
COPY --from=frontend /app/dist /var/www/dist
COPY deploy/nginx/compose.conf /etc/nginx/conf.d/default.conf

########## Target: runtime（默认，单容器 nginx + node + memcached）##########
FROM backend-base AS runtime
# 单容器同机部署：memcached 与 Node 同容器，默认监听 127.0.0.1:11211
RUN apk add --no-cache nginx supervisor memcached
COPY deploy/nginx/docker.conf /etc/nginx/http.d/default.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
EXPOSE 80
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
