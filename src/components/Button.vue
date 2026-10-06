<script setup>
defineProps({
    label: {
        type: String,
        required: true,
    },
    // primary | secondary | ghost | danger
    variant: {
        type: String,
        default: 'primary',
    },
    type: {
        type: String,
        default: 'button',
    },
})

defineEmits(['click'])
</script>

<template>
    <button :type="type" class="btn" :class="`btn-${variant}`" @click="$emit('click')">
        {{ label }}
    </button>
</template>
