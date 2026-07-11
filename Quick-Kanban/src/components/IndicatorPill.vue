<template>
  <span
    data-action="indicator"
    class="quick-kanban-indicator-swatch"
    :class="indicator"
    aria-hidden="true"
  ></span>
</template>

<script setup>
defineProps({
  indicator: {
    type: String,
    default: 'gray',
  },
})
</script>
