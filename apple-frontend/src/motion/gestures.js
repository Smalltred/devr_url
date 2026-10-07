/**
 * 手势工具 —— Pointer Events + 速度历史。
 *
 * 关键点：
 *   1. setPointerCapture：指针移出元素边界后仍持续跟踪
 *   2. 尊重抓取偏移：从用户抓住的那一点开始跟手，不要吸附到元素中心
 *   3. 保留最近若干次移动的位置与时间，释放时才拿得到速度
 *   4. 方向判定需要约 10px 的滞回，避免抖动误判
 */

/** 速度采样窗口（毫秒） */
const VELOCITY_WINDOW = 100

/**
 * 创建一次拖拽跟踪。
 *
 * @param {PointerEvent} event 起始 pointerdown 事件
 * @param {object} options
 * @param {boolean} options.axis 仅跟踪单轴（'x' | 'y' | null 表示二维）
 * @returns {object} 跟踪器
 */
export function createDragTracker(event, options = {}) {
    const { axis = null } = options
    const startX = event.clientX
    const startY = event.clientY

    // 速度历史：只保留最近一小段，足够估算释放速度
    let history = [{ x: startX, y: startY, t: performance.now() }]

    function push(clientX, clientY) {
        const now = performance.now()
        history.push({ x: clientX, y: clientY, t: now })
        // 丢掉窗口之外的采样
        while (history.length > 2 && now - history[0].t > VELOCITY_WINDOW) {
            history.shift()
        }
    }

    /**
     * 估算速度（单位/秒）。用最新采样与窗口起点之差除以时间差。
     * @returns {{x: number, y: number}}
     */
    function velocity() {
        if (history.length < 2) return { x: 0, y: 0 }

        const last = history[history.length - 1]
        const first = history[0]
        const dt = (last.t - first.t) / 1000
        if (dt <= 0) return { x: 0, y: 0 }

        return {
            x: (last.x - first.x) / dt,
            y: (last.y - first.y) / dt,
        }
    }

    return {
        /** 相对起点的位移 */
        delta(clientX, clientY) {
            return {
                x: axis === 'y' ? 0 : clientX - startX,
                y: axis === 'x' ? 0 : clientY - startY,
            }
        },
        push,
        velocity,
        startX,
        startY,
    }
}

/**
 * 方向滞回：移动超过阈值才认定手势方向，避免轻微抖动触发。
 *
 * @param {number} dx
 * @param {number} dy
 * @param {number} threshold 像素阈值，Apple 建议约 10px
 * @returns {'x' | 'y' | null}
 */
export function detectAxis(dx, dy, threshold = 10) {
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    if (absX < threshold && absY < threshold) return null

    return absX > absY ? 'x' : 'y'
}

/**
 * 当前指针是否可拖拽（鼠标需按住左键）。
 */
export function isPrimaryDrag(event) {
    return event.pointerType !== 'mouse' || event.buttons === 1
}
