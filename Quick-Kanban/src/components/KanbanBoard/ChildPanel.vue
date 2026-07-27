<template>
  <section
    ref="panelRoot"
    class="child-panel"
    :class="{
      'child-panel--nested': depth > 0,
      'child-panel--teleported': teleported,
      'child-panel--viewport-fill': isViewportFill,
    }"
    :data-child-scope="scopeId"
    :data-child-depth="depth"
    :aria-label="__('Child records of {0}', [parentName])"
    :style="panelStyle"
  >
    <div
      class="child-panel-scroll"
      :style="gridStyle"
    >
      <template
        v-for="(column, columnIndex) in boardColumns"
        :key="`${scopeId}-${column.column_name}`"
      >
        <section
          class="child-panel-group"
          :data-column-value="column.column_name"
          :style="columnTrackStyle(column)"
        >
          <!--
            Keep KanbanColumn mounted while collapsed (v-show) so VirtualList /
            sortable-dnd survive expand. Spacer is the collapsed hit target only.
          -->
          <div
            v-if="isColumnCollapsed(column)"
            class="child-panel-cell-spacer"
            :data-column-value="column.column_name"
            aria-hidden="true"
            @pointerenter="onCollapsedSpacerPointerEnter(column)"
            @pointerleave="onCollapsedSpacerPointerLeave"
            @dragenter.prevent="onCollapsedSpacerPointerEnter(column)"
            @dragleave="onCollapsedSpacerPointerLeave"
            @dblclick="onCollapsedColumnDblclick(column)"
          />
          <KanbanColumn
            v-if="panelColumn(columnIndex)"
            v-show="!isColumnCollapsed(column)"
            :column="panelColumn(columnIndex)"
            :columnIndex="columnIndex"
            :listId="encodeChildListId(ordinal, columnIndex)"
            :config="config"
            :childScopeId="scopeId"
            :childDepth="depth + 1"
            hide-header
            hide-resize
            @dragstart="onColumnDragStart"
            @drop="onColumnDrop"
          />
        </section>
      </template>
    </div>
  </section>
</template>

<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useStore } from 'vuex'
import KanbanColumn from './KanbanColumn.vue'
import {
  COLUMN_DRAG_EXPAND_DELAY_MS,
  getColumnKey,
  getIndicatorClass,
} from '../../utils/kanban'
import {
  childPanelColumnTintValue,
  encodeChildListId,
} from '../../utils/childPanelBoard'

const props = defineProps({
  parentName: { type: String, required: true },
  depth: { type: Number, default: 0 },
  scopeId: { type: String, required: true },
  config: { type: Object, required: true },
  teleported: { type: Boolean, default: false },
  hostRect: { type: Object, default: null },
})

const emits = defineEmits(['dragstart', 'drop', 'height-change'])

const store = useStore()
const __ = globalThis.__
const boardColumnTracks = inject('boardColumnTracks', computed(() => ''))
const panelRoot = ref(null)
let resizeObserver = null
let expandOnDragTimer = null
const activeDrag = computed(() => store.getters.activeDragCard)

const panel = computed(() => store.getters.getChildPanel(props.scopeId))
const ordinal = computed(() => panel.value?.ordinal ?? 0)
const boardColumns = computed(() => store.state.columns || [])
const swimlanesEnabled = computed(() => store.getters.swimlanesEnabled)
const isViewportFill = computed(() => {
  const maxDepth = store.getters.maxOpenChildPanelDepth
  return maxDepth != null && Number(props.depth) === maxDepth
})
const columnTintStyle = computed(() => ({
  '--child-panel-column-tint': childPanelColumnTintValue(
    props.depth,
    swimlanesEnabled.value,
  ),
}))
const gridStyle = computed(() => ({
  gridTemplateColumns: boardColumnTracks.value || undefined,
}))
const panelStyle = computed(() => {
  const tint = columnTintStyle.value
  if (!props.teleported || !props.hostRect) {
    return tint
  }
  const style = {
    ...tint,
    position: 'absolute',
    top: `${props.hostRect.top}px`,
    left: `${props.hostRect.left}px`,
    width: `${props.hostRect.width}px`,
    zIndex: 50 + Math.max(0, Number(props.depth) || 0),
  }
  if (Number.isFinite(props.hostRect.height) && props.hostRect.height > 0) {
    style.height = `${props.hostRect.height}px`
    style.overflow = 'hidden'
  }
  return style
})

function panelColumn(columnIndex) {
  return panel.value?.columns?.[columnIndex] || null
}

function isColumnCollapsed(column) {
  return store.getters.isColumnCollapsed(getColumnKey(column))
}

function columnTrackStyle(column) {
  const indicator = getIndicatorClass(column.indicator)
  return {
    backgroundColor: `var(--kanban-column-${indicator})`,
  }
}

function onCollapsedColumnDblclick(column) {
  const columnKey = getColumnKey(column)
  if (!columnKey) {
    return
  }
  store.commit('SET_COLUMN_COLLAPSED', {
    columnKey,
    collapsed: !store.getters.isColumnCollapsed(columnKey),
  })
}

function clearExpandOnDragTimer() {
  if (expandOnDragTimer) {
    clearTimeout(expandOnDragTimer)
    expandOnDragTimer = null
  }
}

function scheduleExpandCollapsedColumn(column) {
  const drag = activeDrag.value
  if (!drag?.cardName || drag.childScopeId !== props.scopeId) {
    return
  }
  const columnKey = getColumnKey(column)
  if (!columnKey || !store.getters.isColumnCollapsed(columnKey)) {
    return
  }
  if (expandOnDragTimer) {
    return
  }
  expandOnDragTimer = setTimeout(() => {
    expandOnDragTimer = null
    const stillDragging = activeDrag.value
    if (
      !stillDragging?.cardName
      || stillDragging.childScopeId !== props.scopeId
    ) {
      return
    }
    if (store.getters.isColumnCollapsed(columnKey)) {
      store.commit('SET_COLUMN_COLLAPSED', {
        columnKey,
        collapsed: false,
      })
    }
  }, COLUMN_DRAG_EXPAND_DELAY_MS)
}

function onCollapsedSpacerPointerEnter(column) {
  scheduleExpandCollapsedColumn(column)
}

function onCollapsedSpacerPointerLeave() {
  clearExpandOnDragTimer()
}

function onColumnDragStart(event) {
  emits('dragstart', {
    ...event,
    childScopeId: props.scopeId,
    childDepth: props.depth,
  })
}

function onColumnDrop(event) {
  emits('drop', {
    ...event,
    childScopeId: props.scopeId,
    childDepth: props.depth,
  })
}

function emitHeight() {
  const height = panelRoot.value?.offsetHeight || 0
  emits('height-change', height)
}

onMounted(async () => {
  await nextTick()
  emitHeight()
  if (typeof ResizeObserver !== 'undefined' && panelRoot.value) {
    resizeObserver = new ResizeObserver(() => emitHeight())
    resizeObserver.observe(panelRoot.value)
  }
})

watch(
  () => panel.value?.columns?.map((column) => column.cards?.length).join(','),
  async () => {
    await nextTick()
    emitHeight()
  },
)

onBeforeUnmount(() => {
  clearExpandOnDragTimer()
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>
