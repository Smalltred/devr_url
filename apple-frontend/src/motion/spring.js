/**
 * 弹簧引擎 —— 零依赖，rAF 驱动。
 *
 * 为什么用弹簧而不是固定时长的过渡/关键帧：
 *   固定时长的动画无法响应新输入，用户中途抓取只能等它播完。
 *   弹簧把新输入当作「改变目标值」，运动始终连续，因此天然可中断、可反向。
 *
 * 参数用 Apple 的两参数心智模型，而非物理课本的 质量/刚度/阻尼：
 *   - damping  阻尼比，控制过冲。1.0 = 临界阻尼，无过冲；< 1.0 = 回弹
 *   - response 响应速度，单位秒。越小越灵敏。注意这不是「时长」——
 *              弹簧没有固定时长，稳定时间由参数涌现。
 *
 * 三个关键能力：
 *   1. 从「当前呈现值」重新起动（不是从逻辑目标值），中断不跳变
 *   2. 速度移交：手势释放时的速度原样作为弹簧初速度，拖动与动画之间无接缝
 *   3. 2D 运动拆成独立的 X/Y 弹簧，避免两个方向速度不同时互相拖累
 */

/** 把阻尼比与响应换算为弹簧的刚度与阻尼系数 */
function springParams({ response = 0.35, damping = 1 }) {
    const omega = (2 * Math.PI) / response
    const stiffness = omega * omega
    const dampingCoefficient = 2 * damping * omega

    return { stiffness, dampingCoefficient }
}

/** 用户是否要求减弱动效 */
export function prefersReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 创建一个弹簧。
 *
 * @param {object} options
 * @param {number} options.from           起始值（默认 0）
 * @param {number} options.to             目标值
 * @param {number} options.velocity       初速度（单位/秒），手势释放时移交
 * @param {number} options.response       响应，秒
 * @param {number} options.damping        阻尼比
 * @param {number} options.restDelta      静止判定阈值（值）
 * @param {number} options.restVelocity   静止判定阈值（速度）
 * @param {(v: number) => void} options.onUpdate  每帧回调，参数为当前值
 * @param {() => void} options.onComplete         到达静止后回调
 * @returns {{ stop: () => void, retarget: (to: number, velocity?: number) => void,
 *             value: () => number, velocity: () => number, isSettled: () => boolean }}
 */
export function createSpring(options = {}) {
    const {
        from = 0,
        to = 0,
        velocity = 0,
        response = 0.35,
        damping = 1,
        onUpdate,
        onComplete,
    } = options

    // 静止判定用「感知阈值」而非固定精度。
    // 绝对阈值会让长距离运动的收敛时间被无意义地拉长：496px 的行程若要求
    // 收敛到 0.001px，临界阻尼下要 1.2s 才停，读起来很迟钝；
    // 而 0.5px 已是亚像素、视觉上完全不可辨，0.4s 就能到达。
    const travel = Math.abs(to - from)
    const restDelta = options.restDelta ?? Math.max(0.5, travel * 0.0005)
    // 速度阈值同理：约等于每帧位移小于亚像素（60fps 下 1px/帧 ≈ 60px/s）
    const restVelocity = options.restVelocity ?? 30

    let current = from
    let currentVelocity = velocity
    let target = to
    let rafId = null
    let lastTime = 0
    let settled = false

    const { stiffness, dampingCoefficient } = springParams({ response, damping })

    // 减弱动效：不做弹簧运动，直接落位。反馈仍在（值会变），只是没有位移过程。
    const instant = prefersReducedMotion()

    function settle() {
        settled = true
        rafId = null
        onUpdate?.(target)
        onComplete?.()
    }

    /**
     * 静止判定：位移与速度都落在感知阈值内。
     * retarget 会改变行程，因此阈值按当前目标重新计算。
     */
    function isAtRest() {
        const remaining = Math.abs(current - target)
        const threshold = Math.max(restDelta, Math.abs(target - from) * 0.0005)

        return remaining < threshold && Math.abs(currentVelocity) < restVelocity
    }

    function tick(time) {
        if (lastTime === 0) {
            lastTime = time
        }
        // 时间步长上限：仅用于防止「切到后台再回来」产生的巨大多秒跳变。
        // 不能设得太小 —— 那会把慢帧也截断，动画在墙钟时间上被拉长
        // （真实帧耗时 80ms 却只推进 33ms，动画会慢 2.4 倍）。
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        lastTime = time

        // 子步进：显式欧拉在 dt 较大时会失稳（刚度 ~451 时 dt>~60ms 就发散，
        // 表现为数值爆炸到几千像素）。把一帧切成若干 <=8ms 的子步，
        // 既保持数值稳定，又让动画在墙钟时间上精确推进。
        const STEP = 0.008
        let remaining = dt
        while (remaining > 0) {
            const h = Math.min(remaining, STEP)
            remaining -= h
            const displacement = current - target
            const acceleration = -stiffness * displacement - dampingCoefficient * currentVelocity
            currentVelocity += acceleration * h
            current += currentVelocity * h
        }

        onUpdate?.(current)

        if (isAtRest()) {
            current = target
            currentVelocity = 0
            settle()

            return
        }

        rafId = requestAnimationFrame(tick)
    }

    function start() {
        if (instant) {
            settle()

            return
        }
        settled = false
        lastTime = 0
        if (rafId === null) {
            rafId = requestAnimationFrame(tick)
        }
    }

    /**
     * 改变目标值并保持运动连续。
     * 关键：从当前值和当前速度继续，而不是重置到起始值——这是「可中断」的实现。
     */
    function retarget(nextTarget, nextVelocity) {
        target = nextTarget
        if (nextVelocity !== undefined) {
            currentVelocity = nextVelocity
        }
        if (instant) {
            settle()

            return
        }
        if (rafId === null) {
            settled = false
            lastTime = 0
            rafId = requestAnimationFrame(tick)
        }
    }

    function stop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
        }
    }

    start()

    return {
        stop,
        retarget,
        value: () => current,
        velocity: () => currentVelocity,
        isSettled: () => settled,
    }
}

/**
 * 二维弹簧：X 与 Y 独立推进。
 * 单一弹簧跑二维距离，在 X/Y 速度不同时会互相拖累而失同步，所以必须拆开。
 */
export function createSpring2D(options = {}) {
    const { onUpdate, ...rest } = options
    const shared = { ...rest }

    const sx = createSpring({
        ...shared,
        from: options.fromX ?? 0,
        to: options.toX ?? 0,
        velocity: options.velocityX ?? 0,
        onUpdate: (x) => onUpdate?.(x, sy.value()),
    })

    const sy = createSpring({
        ...shared,
        from: options.fromY ?? 0,
        to: options.toY ?? 0,
        velocity: options.velocityY ?? 0,
        onUpdate: (y) => onUpdate?.(sx.value(), y),
    })

    return {
        stop: () => {
            sx.stop()
            sy.stop()
        },
        retarget: (x, y, vx, vy) => {
            sx.retarget(x, vx)
            sy.retarget(y, vy)
        },
        value: () => [sx.value(), sy.value()],
    }
}

/**
 * 补间一个数值（用于透明度等不该有回弹的通道）。
 * 匀速推进，可中断：中途 retarget 会以新目标重算速度，从当前值继续。
 */
export function createTween(options = {}) {
    const { from = 0, to = 0, duration = 0.2, onUpdate, onComplete } = options
    let current = from
    let target = to
    // 本次行程的速度（单位/秒），在 retarget 时按剩余距离与 duration 重算
    let rate = duration > 0 ? Math.abs(to - from) / duration : Infinity
    let rafId = null
    let lastTime = 0

    const instant = prefersReducedMotion()

    function finish() {
        rafId = null
        current = target
        onUpdate?.(current)
        onComplete?.()
    }

    function tick(time) {
        if (lastTime === 0) lastTime = time
        // 与 createSpring 同理：上限只兜后台恢复的跳变，不截断正常慢帧
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        lastTime = time

        const remaining = target - current
        const step = rate * dt

        // 剩余距离小于一步时直接落位，不越过目标
        if (Math.abs(remaining) <= step) {
            finish()

            return
        }

        current += Math.sign(remaining) * step
        onUpdate?.(current)
        rafId = requestAnimationFrame(tick)
    }

    function retarget(nextTarget) {
        target = nextTarget
        if (instant) {
            finish()

            return
        }
        // 按新的剩余距离重算速度，保证每次变动都在 duration 内完成
        rate = duration > 0 ? Math.abs(target - current) / duration : Infinity
        if (rafId === null) {
            lastTime = 0
            rafId = requestAnimationFrame(tick)
        }
    }

    retarget(to)

    return {
        stop: () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId)
                rafId = null
            }
        },
        retarget,
        value: () => current,
    }
}
