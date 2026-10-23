#!/usr/bin/env node
/**
 * 生成宝塔开箱即用部署包（Node.js 版）。
 *
 *   node deploy/build-baota-package.mjs
 *
 * 产物：
 *   baota-package/        目录（可直接上传）
 *   baota-package.zip     单文件发布包（Windows 用 PowerShell，其他平台用 zip 命令）
 *
 * 包内不含数据库（backend/storage/short-url.sqlite3），覆盖解压不会影响线上数据。
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const distDir = join(projectRoot, 'dist')
const backendDir = join(projectRoot, 'backend')
const packageDir = join(projectRoot, 'baota-package')
const zipPath = join(projectRoot, 'baota-package.zip')

if (!existsSync(join(distDir, 'index.html'))) {
    console.error('缺少 dist/index.html，请先在项目根目录执行 npm run build')
    process.exit(1)
}

rmSync(packageDir, { recursive: true, force: true })
rmSync(zipPath, { force: true })
mkdirSync(packageDir, { recursive: true })

// 1) 前端产物
cpSync(distDir, join(packageDir, 'public'), { recursive: true })

// 2) Node 后端（排除 node_modules 与运行数据）
const backendTarget = join(packageDir, 'backend')
mkdirSync(backendTarget, { recursive: true })
for (const name of ['src', 'tools']) {
    cpSync(join(backendDir, name), join(backendTarget, name), { recursive: true })
}
for (const name of ['package.json', 'package-lock.json']) {
    copyFileSync(join(backendDir, name), join(backendTarget, name))
}
mkdirSync(join(backendTarget, 'storage', 'logs'), { recursive: true })
writeFileSync(join(backendTarget, 'storage', '.gitkeep'), '')

// 3) 配置模板与部署文档
copyFileSync(join(projectRoot, '.env.example'), join(packageDir, '.env.example'))
copyFileSync(join(here, 'baota', 'nginx-rewrite.conf'), join(packageDir, 'nginx-rewrite.conf'))
copyFileSync(join(here, 'baota', '部署说明.md'), join(packageDir, '部署说明.md'))

// 4) 打包 zip
try {
    if (process.platform === 'win32') {
        execFileSync(
            'powershell',
            ['-NoProfile', '-Command', `Compress-Archive -Path '${packageDir}\\*' -DestinationPath '${zipPath}' -Force`],
            { stdio: 'inherit' },
        )
    } else {
        execFileSync('zip', ['-qr', zipPath, '.'], { cwd: packageDir, stdio: 'inherit' })
    }
    console.log(`\n完成：${zipPath}`)
} catch {
    console.warn('\n目录已生成，但打包 zip 失败（缺少 zip 工具）。请手动压缩 baota-package/ 目录。')
}

console.log(`目录：${packageDir}`)
