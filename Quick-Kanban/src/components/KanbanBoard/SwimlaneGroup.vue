<template>
  <section
    class="swimlane-group"
    :class="{
      'swimlane-group--expanded': showBody,
      'swimlane-group--collapsed': !showBody,
    }"
    :data-lane-key="lane.key"
    :data-column-value="column.column_name"
    :style="columnTrackStyle"
  >
    <div
      v-show="showBody"
      class="swimlane-group-body"
    >
      <KanbanColumn
        v-if="cellColumn"
        :ref="setCellColumnRef"
        :column="cellColumn"
        :columnIndex="columnIndex"
        :laneIndex="laneIndex"
        :laneKey="lane.key"
        :listId="encodeCellListId(laneIndex, columnIndex)"
        :config="config"
        :externalScroller="scroller"
        hide-header
        hide-resize
        @dragstart="onColumnDragStart"
        @drop="onColumnDrop"
      />
    </div>
  </section>
</template>

<script setup>
import { computed, inject, onBeforeUnmount } from 'vue'
import { useStore } from 'vuex'
import KanbanColumn from './KanbanColumn.vue'
import { getIndicatorClass } from '../../utils/kanban'
import { encodeCellListId } from '../../utils/swimlaneBoard'

const props = defineProps({
  lane: { type: Object, required: true },
  laneIndex: { type: Number, required: true },
  column: { type: Object, required: true },
  columnIndex: { type: Number, required: true },
  config: { type: Object, required: true },
  scroller: { type: Object, default: null },
  /** Keep body mounted during parent lane collapse/expand animation. */
  contentVisible: { type: Boolean, default: undefined },
})

const emits = defineEmits(['dragstart', 'drop'])

const store = useStore()
const registerCellColumnRef = inject('registerCellColumnRef', null)
const cellListId = computed(() => encodeCellListId(props.laneIndex, props.columnIndex))

function setCellColumnRef(el) {
  registerCellColumnRef?.(cellListId.value, el)
}

onBeforeUnmount(() => {
  registerCellColumnRef?.(cellListId.value, null)
})

const cellColumn = computed(() => {
  const columns = props.lane.columns || []
  const byName = columns.find((column) => column.column_name === props.column.column_name)
  if (byName) {
    return byName
  }
  return columns[props.columnIndex] || null
})
const expanded = computed(() => store.getters.isLaneExpanded(props.lane.key))
const showBody = computed(() => (
  props.contentVisible === undefined ? expanded.value : props.contentVisible
))
const indicatorClass = computed(() => getIndicatorClass(props.column.indicator))
const columnTrackStyle = computed(() => ({
  backgroundColor: `var(--kanban-column-${indicatorClass.value})`,
  color: `var(--text-on-${indicatorClass.value}, var(--text-color))`,
}))

function onColumnDragStart(context) {
  store.commit('SET_DRAG_SOURCE_LANE', props.lane.key)
  emits('dragstart', {
    ...context,
    fromLaneIndex: props.laneIndex,
    fromLaneKey: props.lane.key,
  })
}

function onColumnDrop(event) {
  emits('drop', {
    ...event,
    laneIndex: props.laneIndex,
    laneKey: props.lane.key,
  })
}
</script>
