# syntax=docker/dockerfile:1
#
# short-url 多阶段构建：
#   docker build                          -> nginx + php-fpm 单容器（单机部署）
#   docker build --target app             -> php-fpm 镜像（docker-compose 的 app 服务）
#   docker build --target web             -> nginx 镜像（docker-compose 的 web 服务）

########## Stage 1: Vue 3 前端构建（Vite）##########
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

########## Stage 2: PHP Composer 依赖与自动加载 ##########
FROM composer:2 AS php
WORKDIR /app
COPY backend/composer.json backend/composer.lock ./
COPY backend/app ./app
COPY backend/config ./config
COPY backend/routes ./routes
COPY backend/public ./public
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-progress

########## Stage 3: PHP-FPM 基础镜像（含 pdo_sqlite 与 memcached 扩展）##########
FROM php:8.2-fpm-alpine AS php-base
# memcached 需编译：libmemcached-dev 仅供构建，编译完成后删除开发包、保留运行时库
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS libmemcached-dev zlib-dev \
    && docker-php-ext-install pdo_sqlite \
    && pecl install memcached \
    && docker-php-ext-enable memcached \
    && apk add --no-cache libmemcached-libs \
    && apk del .build-deps
COPY --from=php /app /app/backend
# 数据与日志目录必须在镜像内预建并交给 www-data：php-fpm worker 以 www-data 运行，
# 若 /app/backend 由 root 拥有且 storage 不存在，DatabaseService 无法自行建目录（503）。
# 命名卷挂载到该路径时会继承这里的属主，重建容器不丢数据。
RUN mkdir -p /app/backend/storage/logs \
    && chown -R www-data:www-data /app/backend/storage \
    && chmod 775 /app/backend/storage /app/backend/storage/logs
ENV APP_ENV=production \
    APP_DEBUG=false
WORKDIR /app/backend

########## Target: app（docker-compose php-fpm 服务）##########
FROM php-base AS app

########## Target: web（docker-compose nginx 服务）##########
FROM nginx:1.27-alpine AS web
COPY --from=frontend /app/dist /var/www/dist
COPY deploy/nginx/compose.conf /etc/nginx/conf.d/default.conf

########## Target: runtime（默认，单容器 nginx + php-fpm + memcached）##########
FROM php-base AS runtime
# 单容器同机部署：memcached 与本机 PHP 同容器，默认监听 127.0.0.1:11211
RUN apk add --no-cache nginx supervisor memcached
COPY --from=frontend /app/dist /app/dist
COPY deploy/nginx/docker.conf /etc/nginx/http.d/default.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
EXPOSE 80
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
