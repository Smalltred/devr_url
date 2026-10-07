import { fileURLToPath } from 'node:url'

// 必须显式指定 tailwind 配置文件路径。
// 默认情况下 tailwind 从「进程 cwd」而不是 Vite root 查找 tailwind.config.js，
// 而 dev/build 的 cwd 是项目根目录，会命中旧前端的配置，导致：
//   1. content glob 扫的是旧 frontend/src，新前端用到的类被当作未使用而清除
//   2. 新配置里的主题扩展完全不生效
// 这里用绝对路径锁定到 apple-frontend/tailwind.config.js。
const configPath = fileURLToPath(new URL('./tailwind.config.js', import.meta.url))

export default {
    plugins: {
        tailwindcss: { config: configPath },
        autoprefixer: {},
    },
}
