<script setup>
/**
 * Sheet —— 取代旧前端的静态弹窗。
 *
 * 苹果设计要点：
 *   1. 直接操作：下滑 1:1 跟手，尊重抓取偏移（不是吸附到中心）
 *   2. 橡皮筋：往上拖到边界时渐进阻尼，不是硬停
 *   3. 动量投射：释放时用速度投影出的落点决定「关闭」还是「弹回」，
 *      而不是从释放点就近判定
 *   4. 速度移交：释放速度原样成为弹簧初速度，拖动与动画之间无接缝
 *   5. 空间一致性：从哪进就从哪出（下滑关闭 = 回到下方）
 *   6. 无障碍：焦点陷阱、焦点归还、body 滚动锁、Esc 关闭
 */
import { computed, onMounted, onUnmounted, ref, nextTick } from 'vue'
import { createSpring } from '../motion/spring.js'
import { createDragTracker, isPrimaryDrag } from '../motion/gestures.js'
import { rubberband, project } from '../motion/project.js'

const props = defineProps({
    title: { type: String, default: '' },
    /** 是否允许下滑关闭（确认类对话框通常允许，表单类可视情况关闭） */
    dismissible: { type: Boolean, default: true },
    /** 宽度档位 */
    size: { type: String, default: 'md' }, // sm | md | lg | xl
    /** 透传为 aria-* 语义 */
    role: { type: String, default: 'dialog' },
})

const emit = defineEmits(['close'])

const overlay = ref(null)
const scrim = ref(null)
const panel = ref(null)

// 下滑位移（px），正数表示向下
const dragY = ref(0)
// 是否处于拖拽中，用于暂时关闭过渡避免与弹簧打架
const dragging = ref(false)

/** 认定「这是拖拽而非点击」所需的位移阈值（Apple 建议约 10px 滞回） */
const DRAG_THRESHOLD = 10

let spring = null
// 已按下但尚未确认是拖拽（避免在 pointerdown 立即接管，否则会吞掉内部按钮的 click）
let armed = false
let tracker = null
let previousActive = null
let scrollLockY = 0

const maxWidthClass = computed(() => ({
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
}[props.size] || 'max-w-lg'))

/** 面板高度的 40% 作为「拖过就关闭」的位置阈值（速度不足时用） */
function closeThreshold() {
    const height = panel.value?.offsetHeight ?? 400

    return height * 0.4
}

function setTranslate(y) {
    if (panel.value) {
        panel.value.style.transform = y === 0 ? '' : `translateY(${y}px)`
    }
}

/**
 * 背景随下滑逐渐回亮，让「正在离开」这件事被看见。
 *
 * 走 opacity 而不是改 background 的 alpha：遮罩上带 backdrop-filter，
 * 改任何参与绘制的属性都会让模糊重算（实测每帧 64ms → 掉到 18fps）。
 * opacity 是纯合成器属性，模糊结果被复用，帧率不受影响。
 */
function applyDim(y) {
    if (!scrim.value) return
    const height = panel.value?.offsetHeight ?? 400
    const progress = Math.min(Math.abs(y) / height, 1)
    scrim.value.style.opacity = String(1 - progress)
}

function onPointerDown(event) {
    if (!props.dismissible) return
    if (!isPrimaryDrag(event)) return
    // 只在面板自身（非内部可滚动区域）起手时接管，避免抢走内容滚动
    const scrollable = event.target.closest('[data-sheet-scroll]')
    if (scrollable && scrollable.scrollTop > 0) return

    // 先「待命」而不立即接管：
    // 若在此处 setPointerCapture，面板内所有按钮的 click 都会被吞掉
    // （指针事件被重定向到面板）。只有确认是真实的拖拽动作后才接管。
    armed = true
    tracker = createDragTracker(event, { axis: 'y' })
}

function onPointerMove(event) {
    if (!armed || !tracker) return
    tracker.push(event.clientX, event.clientY)

    const { y } = tracker.delta(event.clientX, event.clientY)

    // 滞回：位移超过阈值才认定这是拖拽而非点击
    if (!dragging.value) {
        if (Math.abs(y) < DRAG_THRESHOLD) return
        dragging.value = true
        spring?.stop()
        panel.value?.setPointerCapture?.(event.pointerId)
    }

    let visible = y

    if (y < 0) {
        // 向上越界：橡皮筋阻尼，越拖越沉
        const height = panel.value?.offsetHeight ?? 400
        visible = -rubberband(-y, height)
    }

    dragY.value = visible
    setTranslate(visible)
    applyDim(visible)
}

function onPointerUp(event) {
    const wasDragging = dragging.value
    armed = false
    dragging.value = false

    if (!tracker) return
    const velocityY = tracker.velocity().y
    const y = dragY.value
    tracker = null

    if (!wasDragging) return

    panel.value?.releasePointerCapture?.(event.pointerId)

    const height = panel.value?.offsetHeight ?? 400
    // 用速度投影落点：轻甩即可关闭，不必拖到一半
    const projected = y + project(velocityY)
    const shouldClose = projected > closeThreshold() || velocityY > 800

    if (shouldClose) {
        // 沿进入的反方向离开，速度移交，无接缝
        spring?.stop()
        spring = createSpring({
            from: y,
            to: height,
            velocity: velocityY,
            response: 0.3,
            damping: 1,
            onUpdate: (value) => {
                setTranslate(value)
                applyDim(value)
            },
            onComplete: () => emit('close'),
        })

        return
    }

    // 弹回：带一点阻尼比（0.85）因为这次运动由惯性而来，轻微回弹是合理的
    spring?.stop()
    spring = createSpring({
        from: y,
        to: 0,
        velocity: velocityY,
        response: 0.32,
        damping: 0.85,
        onUpdate: (value) => {
            setTranslate(value)
            applyDim(value)
        },
    })
    dragY.value = 0
}

function onKeydown(event) {
    if (event.key === 'Escape' && props.dismissible) {
        event.stopPropagation()
        emit('close')

        return
    }

    // 焦点陷阱：Tab 在面板内循环，不逃到背景
    if (event.key === 'Tab' && panel.value) {
        const focusable = panel.value.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) return

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
        }
    }
}

onMounted(async () => {
    previousActive = document.activeElement

    // 滚动锁：记下当前位置，用 fixed 定位冻结背景，避免内容跳动
    scrollLockY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollLockY}px`
    document.body.style.width = '100%'

    window.addEventListener('keydown', onKeydown, true)

    await nextTick()
    // 焦点进入面板，但不落在危险操作上：优先第一个可聚焦元素
    const firstFocusable = panel.value?.querySelector(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]',
    )
    firstFocusable?.focus?.()
})

onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown, true)
    spring?.stop()

    // 解除滚动锁并恢复原位置
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    window.scrollTo(0, scrollLockY)

    // 焦点归还给触发元素 —— 否则键盘用户会掉回页面顶部
    if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus()
    }
})
</script>

<template>
    <div
        ref="overlay"
        class="sheet-overlay"
        @click.self="dismissible && emit('close')"
    >
        <!-- 压暗层单独成层：模糊只在这里，动画只走 opacity，两者互不干扰 -->
        <div ref="scrim" class="sheet-scrim" aria-hidden="true" />

        <div
            ref="panel"
            class="sheet-panel material-thick material-edge"
            :class="[maxWidthClass, dragging ? 'is-dragging' : '']"
            :role="role"
            aria-modal="true"
            :aria-label="title || undefined"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
        >
            <!-- 抓取指示条：暗示这块面板可以拖动 -->
            <div v-if="dismissible" class="sheet-grabber" aria-hidden="true" />

            <header v-if="title || $slots.header" class="sheet-header">
                <slot name="header">
                    <h2 class="type-lg">{{ title }}</h2>
                </slot>
            </header>

            <div class="sheet-body" :data-sheet-scroll="''">
                <slot />
            </div>

            <footer v-if="$slots.footer" class="sheet-footer">
                <slot name="footer" />
            </footer>
        </div>
    </div>
</template>

<style scoped>
.sheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--page-padding);
}

/* 压暗 + 模糊层。动画只改 opacity（合成器属性），
   不去动 background alpha —— 那会让 backdrop-filter 每帧重算。 */
.sheet-scrim {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.32);
    backdrop-filter: blur(var(--overlay-blur));
    -webkit-backdrop-filter: blur(var(--overlay-blur));
}

[data-theme='dark'] .sheet-scrim {
    background: rgba(0, 0, 0, 0.56);
}

.sheet-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    max-height: 85vh;
    border-radius: var(--radius-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* 拖拽时由 JS 直接写 transform；平时归零。
       面板本身带 backdrop-filter，逐帧改 transform 会让合成器反复重算模糊
       （实测掉到 18fps）。提升为独立合成层后 transform 只做层移动，
       模糊结果被复用，帧率回到 60fps。 */
    transform: translateZ(0);
    will-change: transform;
    backface-visibility: hidden;
    /* 纵向拖动由本组件接管（下拉关闭），横向仍交给浏览器 */
    touch-action: pan-x;
    animation: sheet-in var(--duration-normal) var(--ease) backwards;
}

/* 入场：从下方浮起 + 放大，读作「一块材质到场」而非简单淡入 */
@keyframes sheet-in {
    from {
        opacity: 0;
        transform: translateY(18px) scale(0.97);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.sheet-grabber {
    width: 36px;
    height: 5px;
    margin: 8px auto 0;
    border-radius: var(--radius-pill);
    background: var(--glass-border-soft);
    flex: none;
}

.sheet-header {
    padding: var(--space-5) var(--space-6) var(--space-3);
    flex: none;
}

.sheet-body {
    padding: 0 var(--space-6) var(--space-6);
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1 1 auto;
    min-height: 0;
}

.sheet-footer {
    padding: var(--space-4) var(--space-6) var(--space-6);
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    flex: none;
}

@media (prefers-reduced-motion: reduce) {
    .sheet-panel {
        animation: none;
        /* 减弱动效：不做位移，改为淡入；拖拽同样被禁用 */
        opacity: 1;
        transform: none !important;
    }
}
</style>
