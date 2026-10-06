<script setup>
import { useShortUrl } from '../stores/shortUrl'

const { error } = useShortUrl()
</script>

<template>
    <p v-if="error" class="mt-3 text-sm font-medium text-danger">
        {{ error }}
    </p>
</template>
