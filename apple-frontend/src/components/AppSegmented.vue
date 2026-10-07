<script setup>
/**
 * 分段控件：选中块是一个真实元素，由弹簧驱动滑动。
 *
 * 与旧实现（切换 active 类，即瞬间跳变）的区别：
 *   - 选中块从当前位置平滑滑向新位置，运动连续
 *   - 滑动途中可以再次点击另一项，弹簧直接从当前位置反向（可中断）
 *   - 速度被保留并移交，不会在反向时出现「撞墙」的突变
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createSpring } from '../motion/spring.js'

const props = defineProps({
    /** @type {{ value: string, label: string, controls?: string }[]} */
    items: { type: Array, required: true },
    modelValue: { type: String, required: true },
    label: { type: String, default: '' },
    /**
     * 语义模式：
     *   tabs  —— 切换面板可见性（role=tablist/tab + aria-selected）
     *   group —— 切换筛选条件（role=group + aria-pressed）
     * 两者视觉一致，但读屏语义不同，混用会误导辅助技术。
     */
    mode: { type: String, default: 'tabs' },
})

const emit = defineEmits(['update:modelValue'])

const container = ref(null)
const thumb = ref(null)
const thumbReady = ref(false)

let spring = null

/** 读取目标按钮相对容器的位置，驱动滑块 */
function measure() {
    const el = container.value
    if (!el) return null

    const index = props.items.findIndex((item) => item.value === props.modelValue)
    if (index === -1) return null

    const button = el.querySelectorAll('button')[index]
    if (!button) return null

    return {
        x: button.offsetLeft,
        width: button.offsetWidth,
    }
}

/** 把滑块推到当前选中项的位置 */
function moveThumb(instant = false) {
    const target = measure()
    if (!target || !thumb.value) return

    if (instant || !spring) {
        // 首次定位不走动画，直接落位避免从 0 滑入
        thumb.value.style.width = `${target.width}px`
        thumb.value.style.transform = `translateX(${target.x}px)`
        thumbReady.value = true

        return
    }

    // 宽度不是手势通道，用 CSS 过渡即可
    thumb.value.style.width = `${target.width}px`
    spring.retarget(target.x)
}

/** 建立弹簧：滑块位置是唯一被弹簧驱动的通道 */
function createThumbSpring(fromX) {
    return createSpring({
        from: fromX,
        to: fromX,
        response: 0.32,
        damping: 1,
        onUpdate: (x) => {
            if (thumb.value) {
                thumb.value.style.transform = `translateX(${x}px)`
            }
        },
    })
}

onMounted(() => {
    // 等一帧让字体与布局稳定，否则首次测量会拿到错误宽度
    nextTick(() => {
        moveThumb(true)

        spring = createThumbSpring(measure()?.x ?? 0)
    })

    window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    spring?.stop()
})

function handleResize() {
    // 尺寸变化时直接重新落位，不做滑动，避免拉伸变形
    spring?.stop()
    moveThumb(true)
    spring = createThumbSpring(measure()?.x ?? 0)
}

watch(() => props.modelValue, () => {
    moveThumb()
})

// 容器宽度随内容变化（如字体加载完成）时重测
watch(() => props.items, () => {
    nextTick(() => moveThumb(true))
})

/**
 * 键盘导航：左右方向键在选项间移动。
 * 分段控件是单选组语义，方向键切换是平台惯例。
 */
function onKeydown(event) {
    const index = props.items.findIndex((item) => item.value === props.modelValue)
    let next = null

    if (event.key === 'ArrowRight') next = (index + 1) % props.items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + props.items.length) % props.items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = props.items.length - 1

    if (next === null) return
    event.preventDefault()
    emit('update:modelValue', props.items[next].value)
}
</script>

<template>
    <div
        ref="container"
        class="segmented"
        :role="mode === 'tabs' ? 'tablist' : 'group'"
        :aria-label="label || undefined"
        @keydown="onKeydown"
    >
        <div
            ref="thumb"
            class="segmented-thumb"
            :class="{ 'is-ready': thumbReady }"
            aria-hidden="true"
        />
        <button
            v-for="item in items"
            :key="item.value"
            type="button"
            :role="mode === 'tabs' ? 'tab' : undefined"
            :id="mode === 'tabs' ? `tab-${item.value}` : undefined"
            :aria-selected="mode === 'tabs' ? (item.value === modelValue ? 'true' : 'false') : undefined"
            :aria-pressed="mode === 'tabs' ? undefined : (item.value === modelValue ? 'true' : 'false')"
            :aria-controls="item.controls || undefined"
            :tabindex="mode === 'tabs' ? (item.value === modelValue ? 0 : -1) : undefined"
            @click="emit('update:modelValue', item.value)"
        >
            {{ item.label }}
        </button>
    </div>
</template>

<style scoped>
.segmented-thumb {
    opacity: 0;
}

.segmented-thumb.is-ready {
    opacity: 1;
    /* 纯交叉淡入，避免首帧在错误位置闪现 */
    transition: opacity var(--duration-fade) linear, width var(--duration-normal) var(--ease);
}

@media (prefers-reduced-motion: reduce) {
    .segmented-thumb {
        transition: opacity var(--duration-fade) linear !important;
    }
}
</style>
