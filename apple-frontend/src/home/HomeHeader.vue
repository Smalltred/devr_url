<script setup>
/**
 * 首页顶栏与标题区。
 *
 * 排版：大标题走负字距（字越大越要收紧），副标题用次级文本色。
 * 层级靠「字重 + 字号 + 行高」的组合建立，不靠单一放大字号。
 */
import AppThemeToggle from '../components/AppThemeToggle.vue'

// 未登录（或会话查询失败）时不显示后台入口，避免把管理入口暴露给访客。
// adminHref 由后端按当前安全入口下发（默认 /admin）。
defineProps({
    adminHref: { type: String, default: '' },
})
</script>

<template>
    <header class="pt-6">
        <div class="flex items-center justify-end gap-2">
            <a v-if="adminHref" :href="adminHref" class="btn btn-ghost btn-sm">管理后台</a>
            <AppThemeToggle />
        </div>

        <div class="mt-14 text-center sm:mt-20">
            <h1 class="type-3xl sm:text-[3rem] sm:leading-[1.05] sm:tracking-[-0.024em]">
                Devr 短链接
            </h1>
            <p class="type-lg mt-4 font-normal text-ink-2" style="font-weight: var(--weight-regular)">
                简单易用的短链接生成工具，链接永久有效！
            </p>
        </div>
    </header>
</template>
