<template>
  <KanbanColumn
    :ref="setHeaderColumnRef"
    :column="column"
    :columnIndex="columnIndex"
    :config="config"
    :totalOverride="columnTotalAcrossLanes"
    header-only
    class="swimlane-column swimlane-column--header"
  />
</template>

<script setup>
import { computed, inject, onBeforeUnmount } from 'vue'
import { useStore } from 'vuex'
import KanbanColumn from './KanbanColumn.vue'

const props = defineProps({
  column: { type: Object, required: true },
  columnIndex: { type: Number, required: true },
  config: { type: Object, required: true },
})

const store = useStore()
const registerHeaderColumnRef = inject('registerHeaderColumnRef', null)

function setHeaderColumnRef(el) {
  registerHeaderColumnRef?.(props.columnIndex, el)
}

onBeforeUnmount(() => {
  registerHeaderColumnRef?.(props.columnIndex, null)
})

const lanes = computed(() => store.getters.getLanes)
const columnTotalAcrossLanes = computed(() => {
  let sum = 0
  let any = false
  for (const lane of lanes.value) {
    const total = store.getters.getCellTotal(lane.key, props.column.column_name)
    if (Number.isFinite(total)) {
      sum += total
      any = true
    }
  }
  return any ? sum : null
})
</script>
