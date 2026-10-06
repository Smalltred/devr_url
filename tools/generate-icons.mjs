/**
 * 按 glass-theme-system 令牌生成站点图标：
 *   public/favicon.ico — 16/32/48/64 多尺寸 PNG-in-ICO（透明圆角矩形）
 *   public/logo100.png — 100×100 不透明底（apple-touch-icon / manifest）
 * 设计：主题蓝对角渐变 squircle + 顶部玻璃高光 + 白色 “d”（devr 首字母）。
 * 纯 Node 内置模块实现（zlib 编码 PNG），无第三方依赖；需要更新图标时运行 `node tools/generate-icons.mjs`。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// ---------- PNG 编码 ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})

function crc32(buf) {
    let c = 0xffffffff
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
}

function encodePNG(size, rgba) {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0)
    ihdr.writeUInt32BE(size, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 6 // RGBA
    const raw = Buffer.alloc((size * 4 + 1) * size)
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0 // filter: none
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0)),
    ])
}

// ---------- SDF 渲染（4x 超采样抗锯齿） ----------

const TOP = [0x6e, 0xa5, 0xfa] // #6ea5fa
const BOTTOM = [0x3b, 0x82, 0xf6] // #3b82f6

function roundedRectDist(x, y, half, radius) {
    const qx = Math.abs(x - half) - (half - radius)
    const qy = Math.abs(y - half) - (half - radius)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

// 采样点（0-100 视图坐标系），返回 [r,g,b,a]
function sample(u, v, opaqueBg) {
    if (roundedRectDist(u, v, 50, 24) > 0) {
        return opaqueBg ? [0xf5, 0xf7, 0xfb, 255] : [0, 0, 0, 0]
    }
    const t = (u + v) / 200
    let r = TOP[0] + (BOTTOM[0] - TOP[0]) * t
    let g = TOP[1] + (BOTTOM[1] - TOP[1]) * t
    let b = TOP[2] + (BOTTOM[2] - TOP[2]) * t
    // 顶部玻璃高光
    const hl = 0.28 * Math.max(0, 1 - v / 52)
    r += (255 - r) * hl
    g += (255 - g) * hl
    b += (255 - b) * hl
    // 字形 “d”：圆环 + 竖笔
    const dBowl = Math.abs(Math.hypot(u - 44, v - 59) - 15) - 4
    const dy = Math.max(26 - v, 0, v - 78)
    const dStem = Math.hypot(u - 60, dy) - 4.5
    if (Math.min(dBowl, dStem) <= 0) {
        r = g = b = 255
    }
    return [r, g, b, 255]
}

function render(size, opaqueBg = false) {
    const SS = 4
    const rgba = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let r = 0, g = 0, b = 0, a = 0
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const u = ((x + (sx + 0.5) / SS) / size) * 100
                    const v = ((y + (sy + 0.5) / SS) / size) * 100
                    const [sr, sg, sb, sa] = sample(u, v, opaqueBg)
                    r += sr; g += sg; b += sb; a += sa
                }
            }
            const n = SS * SS
            const i = (y * size + x) * 4
            rgba[i] = r / n
            rgba[i + 1] = g / n
            rgba[i + 2] = b / n
            rgba[i + 3] = a / n
        }
    }
    return rgba
}

// ---------- ICO 打包（PNG-in-ICO） ----------

function packICO(pngs) {
    const header = Buffer.alloc(6)
    header.writeUInt16LE(1, 2) // type: icon
    header.writeUInt16LE(pngs.length, 4)
    let offset = 6 + pngs.length * 16
    const entries = pngs.map(({ size, data }) => {
        const entry = Buffer.alloc(16)
        entry[0] = size >= 256 ? 0 : size
        entry[1] = size >= 256 ? 0 : size
        entry.writeUInt16LE(1, 4) // planes
        entry.writeUInt16LE(32, 6) // bpp
        entry.writeUInt32LE(data.length, 8)
        entry.writeUInt32LE(offset, 12)
        offset += data.length
        return entry
    })
    return Buffer.concat([header, ...entries, ...pngs.map(p => p.data)])
}

const ico = packICO(
    [16, 32, 48, 64].map(size => ({ size, data: encodePNG(size, render(size)) })),
)
writeFileSync(join(PUBLIC_DIR, 'favicon.ico'), ico)
writeFileSync(join(PUBLIC_DIR, 'logo100.png'), encodePNG(100, render(100, true)))

console.log('generated: public/favicon.ico (16/32/48/64), public/logo100.png')
