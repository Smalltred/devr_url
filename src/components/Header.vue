<script setup>
import ThemeToggle from './ThemeToggle.vue'
</script>

<template>
    <header class="pt-6">
        <div class="flex items-center justify-between">
            <span class="text-lg font-semibold tracking-tight">devr</span>
            <ThemeToggle />
        </div>
        <div class="mt-16 text-center sm:mt-24">
            <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">devr 短链接</h1>
            <p class="mt-4 text-lg text-ink-2">简单易用的短链接生成工具，链接永久有效！</p>
        </div>
    </header>
</template>
