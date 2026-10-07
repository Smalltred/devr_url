/**
 * 动量投射 —— 把「一个小输入」变成「一个大输出」。
 *
 * 释放时不要从释放点吸附到最近的边界，而要用速度投影出「将要停在哪里」，
 * 再吸附到离该投影点最近的目标。这才让轻甩有「把东西扔出去」的手感，
 * 也是滚动减速的标准行为。
 */

/**
 * Apple 的投射函数（来自 Designing Fluid Interfaces 示例代码）。
 * 注意：不是物理课本的 v²/(2·减速)，而是指数衰减形式。
 *
 * 推导：位移 = Σ v·dⁿ = v·d/(1−d)，n→∞（每毫秒衰减 d）
 *
 * @param {number} initialVelocity 释放速度（单位/秒）
 * @param {number} decelerationRate 减速率，0.998 为常规滚动，0.99 更利落
 * @returns {number} 从释放点继续滑行的距离
 */
export function project(initialVelocity, decelerationRate = 0.998) {
    return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate)
}

/**
 * 用动量投射挑选吸附目标。
 *
 * @param {number} position 释放点
 * @param {number} velocity 释放速度（单位/秒）
 * @param {number[]} points 候选吸附点（升序）
 * @param {number} decelerationRate
 * @returns {number} 选中的吸附点
 */
export function projectToSnapPoint(position, velocity, points, decelerationRate = 0.998) {
    if (points.length === 0) return position

    const projectedEndpoint = position + project(velocity, decelerationRate)

    let nearest = points[0]
    let minDistance = Math.abs(projectedEndpoint - nearest)
    for (const point of points) {
        const distance = Math.abs(projectedEndpoint - point)
        if (distance < minDistance) {
            minDistance = distance
            nearest = point
        }
    }

    return nearest
}

/**
 * 橡皮筋阻尼：越界越深，跟随越少 —— 真实物体在停下之前会先减速。
 *
 * @param {number} overshoot 越界量
 * @param {number} dimension 该方向的可用尺寸
 * @param {number} constant 阻尼常数，越小越硬
 * @returns {number} 阻尼后的可见位移
 */
export function rubberband(overshoot, dimension, constant = 0.55) {
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/**
 * 判断手势应当「反向」还是「提交」。
 * 用速度的符号，而不是位置 —— 位置只是当前瞬间，速度表达了用户的意图方向。
 *
 * @param {number} velocity 释放速度
 * @param {number} position 释放位置
 * @param {number} threshold 位置阈值（速度不足时按位置判定）
 * @returns {boolean} true 表示提交（如关闭），false 表示弹回
 */
export function shouldCommit(velocity, position, threshold) {
    // 速度足够大时，方向说了算
    if (Math.abs(velocity) > 500) {
        return velocity > 0
    }

    return position > threshold
}
