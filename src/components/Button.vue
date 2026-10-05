<script setup>
defineProps({
    label: {
        type: String,
        required: true,
    },
})

defineEmits(['click'])
</script>

<template>
    <button
        class="px-4 py-3 rounded-lg bg-black border-r-4 border-b-4 border-yellow-500 font-mono font-bold text-lg text-yellow-100"
        @click="$emit('click')"
    >
        {{ label }}
    </button>
</template>
