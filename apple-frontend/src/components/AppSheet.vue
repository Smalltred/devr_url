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
 *   5. 空间一致性：从哪进就从哪出 —— 入场从触发元素方向生长，
 *      下滑关闭则回到下方
 *   6. 无障碍：焦点陷阱、焦点归还、body 滚动锁、Esc 关闭
 */
import { computed, onMounted, onUnmounted, ref, nextTick } from 'vue'
import { createSpring, prefersReducedMotion } from '../motion/spring.js'
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
    /**
     * 入场锚点：触发元素的 DOM 矩形（getBoundingClientRect 结果）。
     * 传入后，面板从该元素的位置与纵深生长出来（空间一致性：
     * 从哪里出现，就该回到哪里去），而不是从屏幕中心凭空冒出。
     */
    originRect: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const overlay = ref(null)
const scrim = ref(null)
const panel = ref(null)
const bodyEl = ref(null)

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

/** 入场位移/缩放由弹簧驱动，与拖拽共用同一组变换写入 */
let enterX = 0
let enterY = 0
let enterScale = 1
let scaleSpring = null
// 材质淡入：置位后由 CSS 过渡把 opacity 带到 1
const entered = ref(false)

/** 把三组变换写到面板上。拖拽只动 Y，入场动 X/Y/scale，两者互不覆盖。 */
function applyTransform() {
    if (!panel.value) return
    const y = dragY.value + enterY
    panel.value.style.transform =
        `translate3d(${enterX}px, ${y}px, 0) scale(${enterScale})`
}

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
    dragY.value = y
    applyTransform()
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

/** 关闭中标记：防止退场动画期间重复触发 */
const closing = ref(false)

/**
 * 统一退场：淡出 + 轻微下沉/收缩，与入场方向镜像。
 *
 * 为什么需要：Esc、点空白、点按钮原先都是直接 emit('close') —— 弹窗
 * 一帧内消失，遮罩也跟着瞬间不见，读起来很突兀。退场应当与入场对称：
 * 空间一致性要求「从哪来、回哪去」，所以收回时也朝入场起点方向轻微回落。
 *
 * 同时把遮罩一起淡出，让「材质离场」是一个整体动作。
 */
function requestClose() {
    if (closing.value) return
    closing.value = true

    const el = panel.value
    if (!el || prefersReducedMotion()) {
        emit('close')

        return
    }

    // 收缩方向与入场一致（朝起点方向回落），幅度克制
    const toScale = 0.97
    const toY = 10

    // 遮罩与面板同步淡出
    entered.value = false

    let pending = 2
    const done = () => {
        pending -= 1
        if (pending <= 0) emit('close')
    }

    spring?.stop()
    spring = createSpring({
        from: 1,
        to: 0,
        response: 0.3,
        damping: 1,
        onUpdate: (t) => {
            // t: 1 → 0，位移与缩放朝入场起点回收
            enterY = toY * (1 - t)
            enterScale = 1 - (1 - toScale) * (1 - t)
            enterX = 0
            applyTransform()
        },
        onComplete: done,
    })

    // 面板自身的 opacity 由 CSS 过渡负责；这里只等它走完
    window.setTimeout(done, 260)
}

function onKeydown(event) {
    if (event.key === 'Escape' && props.dismissible) {
        event.stopPropagation()
        requestClose()

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

/**
 * 入场：淡入 + 轻微上浮 + 微缩放。
 *
 * 用弹簧而不是 CSS keyframes：弹簧的运动从当前值出发、可被随时中断，
 * 且参数（damping/response）表达的是一段连续运动，而不是固定时长的表演。
 * 这里不加回弹 —— 入场不是手势带来的惯性，过冲会显得轻浮。
 *
 * 关于「从触发元素生长」：早期实现按触发按钮的位置推算起始位移，
 * 让弹窗从按钮方向飞向中心。但按钮常在表格右侧、离视口中心很远，
 * 实测水平位移达 143px、垂直 95px —— 面板横跨大半个屏幕，读起来是
 * 「先偏左再回中」的抖动，而不是优雅的到场。
 *
 * Modal 的定位应当是稳定的：它不属于某个按钮，而是浮在整页之上的一层。
 * 因此这里只保留克制的横向零位移 + 8px 垂直上浮 + 0.985 微缩放，
 * 让「到场」由动作幅度之外的层次感（遮罩压暗、材质淡入）承担。
 * 触发元素的空间关系改由按钮自身的按压反馈表达。
 */
function runEnterAnimation() {
    if (!panel.value) return

    if (prefersReducedMotion()) {
        // 减弱动效：不做位移与缩放，仅靠材质淡入表达出现
        enterX = 0
        enterY = 0
        enterScale = 1
        applyTransform()
        entered.value = true

        return
    }

    // 固定幅度的入场：水平方向绝不位移，保证「始终水平居中」
    const startX = 0
    const startY = 8
    const startScale = 0.985

    enterX = startX
    enterY = startY
    enterScale = startScale
    applyTransform()
    // 起始变换写好后即可淡入：透明度的过渡与位置弹簧并行，材质同时到场
    entered.value = true

    // 位移与缩放拆成两个弹簧：两者时间常数不同，合在一起会互相拖累。
    // response 取 0.34/0.38 —— 约 200–240ms 到位，是「快速但不突兀」的区间。
    createSpring({
        from: 0,
        to: 1,
        response: 0.34,
        damping: 1,
        onUpdate: (t) => {
            enterX = startX * (1 - t)
            enterY = startY * (1 - t)
            applyTransform()
        },
    })

    scaleSpring = createSpring({
        from: 0,
        to: 1,
        response: 0.38,
        damping: 1,
        onUpdate: (t) => {
            enterScale = startScale + (1 - startScale) * t
            applyTransform()
        },
    })
}

/*
 * 关于内容高度：面板高度不随异步内容变化。
 *
 * 早期实现用 ResizeObserver + 弹簧逐帧写 sheet-body 的 height 来「平滑」高度差。
 * 但 height 是布局属性、无法合成器加速，动画它属于文档明令禁止的做法
 * （会触发整棵子树重排，且使面板在动画期间持续改变尺寸 —— 正是抖动的来源）。
 *
 * 现行策略：让尺寸本身稳定，而不是让尺寸变化变得平滑。
 *   · 骨架屏与真实内容逐块等高（统计瓦片、标题、粒度切换、图表区）
 *   · 可变长度的区域（来源域名列表）在 LinkStatsSheet 里限定固定高度并内部滚动
 * 因此从骨架到内容、以及不同数据量之间，面板高度都不变，
 * 既不产生高度跳变，也不需要任何高度动画。
 */

onMounted(async () => {
    previousActive = document.activeElement

    /* 滚动锁：overflow: hidden + 补偿滚动条宽度。
     *
     * 两个坑都踩过，说明为什么是现在这个写法：
     *
     * ① 用 body { position: fixed } 冻结背景 —— 内容脱离文档流后
     *    页面高度塌陷，且 fixed 层与内容区宽度可能不一致。
     *
     * ② 用 html { scrollbar-gutter: stable } 预留槽位 —— 槽位是覆盖式的：
     *    实测 fixed 层被限制在 1425px（视口 1440 − 槽宽 15），
     *    而 clientWidth 仍报 1440，于是面板居中后相对内容区中心
     *    系统性偏左 7.5px（半个槽宽）。背景不跳了，但弹窗不居中。
     *
     * 现行做法：锁滚动时把滚动条占用的宽度补回为 html 的 padding-right。
     * 内容区宽度因此保持不变（背景不横移），fixed 层也仍与视口等宽
     * （弹窗精确居中）。解锁时清除该内联样式。 */
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarW > 0) {
        document.documentElement.style.paddingRight = `${scrollbarW}px`
    }
    document.documentElement.style.overflow = 'hidden'

    window.addEventListener('keydown', onKeydown, true)

    runEnterAnimation()

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
    scaleSpring?.stop()

    // 解除滚动锁与宽度补偿
    document.documentElement.style.overflow = ''
    document.documentElement.style.paddingRight = ''

    // 焦点归还给触发元素 —— 否则键盘用户会掉回页面顶部
    if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus()
    }
})
</script>

<template>
    <div ref="overlay" class="sheet-overlay">
        <!-- 压暗层：点击空白处关闭。
             关闭处理必须挂在这一层而不是外层容器的 @click.self ——
             该层铺满整个遮罩区（inset:0），点击空白处命中的是它本身，
             事件不会冒泡到父层，用 .self 判断父层永远收不到。
             面板是它的兄弟节点且 z-index 更高，因此点击面板不会走到这里。 -->
        <div
            ref="scrim"
            class="sheet-scrim"
            :class="{ 'is-entered': entered }"
            aria-hidden="true"
            @click="dismissible && requestClose()"
        />

        <!-- 定位层：只负责居中，不参与任何动画。
             与动画层分离后，面板的 transform 不会影响居中计算，
             从结构上排除「定位 + 动画互相干扰」导致的抖动。
             动画只作用在它内部的 .sheet-panel 上。 -->
        <div class="sheet-position">
            <div
                ref="panel"
                class="sheet-panel material-thick material-edge"
                :class="[maxWidthClass, dragging ? 'is-dragging' : '', entered ? 'is-entered' : '']"
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

            <div ref="bodyEl" class="sheet-body" :data-sheet-scroll="''">
                <slot />
            </div>

            <footer v-if="$slots.footer" class="sheet-footer">
                <slot name="footer" />
            </footer>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 遮罩层：只负责铺满视口并居中其子层，自身不做任何动画。
   动画全部下移到 .sheet-panel，定位与动画解耦。

   宽度用 100% 而不是依赖 inset:0 的右边界：
   `scrollbar-gutter: stable` 预留的槽位是覆盖在内容之上的（客户端宽仍算它），
   而 inset:0 会让 fixed 元素的右边界落在滚动条槽内侧 ——
   实测 overlay 宽 1425 而 clientWidth 为 1440，导致面板居中后偏左 7.5px。
   显式取 100% 宽度即与内容区一致，居中才真正落在视口中央。 */
.sheet-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--page-padding);
}

/* 定位层：承载居中，不参与动画。
   面板的 transform 因此不会影响居中基准，避免「动画改变定位」的抖动。
   max-height 与宽度约束也放在这一层，面板只负责自身外观与动画。 */
.sheet-position {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 压暗 + 模糊层。动画只改 opacity（合成器属性），
   不去动 background alpha —— 那会让 backdrop-filter 每帧重算。 */
.sheet-scrim {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.32);
    backdrop-filter: blur(var(--overlay-blur));
    -webkit-backdrop-filter: blur(var(--overlay-blur));
    /* 遮罩随面板一同淡入：直接出现会让背景"啪"地变暗，与面板的从容到场不匹配 */
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease);
}

.sheet-scrim.is-entered {
    opacity: 1;
}

[data-theme='dark'] .sheet-scrim {
    background: rgba(0, 0, 0, 0.56);
}

.sheet-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    /* dvh 而非 vh：移动端地址栏收起/展开会改变 vh，导致面板高度跳变；
       dvh 跟随动态视口，尺寸稳定 */
    max-height: calc(100dvh - 2 * var(--page-padding));
    border-radius: var(--radius-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* 动画只动 transform / opacity —— 两者都是合成器属性，不触发布局。
       translateZ(0) 把面板提升为独立合成层：面板自带 backdrop-filter，
       逐帧改 transform 若未分层会让合成器反复重算模糊（实测掉到 18fps）。 */
    transform: translateZ(0);
    will-change: transform, opacity;
    backface-visibility: hidden;
    /* 缩放从中心起步，避免"从角落长出来"的位移错觉 */
    transform-origin: center center;
    /* 纵向拖动由本组件接管（下拉关闭），横向仍交给浏览器 */
    touch-action: pan-x;
    /* 入场的位移/缩放由 runEnterAnimation() 的弹簧驱动（见 script），
       不用 CSS keyframes —— 弹簧可中断，且与其他手势共用同一套变换写入。
       透明度过渡比位移略长：位移先到位、不透明度随后凝实，
       读起来像材质逐渐成形，而不是边界先到、颜色后补齐。 */
    opacity: 0;
    transition: opacity var(--duration-slow) var(--ease);
}

.sheet-panel.is-entered {
    opacity: 1;
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
    /* 高度不参与动画：面板尺寸由内容结构与固定高度区域保证稳定（见 script 注释） */
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
        /* 减弱动效：不做位移与缩放（JS 侧也不会启动入场弹簧），
           仅保留材质淡入 —— 反馈仍在，只是没有位移 */
        transform: none !important;
        transition: opacity var(--duration-fade) linear;
    }
}
</style>
