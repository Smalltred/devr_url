<script setup>
import Header from './components/Header.vue'
import Search from './components/Search.vue'
import Result from './components/Result.vue'
</script>

<template>
    <div class="container mx-auto px-12">
        <div class="min-h-screen">
            <Header />
            <div>
                <Search />
                <Result />
            </div>
        </div>
    </div>
</template>
