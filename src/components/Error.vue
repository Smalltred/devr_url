<script setup>
import { useShortUrl } from '../stores/shortUrl'

const { error } = useShortUrl()
</script>

<template>
    <div v-if="error" class="py-4 font-mono text-lg text-red-600">
        {{ error }}
    </div>
</template>
