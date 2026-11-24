<script setup>
/**
 * 主题化下拉选择（select-only combobox）。
 *
 * 原生 <select> 的展开层由系统绘制，无法跟随浅/深主题，因此这里自绘：
 * - 触发器仍是一个 button，保留键盘与辅助技术语义；
 * - 列表使用 role=listbox / option + aria-activedescendant；
 * - 点击外部、Esc、Tab 关闭；上下键/Home/End 移动，Enter/空格选中。
 *
 * items: [{ value: string, label: string, count?: number }]
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

let sequence = 0
const uid = `app-select-${(sequence += 1)}`

const props = defineProps({
    modelValue: { type: String, default: '' },
    items: { type: Array, default: () => [] },
    label: { type: String, default: '选择' },
    placeholder: { type: String, default: '请选择' },
})

const emit = defineEmits(['update:modelValue'])

const root = ref(null)
const trigger = ref(null)
const list = ref(null)
const open = ref(false)
const activeIndex = ref(0)

const selectedIndex = computed(
    () => props.items.findIndex((item) => String(item.value) === String(props.modelValue)),
)
const selectedItem = computed(() => props.items[selectedIndex.value] ?? null)
const selectedLabel = computed(() => selectedItem.value?.label ?? props.placeholder)

function optionId(index) {
    return `${uid}-option-${index}`
}

function scrollActiveIntoView() {
    const options = list.value?.querySelectorAll('[role="option"]') ?? []
    options[activeIndex.value]?.scrollIntoView({ block: 'nearest' })
}

function openMenu() {
    if (open.value) return
    open.value = true
    activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
    nextTick(scrollActiveIntoView)
}

function closeMenu(restoreFocus = false) {
    if (!open.value) return
    open.value = false
    if (restoreFocus) trigger.value?.focus()
}

function toggle() {
    if (open.value) {
        closeMenu()
    } else {
        openMenu()
    }
}

function moveActive(delta) {
    if (props.items.length === 0) return
    if (!open.value) {
        openMenu()
        return
    }
    activeIndex.value = (activeIndex.value + delta + props.items.length) % props.items.length
    nextTick(scrollActiveIntoView)
}

function choose(index) {
    const item = props.items[index]
    if (!item) return
    emit('update:modelValue', String(item.value))
    closeMenu(true)
}

function onKeydown(event) {
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault()
            moveActive(1)
            break
        case 'ArrowUp':
            event.preventDefault()
            moveActive(-1)
            break
        case 'Home':
            if (!open.value) return
            event.preventDefault()
            activeIndex.value = 0
            nextTick(scrollActiveIntoView)
            break
        case 'End':
            if (!open.value) return
            event.preventDefault()
            activeIndex.value = props.items.length - 1
            nextTick(scrollActiveIntoView)
            break
        case 'Enter':
        case ' ':
            event.preventDefault()
            if (open.value) {
                choose(activeIndex.value)
            } else {
                openMenu()
            }
            break
        case 'Escape':
            if (!open.value) return
            event.preventDefault()
            closeMenu(true)
            break
        case 'Tab':
            if (open.value) closeMenu()
            break
        default:
            break
    }
}

function onDocumentPointerDown(event) {
    if (open.value && root.value && !root.value.contains(event.target)) {
        closeMenu()
    }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onDocumentPointerDown))

watch(() => props.modelValue, () => {
    if (open.value) {
        activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
    }
})

watch(() => props.items, () => {
    if (activeIndex.value >= props.items.length) {
        activeIndex.value = Math.max(0, props.items.length - 1)
    }
})
</script>

<template>
    <div ref="root" class="app-select">
        <button
            ref="trigger"
            type="button"
            class="select-trigger"
            :class="{ 'is-open': open }"
            role="combobox"
            aria-haspopup="listbox"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-controls="`${uid}-listbox`"
            :aria-label="label"
            :aria-activedescendant="open ? optionId(activeIndex) : undefined"
            :title="selectedLabel"
            @click="toggle"
            @keydown="onKeydown"
        >
            <span class="select-label">{{ selectedLabel }}</span>
            <svg
                class="select-chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>

        <ul
            v-if="open"
            :id="`${uid}-listbox`"
            ref="list"
            class="select-menu"
            role="listbox"
            :aria-label="label"
        >
            <li
                v-for="(item, index) in items"
                :id="optionId(index)"
                :key="item.value"
                class="select-option"
                :class="{
                    'is-active': index === activeIndex,
                    'is-selected': String(item.value) === String(modelValue),
                }"
                role="option"
                :aria-selected="String(item.value) === String(modelValue) ? 'true' : 'false'"
                :title="item.label"
                @pointerenter="activeIndex = index"
                @click="choose(index)"
            >
                <span class="option-label">{{ item.label }}</span>
                <span class="option-meta">
                    <span v-if="item.count !== undefined" class="option-count tnum">{{ item.count }}</span>
                    <svg
                        v-if="String(item.value) === String(modelValue)"
                        class="option-check"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                    >
                        <path d="m5 12 5 5 9-10" />
                    </svg>
                </span>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.app-select {
    position: relative;
    width: 100%;
}

.select-trigger {
    width: 100%;
    height: 44px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 1px solid var(--glass-border-soft);
    border-radius: var(--radius-md);
    background: var(--glass-ctl-bg);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-sm);
    cursor: pointer;
    backdrop-filter: blur(18px) saturate(180%);
    -webkit-backdrop-filter: blur(18px) saturate(180%);
    transition:
        border-color var(--duration-fast) var(--ease),
        box-shadow var(--duration-fast) var(--ease);
}

.select-trigger:hover {
    border-color: var(--glass-border-soft);
    background: var(--color-surface-hover);
}

.select-trigger:focus-visible,
.select-trigger.is-open {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
}

.select-chevron {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast) var(--ease);
}

.select-trigger.is-open .select-chevron {
    transform: rotate(180deg);
}

.select-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: max(100%, 240px);
    max-width: 320px;
    max-height: 280px;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--glass-border-soft);
    border-radius: var(--radius-md);
    background: var(--color-surface-solid);
    box-shadow: var(--shadow-lg);
    overscroll-behavior: contain;
}

.select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 36px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
}

.select-option.is-active {
    background: var(--color-accent-soft);
    color: var(--color-text);
}

.select-option.is-selected {
    color: var(--color-accent);
}

.option-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.option-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
}

.option-check {
    width: 14px;
    height: 14px;
    color: var(--color-accent);
}

@media (prefers-reduced-motion: reduce) {
    .select-trigger,
    .select-chevron {
        transition: none;
    }
}
</style>
