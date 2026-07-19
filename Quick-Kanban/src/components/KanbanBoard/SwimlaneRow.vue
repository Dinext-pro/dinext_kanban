<template>
  <section
    ref="laneRef"
    class="swimlane-lane"
    :class="{
      'swimlane-lane--expanded': expanded,
      'swimlane-lane--collapsed': !expanded,
    }"
    :data-lane-key="lane.key"
    :aria-label="__('Swimlane {0}', [laneLabel])"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
  >
    <div
      class="swimlane-lane-sticky"
      role="button"
      tabindex="0"
      :aria-expanded="String(expanded)"
      :aria-label="expanded
        ? __('Collapse swimlane {0}', [laneLabel])
        : __('Expand swimlane {0}', [laneLabel])"
      @click="onToggle"
      @keydown.enter.prevent="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <header class="swimlane-lane-header">
        <span class="swimlane-lane-toggle">
          <span
            class="swimlane-lane-chevron"
            :class="{ 'swimlane-lane-chevron--collapsed': !expanded }"
            aria-hidden="true"
          >▾</span>
          <span
            v-if="showAssigneeAvatar"
            ref="avatarMountRef"
            class="swimlane-lane-avatar"
            aria-hidden="true"
          />
          <span class="swimlane-lane-title">{{ laneLabel }}</span>
          <span class="swimlane-lane-count">{{ laneTotalDisplay }}</span>
        </span>
      </header>

      <div
        class="swimlane-chrome-row"
        :style="gridStyle"
        aria-hidden="true"
      >
        <div
          v-for="column in columns"
          :key="`chrome-${lane.key}-${column.column_name}`"
          class="swimlane-chrome-cell"
          :class="{ 'swimlane-chrome-cell--collapsed': isColumnCollapsed(column) }"
          :data-column-value="column.column_name"
          :style="columnTrackStyle(column)"
        />
      </div>
    </div>

    <div
      v-show="rowMounted"
      ref="rowRef"
      class="swimlane-row"
      :class="{
        'swimlane-row--expanded': expanded,
        'swimlane-row--collapsed': !expanded,
        'swimlane-row--animating': rowAnimating,
      }"
      :style="gridStyle"
    >
      <template
        v-for="(column, columnIndex) in columns"
        :key="`${lane.key}-${column.column_name}`"
      >
        <div
          v-if="isColumnCollapsed(column)"
          class="swimlane-cell-spacer"
          :data-column-value="column.column_name"
          :style="columnTrackStyle(column)"
          aria-hidden="true"
          @pointerenter="onCollapsedColumnPointerEnter(column)"
          @pointerleave="onCollapsedColumnPointerLeave"
          @dragenter="onCollapsedColumnDragEnter(column, $event)"
          @dragleave="onCollapsedColumnDragLeave"
        />
        <SwimlaneGroup
          v-else
          :lane="lane"
          :laneIndex="laneIndex"
          :column="column"
          :columnIndex="columnIndex"
          :config="config"
          :scroller="scroller"
          :contentVisible="rowMounted"
          @dragstart="onGroupDragStart"
          @drop="onGroupDrop"
        />
      </template>
    </div>
  </section>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
} from 'vue'
import { useStore } from 'vuex'
import SwimlaneGroup from './SwimlaneGroup.vue'
import {
  COLUMN_DRAG_EXPAND_DELAY_MS,
  getColumnKey,
  getIndicatorClass,
  LANE_DRAG_EXPAND_DELAY_MS,
} from '../../utils/kanban'
import { prefersReducedMotion } from '../../utils/cardRollbackAnimation'
import { animateLaneRowHeight } from '../../utils/laneExpandAnimation'
import {
  applyColumnStickRooms,
  clearColumnStickRooms,
} from '../../utils/swimlaneBoard'

const props = defineProps({
  lane: { type: Object, required: true },
  laneIndex: { type: Number, required: true },
  columns: { type: Array, required: true },
  config: { type: Object, required: true },
  gridTemplateColumns: { type: String, required: true },
  scroller: { type: Object, default: null },
})

const emits = defineEmits(['dragstart', 'drop'])

const store = useStore()
const __ = globalThis.__
const laneRef = ref(null)
const rowRef = ref(null)
const avatarMountRef = ref(null)
const isIntersecting = ref(false)
const rowMounted = ref(false)
const rowAnimating = ref(false)
const animationReady = ref(false)
let hoverExpandTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let columnExpandOnDragTimer = null
/** @type {string | null} */
let columnExpandOnDragKey = null
let stickRoomRaf = null
let stickRoomRetryTimers = []
let stickRoomResizeObserver = null
let intersectionObserver = null
/** @type {null | (() => void)} */
let laneAnimCancel = null
let laneAnimToken = 0
let awaitingExpandAnim = false

const expanded = computed(() => store.getters.isLaneExpanded(props.lane.key))
const hydrationStatus = computed(() => store.state.laneHydration[String(props.lane.key)])
const laneLabel = computed(() => props.lane.label || props.lane.key || __('Unassigned'))
const laneTotal = computed(() => store.getters.getLaneTotal(props.lane.key))
const laneTotalDisplay = computed(() => (
  Number.isFinite(laneTotal.value) ? String(laneTotal.value) : '…'
))
const showAssigneeAvatar = computed(() => (
  props.config?.swimlane_mode === 'assign' && Boolean(props.lane?.key)
))
const gridStyle = computed(() => ({
  gridTemplateColumns: props.gridTemplateColumns,
}))
const activeDrag = computed(() => store.getters.activeDragCard)
const laneCardSignature = computed(() => (
  (props.lane.columns || [])
    .map((column) => `${column.column_name}:${column.cards?.length || 0}`)
    .join('|')
))

function clearAssigneeAvatar() {
  avatarMountRef.value?.replaceChildren()
}

function renderAssigneeAvatar() {
  const mount = avatarMountRef.value
  if (!mount || !showAssigneeAvatar.value) {
    clearAssigneeAvatar()
    return
  }
  const avatarHtml = globalThis.frappe?.avatar?.(
    String(props.lane.key),
    'avatar-small',
  )
  if (!avatarHtml) {
    clearAssigneeAvatar()
    return
  }
  mount.innerHTML = avatarHtml
}

function resolveScrollElement(scroller) {
  if (!scroller) {
    return null
  }
  if (scroller instanceof Element) {
    return scroller
  }
  if (scroller?.$el instanceof Element) {
    return scroller.$el
  }
  if (scroller?.value instanceof Element) {
    return scroller.value
  }
  return null
}

function maybeHydrateLane() {
  if (!expanded.value || !isIntersecting.value) {
    return
  }
  store.dispatch('ensureLaneHydrated', { laneKey: props.lane.key })
}

function cancelLaneAnim() {
  if (laneAnimCancel) {
    laneAnimCancel()
    laneAnimCancel = null
  }
}

function clipRowClosed() {
  const el = rowRef.value
  if (el) {
    el.style.maxHeight = '0px'
  }
}

function clearRowMaxHeight() {
  const el = rowRef.value
  if (el) {
    el.style.maxHeight = ''
  }
}

function hydrationSettled(status = hydrationStatus.value) {
  return status === 'ready' || status === 'idle'
}

async function playExpandAnimation() {
  if (!awaitingExpandAnim || !expanded.value) {
    return
  }
  awaitingExpandAnim = false
  const token = ++laneAnimToken
  await nextTick()
  if (token !== laneAnimToken || !expanded.value) {
    return
  }
  const el = rowRef.value
  if (!el) {
    rowAnimating.value = false
    return
  }
  if (!animationReady.value || prefersReducedMotion()) {
    clearRowMaxHeight()
    rowAnimating.value = false
    scheduleStickRoomUpdate()
    return
  }
  cancelLaneAnim()
  rowAnimating.value = true
  const { cancel } = animateLaneRowHeight(el, {
    direction: 'expand',
    onDone: () => {
      if (token !== laneAnimToken) {
        return
      }
      rowAnimating.value = false
      laneAnimCancel = null
      scheduleStickRoomUpdate()
    },
  })
  laneAnimCancel = cancel
}

async function beginExpandSequence() {
  cancelLaneAnim()
  laneAnimToken += 1
  rowMounted.value = true
  rowAnimating.value = true
  awaitingExpandAnim = true
  await nextTick()
  clipRowClosed()
  maybeHydrateLane()
  if (hydrationSettled()) {
    await playExpandAnimation()
  }
}

async function beginCollapseSequence() {
  awaitingExpandAnim = false
  cancelLaneAnim()
  const token = ++laneAnimToken
  rowMounted.value = true
  await nextTick()
  const el = rowRef.value
  if (!el || !animationReady.value || prefersReducedMotion()) {
    clearRowMaxHeight()
    rowMounted.value = false
    rowAnimating.value = false
    return
  }
  rowAnimating.value = true
  const { cancel } = animateLaneRowHeight(el, {
    direction: 'collapse',
    onDone: () => {
      if (token !== laneAnimToken) {
        return
      }
      rowAnimating.value = false
      rowMounted.value = false
      laneAnimCancel = null
    },
  })
  laneAnimCancel = cancel
}

function unbindIntersectionObserver() {
  if (intersectionObserver) {
    intersectionObserver.disconnect()
    intersectionObserver = null
  }
}

function bindIntersectionObserver() {
  unbindIntersectionObserver()
  const target = laneRef.value
  if (!target || typeof IntersectionObserver === 'undefined') {
    return
  }
  const root = resolveScrollElement(props.scroller)
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      isIntersecting.value = Boolean(entry?.isIntersecting)
      maybeHydrateLane()
    },
    {
      root: root || null,
      rootMargin: '200px 0px',
      threshold: 0,
    },
  )
  intersectionObserver.observe(target)
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

function updateStickRooms() {
  if (!rowMounted.value) {
    clearColumnStickRooms(rowRef.value)
    return
  }
  applyColumnStickRooms(rowRef.value)
}

function clearStickRoomRetries() {
  stickRoomRetryTimers.forEach((id) => clearTimeout(id))
  stickRoomRetryTimers = []
}

function scheduleStickRoomUpdate() {
  if (stickRoomRaf != null) {
    return
  }
  stickRoomRaf = requestAnimationFrame(() => {
    stickRoomRaf = null
    updateStickRooms()
    observeStickRoomTargets()
    // VirtualList often finalizes height after the first frame / store paint.
    clearStickRoomRetries()
    for (const delay of [0, 50, 200]) {
      stickRoomRetryTimers.push(setTimeout(() => {
        updateStickRooms()
        observeStickRoomTargets()
      }, delay))
    }
  })
}

function unbindStickRoomObserver() {
  if (stickRoomResizeObserver) {
    stickRoomResizeObserver.disconnect()
    stickRoomResizeObserver = null
  }
}

function observeStickRoomTargets() {
  const rowEl = rowRef.value
  if (!rowEl || !stickRoomResizeObserver) {
    return
  }
  stickRoomResizeObserver.observe(rowEl)
  rowEl.querySelectorAll('.kanban-column--cell.kanban-column--external-scroller').forEach((cell) => {
    stickRoomResizeObserver.observe(cell)
    const list = cell.querySelector('.kanban-card-list')
    if (list) {
      stickRoomResizeObserver.observe(list)
    }
  })
}

function bindStickRoomObserver() {
  unbindStickRoomObserver()
  const rowEl = rowRef.value
  if (!rowEl || !rowMounted.value || typeof ResizeObserver === 'undefined') {
    return
  }
  stickRoomResizeObserver = new ResizeObserver(() => {
    observeStickRoomTargets()
    scheduleStickRoomUpdate()
  })
  observeStickRoomTargets()
}

function onToggle() {
  store.dispatch('toggleLaneExpanded', { laneKey: props.lane.key })
}

function onPointerEnter() {
  if (!activeDrag.value?.cardName || expanded.value) {
    return
  }
  clearTimeout(hoverExpandTimer)
  hoverExpandTimer = setTimeout(() => {
    store.dispatch('setDragExpandedLane', { laneKey: props.lane.key })
  }, LANE_DRAG_EXPAND_DELAY_MS)
}

function onPointerLeave() {
  clearTimeout(hoverExpandTimer)
  hoverExpandTimer = null
}

function clearColumnExpandOnDragTimer() {
  if (columnExpandOnDragTimer) {
    clearTimeout(columnExpandOnDragTimer)
    columnExpandOnDragTimer = null
  }
  columnExpandOnDragKey = null
}

function scheduleColumnExpandOnDrag(column) {
  const columnKey = getColumnKey(column)
  if (!columnKey || !activeDrag.value?.cardName) {
    return
  }
  if (!store.getters.isColumnCollapsed(columnKey)) {
    return
  }
  if (columnExpandOnDragTimer && columnExpandOnDragKey === columnKey) {
    return
  }
  clearColumnExpandOnDragTimer()
  columnExpandOnDragKey = columnKey
  columnExpandOnDragTimer = setTimeout(() => {
    columnExpandOnDragTimer = null
    columnExpandOnDragKey = null
    if (
      store.getters.isColumnCollapsed(columnKey)
      && activeDrag.value?.cardName
    ) {
      store.commit('SET_COLUMN_COLLAPSED', { columnKey, collapsed: false })
    }
  }, COLUMN_DRAG_EXPAND_DELAY_MS)
}

function isLeavingSpacer(event) {
  const related = event.relatedTarget
  const root = event.currentTarget
  if (!(related instanceof Node) || !(root instanceof Node)) {
    return true
  }
  return !root.contains(related)
}

function onCollapsedColumnPointerEnter(column) {
  scheduleColumnExpandOnDrag(column)
}

function onCollapsedColumnPointerLeave(event) {
  if (isLeavingSpacer(event)) {
    clearColumnExpandOnDragTimer()
  }
}

function onCollapsedColumnDragEnter(column, event) {
  event.preventDefault?.()
  scheduleColumnExpandOnDrag(column)
}

function onCollapsedColumnDragLeave(event) {
  if (isLeavingSpacer(event)) {
    clearColumnExpandOnDragTimer()
  }
}

function onGroupDragStart(context) {
  emits('dragstart', context)
}

function onGroupDrop(event) {
  emits('drop', event)
}

watch(
  () => [rowMounted.value, laneCardSignature.value, props.gridTemplateColumns],
  async () => {
    await nextTick()
    bindStickRoomObserver()
    scheduleStickRoomUpdate()
    await nextTick()
    scheduleStickRoomUpdate()
  },
  { immediate: true, flush: 'post' },
)

watch(
  () => props.lane,
  () => scheduleStickRoomUpdate(),
  { deep: true, flush: 'post' },
)

watch(
  expanded,
  (isExpanded) => {
    maybeHydrateLane()
    if (!animationReady.value) {
      rowMounted.value = isExpanded
      return
    }
    if (isExpanded) {
      beginExpandSequence()
    } else {
      beginCollapseSequence()
    }
  },
)

watch(
  hydrationStatus,
  (status) => {
    if (!expanded.value || !animationReady.value || !awaitingExpandAnim) {
      return
    }
    if (hydrationSettled(status)) {
      playExpandAnimation()
    }
  },
)

watch(
  () => props.scroller,
  async () => {
    await nextTick()
    bindIntersectionObserver()
    maybeHydrateLane()
  },
)

watch(
  () => [showAssigneeAvatar.value, props.lane?.key, laneLabel.value],
  () => nextTick(renderAssigneeAvatar),
  { flush: 'post' },
)

onMounted(() => {
  rowMounted.value = expanded.value
  nextTick(() => {
    if (expanded.value) {
      clearRowMaxHeight()
    }
    animationReady.value = true
    bindStickRoomObserver()
    scheduleStickRoomUpdate()
    bindIntersectionObserver()
    maybeHydrateLane()
    renderAssigneeAvatar()
  })
})

onUpdated(() => {
  scheduleStickRoomUpdate()
})

onBeforeUnmount(() => {
  clearTimeout(hoverExpandTimer)
  hoverExpandTimer = null
  clearColumnExpandOnDragTimer()
  cancelLaneAnim()
  awaitingExpandAnim = false
  clearAssigneeAvatar()
  if (stickRoomRaf != null) {
    cancelAnimationFrame(stickRoomRaf)
    stickRoomRaf = null
  }
  clearStickRoomRetries()
  unbindStickRoomObserver()
  unbindIntersectionObserver()
  clearColumnStickRooms(rowRef.value)
})

defineExpose({
  updateStickRooms,
  scheduleStickRoomUpdate,
  maybeHydrateLane,
})
</script>
