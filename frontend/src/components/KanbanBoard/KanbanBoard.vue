<template>
  <section class="kanban-shell" :aria-label="__('Kanban board {0}', [config.board_name])">
    <div v-if="error" class="kanban-state kanban-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn btn-default btn-sm" @click="retry">
        {{ __('Retry') }}
      </button>
    </div>

    <div
      v-if="swimlanesEnabled"
      ref="kanbanBoard"
      class="kanban kanban--swimlanes"
      :class="{ 'kanban--child-panel-open': childPanelChromeOpen }"
      tabindex="0"
      :style="swimlaneBoardCssVars"
      :aria-label="__('Kanban columns with swimlane groups. Scroll to see more.')"
    >
      <div class="swimlane-board-content">
        <div
          class="swimlane-column-rails"
          :style="swimlaneColumnRailsStyle"
          aria-hidden="true"
        >
          <div
            v-for="column in columns"
            :key="`rail-${column.column_name}`"
            class="swimlane-column-rail"
            :data-column-value="column.column_name"
            :style="columnRailStyle(column)"
            @dblclick.stop="onColumnRailDblclick(column)"
          />
        </div>
        <div class="swimlane-board-foreground">
          <div
            class="swimlane-header-row"
            :style="swimlaneHeaderGridStyle"
          >
            <SwimlaneColumn
              v-for="(column, columnIndex) in columns"
              :key="column.column_name"
              :column="column"
              :columnIndex="columnIndex"
              :config="config"
            />
            <AddColumnControl />
          </div>
          <SwimlaneRow
            v-for="(lane, laneIndex) in lanes"
            :key="`lane-${lane.key}`"
            :class="{ 'swimlane-lane--last': laneIndex === lanes.length - 1 }"
            :lane="lane"
            :laneIndex="laneIndex"
            :columns="columns"
            :config="config"
            :gridTemplateColumns="swimlaneColumnTracks"
            :scroller="kanbanBoard"
            @dragstart="rememberDrag"
            @drop="dropSwimlane"
          />
        </div>
      </div>
      <p
        v-if="!loading && !error && lanes.length === 0"
        class="kanban-state"
      >
        {{ __('No swimlanes are available for this board.') }}
      </p>
      <p
        v-else-if="!loading && !error && columns.length === 0 && !showAddColumn"
        class="kanban-state"
      >
        {{ __('No columns are configured for this board.') }}
      </p>
      <div
        ref="childPanelPortal"
        class="child-panel-portal"
      >
        <template
          v-for="panel in renderedChildPanels"
          :key="panel.scopeId"
        >
          <Transition
            name="child-panel"
            @after-leave="() => onChildPanelAfterLeave(panel.scopeId)"
          >
            <ChildPanel
              v-if="!panel.exiting && boardHostedPanelRects[panel.scopeId]"
              :parent-name="panel.parentName"
              :depth="panel.depth"
              :scope-id="panel.scopeId"
              :config="config"
              teleported
              :host-rect="boardHostedPanelRects[panel.scopeId]"
              @dragstart="rememberDrag"
              @drop="dropSwimlane"
              @height-change="(height) => onBoardHostedPanelHeight(panel.parentName, height)"
            />
          </Transition>
        </template>
      </div>
    </div>

    <div
      v-else
      ref="kanbanBoard"
      class="kanban"
      :class="{ 'kanban--child-panel-open': childPanelChromeOpen }"
      tabindex="0"
      :aria-label="__('Kanban columns. Scroll horizontally to see more.')"
    >
      <KanbanColumn
        v-for="(column, columnIndex) in columns"
        :key="column.column_name"
        :ref="(el) => setColumnRef(columnIndex, el)"
        :column="column"
        :columnIndex="columnIndex"
        :config="config"
        @dragstart="rememberDrag"
        @drop="drop"
      />
      <AddColumnControl />
      <p
        v-if="!loading && !error && columns.length === 0 && !showAddColumn"
        class="kanban-state"
      >
        {{ __('No columns are configured for this board.') }}
      </p>
      <!--
        Host all open child-panel depths here so overlays start at the board
        content origin (including nested panels) and paint above columns.
      -->
      <div
        ref="childPanelPortal"
        class="child-panel-portal"
        aria-hidden="false"
      >
        <template
          v-for="panel in renderedChildPanels"
          :key="panel.scopeId"
        >
          <Transition
            name="child-panel"
            @after-leave="() => onChildPanelAfterLeave(panel.scopeId)"
          >
            <ChildPanel
              v-if="!panel.exiting && boardHostedPanelRects[panel.scopeId]"
              :parent-name="panel.parentName"
              :depth="panel.depth"
              :scope-id="panel.scopeId"
              :config="config"
              teleported
              :host-rect="boardHostedPanelRects[panel.scopeId]"
              @dragstart="rememberDrag"
              @drop="drop"
              @height-change="(height) => onBoardHostedPanelHeight(panel.parentName, height)"
            />
          </Transition>
        </template>
      </div>
    </div>

    <p class="sr-only" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, provide, watch } from "vue";
import { useStore } from "vuex";
import KanbanColumn from "./KanbanColumn.vue";
import ChildPanel from "./ChildPanel.vue";
import SwimlaneColumn from "./SwimlaneColumn.vue";
import SwimlaneRow from "./SwimlaneRow.vue";
import AddColumnControl from "./AddColumnControl.vue";
import {
  createColumnSortable,
  destroyColumnSortable,
} from "../../utils/columnSortable";
import { createTagDragController } from "../../utils/tagDragDrop";
import {
  animateCardRollback,
  captureCardRect,
  prefersReducedMotion,
} from "../../utils/cardRollbackAnimation";
import { flashMovedCard } from "../../utils/cardMoveFlash";
import {
  resolveComponentRootEl,
  revealCardInChildColumn,
  revealCardInColumn,
  scrollColumnIntoView,
  waitForPaint,
  waitMs,
} from "../../utils/menuMoveScroll";
import {
  decodeCellListId,
  encodeCellListId,
} from "../../utils/swimlaneBoard";
import {
  isChildListId,
  resolveChildPanelDropTarget,
} from "../../utils/childPanelBoard";
import { useBoardHostedChildPanels } from "../../composables/useBoardHostedChildPanels";
import {
  clearCardDropHoverElement,
  completeAppendDrop,
  findAppendDropTarget,
  findCardDropHoverTarget,
  isForbiddenDropHoverTarget,
  setCardDragActive,
  setCardDragForbidden,
  setCardDropHoverElement,
} from "../../utils/cellAppendDrop";
import {
  COLLAPSED_COLUMN_WIDTH_PX,
  COLUMN_COLLAPSE_ANIMATION_MS,
  SWIMLANE_LANE_ANIMATION_MS,
  getColumnKey,
  getIndicatorClass,
  resolveColumnWidthPx,
} from "../../utils/kanban";
import {
  animateColumnTracks,
  formatTrackTemplate,
} from "../../utils/columnCollapseAnimation";
const SWIMLANE_COLUMN_GAP_PX = 8

const store = useStore();
const kanbanBoard = ref(null);
const columns = computed(() => store.getters.getColumns);
const lanes = computed(() => store.getters.getLanes);
const swimlanesEnabled = computed(() => store.getters.swimlanesEnabled);
const config = computed(() => store.getters.getConfig);
const canEditBoard = computed(() => store.getters.canEditBoard);
const showAddColumn = computed(
  () => canEditBoard.value
    && (store.getters.getAddableColumns || []).length > 0,
);

const targetSwimlaneTracks = computed(() => (
  columns.value.map((column) => {
    const key = getColumnKey(column)
    const width = store.getters.isColumnCollapsed(key)
      ? COLLAPSED_COLUMN_WIDTH_PX
      : resolveColumnWidthPx(column)
    return { key, width }
  })
))

const animatedSwimlaneTrackWidths = ref([])
let trackTweenCancel = null
let columnDragActive = false
let lastTrackKeys = ''

function trackKeysSignature(tracks) {
  return (tracks || []).map((track) => track.key).join('\0')
}

function widthsFromTracks(tracks) {
  return (tracks || []).map((track) => Math.round(Number(track.width) || 0))
}

function swimlaneLabelInsetFromWidths(widthsPx) {
  let inset = 0
  for (const width of widthsPx || []) {
    if (width > COLLAPSED_COLUMN_WIDTH_PX) {
      break
    }
    inset += width + SWIMLANE_COLUMN_GAP_PX
  }
  return inset
}

function cancelSwimlaneTrackTween() {
  trackTweenCancel?.()
  trackTweenCancel = null
}

function snapSwimlaneTracks(widthsPx) {
  cancelSwimlaneTrackTween()
  animatedSwimlaneTrackWidths.value = (widthsPx || []).map((w) => Math.round(Number(w) || 0))
}

function syncHostGeometryDuringTrackTween() {
  if (!boardHostedChildPanels.value.length) {
    return
  }
  applyBoardHostedPanelGeometry()
}

function runSwimlaneTrackTween(nextWidths, { animate = true } = {}) {
  const target = (nextWidths || []).map((w) => Math.round(Number(w) || 0))
  const current = animatedSwimlaneTrackWidths.value
  if (
    !animate
    || columnDragActive
    || !current.length
    || current.length !== target.length
  ) {
    snapSwimlaneTracks(target)
    syncHostGeometryDuringTrackTween()
    return
  }
  cancelSwimlaneTrackTween()
  const tween = animateColumnTracks({
    from: current,
    to: target,
    onFrame(widths) {
      animatedSwimlaneTrackWidths.value = widths
      syncHostGeometryDuringTrackTween()
    },
    onDone(widths) {
      animatedSwimlaneTrackWidths.value = widths
      trackTweenCancel = null
      syncHostGeometryDuringTrackTween()
    },
  })
  trackTweenCancel = () => tween.cancel()
}

const swimlaneColumnTracks = computed(() => (
  formatTrackTemplate(animatedSwimlaneTrackWidths.value)
))
/** Flat and swimlane share animated tracks so child-panel columns stay in sync. */
const boardColumnTracks = computed(() => swimlaneColumnTracks.value)
provide('boardColumnTracks', boardColumnTracks)
const childPanelPortal = ref(null)
const {
  renderedChildPanels,
  boardHostedPanelRects,
  childPanelChromeOpen,
  boardHostedChildPanels,
  onBoardHostedPanelHeight,
  onChildPanelAfterLeave,
  applyBoardHostedPanelGeometry,
  restoreBoardHostedPanelPinScrolls,
  disposeBoardHostedChildPanels,
} = useBoardHostedChildPanels({
  kanbanBoard,
  swimlanesEnabled,
  animatedSwimlaneTrackWidths,
  store,
})

const swimlaneLabelInsetPx = computed(() => (
  swimlaneLabelInsetFromWidths(animatedSwimlaneTrackWidths.value)
))
const swimlaneStickyLanesTopPx = ref(0)
const swimlaneBoardCssVars = computed(() => ({
  '--swimlane-label-inset': `${swimlaneLabelInsetPx.value}px`,
  '--swimlane-sticky-lanes-top': `${swimlaneStickyLanesTopPx.value}px`,
}))
const swimlaneHeaderGridTemplateColumns = computed(() => {
  if (!showAddColumn.value) {
    return swimlaneColumnTracks.value
  }
  return `${swimlaneColumnTracks.value} max-content`.trim()
})
const swimlaneHeaderGridStyle = computed(() => ({
  gridTemplateColumns: swimlaneHeaderGridTemplateColumns.value,
}))
const swimlaneColumnRailsStyle = computed(() => ({
  gridTemplateColumns: swimlaneColumnTracks.value,
}))

watch(
  targetSwimlaneTracks,
  (nextTracks) => {
    const nextWidths = widthsFromTracks(nextTracks)
    const nextKeys = trackKeysSignature(nextTracks)
    const keysChanged = nextKeys !== lastTrackKeys
    lastTrackKeys = nextKeys
    runSwimlaneTrackTween(nextWidths, { animate: !keysChanged })
  },
  { immediate: true, deep: true },
)

watch(swimlanesEnabled, () => {
  cancelSwimlaneTrackTween()
  lastTrackKeys = trackKeysSignature(targetSwimlaneTracks.value)
  snapSwimlaneTracks(widthsFromTracks(targetSwimlaneTracks.value))
  syncHostGeometryDuringTrackTween()
})

function columnRailStyle(column) {
  const indicator = getIndicatorClass(column.indicator)
  return {
    backgroundColor: `var(--kanban-column-${indicator})`,
  }
}

function onColumnRailDblclick(column) {
  const columnKey = getColumnKey(column)
  if (!columnKey) {
    return
  }
  store.commit('SET_COLUMN_COLLAPSED', {
    columnKey,
    collapsed: !store.getters.isColumnCollapsed(columnKey),
  })
}

const columnRefs = ref([])
const headerColumnRefs = ref({})
const cellColumnRefs = ref({})
/** scopeId → { [columnIndex]: component handle } */
const childColumnRefs = ref({})
const loading = computed(() => store.state.loading)
const error = computed(() => store.state.error)
const announcement = computed(() => store.state.announcement)
const __ = globalThis.__
let dragContext = null
let hydrationToken = 0
let columnSortable = null
let tagDragController = null
let onMouseDown
let onMouseLeave
let onMouseUp
let onMouseMove

let onPointerUp
let onPointerCancel
let onAppendDropPointerUpCapture
let onAppendDropMouseUpCapture
let onCardDropHoverPointerMove
let suppressSortableMouseUp = false
let dropHoverEl = null
let dropHoverRaf = 0
let swimlaneLayoutResizeObserver = null

const currentBoardName = () => frappe.get_route()[3]

function updateSwimlaneLayoutMetrics() {
  const board = kanbanBoard.value
  if (!board || !swimlanesEnabled.value) {
    swimlaneStickyLanesTopPx.value = 0
    return
  }
  const headerRow = board.querySelector('.swimlane-header-row')
  const headerHeight = headerRow
    ? Math.ceil(headerRow.getBoundingClientRect().height)
    : 0
  swimlaneStickyLanesTopPx.value = headerHeight
}

async function scheduleSwimlaneLayoutMetricsUpdate() {
  await nextTick()
  updateSwimlaneLayoutMetrics()
  // Column pills / fonts can settle after the first paint.
  requestAnimationFrame(() => {
    updateSwimlaneLayoutMetrics()
  })
}

function setupSwimlaneStickyTopObserver() {
  teardownSwimlaneStickyTopObserver()
  const board = kanbanBoard.value
  if (!board || !swimlanesEnabled.value) {
    swimlaneStickyLanesTopPx.value = 0
    return
  }
  scheduleSwimlaneLayoutMetricsUpdate()
  if (typeof ResizeObserver === 'undefined') {
    return
  }
  swimlaneLayoutResizeObserver = new ResizeObserver(() => {
    scheduleSwimlaneLayoutMetricsUpdate()
  })
  swimlaneLayoutResizeObserver.observe(board)
  const headerRow = board.querySelector('.swimlane-header-row')
  if (headerRow) {
    swimlaneLayoutResizeObserver.observe(headerRow)
  }
}

function teardownSwimlaneStickyTopObserver() {
  swimlaneLayoutResizeObserver?.disconnect()
  swimlaneLayoutResizeObserver = null
}

tagDragController = createTagDragController({
  store,
  getDoctype: () => store.state.config?.ref_doctype || '',
  onDrop: (payload) => store.dispatch('persistTagTransfer', payload),
})
provide('tagDragController', tagDragController)

function clearDropHover() {
  if (dropHoverRaf) {
    cancelAnimationFrame(dropHoverRaf)
    dropHoverRaf = 0
  }
  clearCardDropHoverElement(dropHoverEl)
  dropHoverEl = null
  setCardDragForbidden(false)
}

function clearActiveDragVisual() {
  clearDropHover()
  setCardDragActive(false)
  store.commit('SET_ACTIVE_DRAG', null)
}

function updateDropHoverFromPoint(clientX, clientY) {
  if (!(store.state.activeDrag || dragContext)?.cardName) {
    clearDropHover()
    return
  }
  const hit = findCardDropHoverTarget(clientX, clientY)
  const forbidden = isForbiddenDropHoverTarget(hit)
  setCardDragForbidden(forbidden)
  if (forbidden) {
    dropHoverEl = setCardDropHoverElement(null, dropHoverEl)
    return
  }
  dropHoverEl = setCardDropHoverElement(hit?.el || null, dropHoverEl)
}

function handleCardDropHoverPointerMove(event) {
  if (!(store.state.activeDrag || dragContext)?.cardName) {
    return
  }
  const { clientX, clientY } = event
  if (dropHoverRaf) {
    return
  }
  dropHoverRaf = requestAnimationFrame(() => {
    dropHoverRaf = 0
    updateDropHoverFromPoint(clientX, clientY)
  })
}

/**
 * Capture-phase append drop onto stick-room / «No data» before bubble
 * clearActiveDrag and before Sortable mouseup reverts the drag.
 * Covers swimlane, classic flat board, and child-panel empty columns.
 */
function handleAppendDropPointerUpCapture(event) {
  if (event.button != null && event.button !== 0) {
    return
  }
  const drag = store.state.activeDrag || dragContext
  if (!drag?.cardName) {
    return
  }
  const hit = findAppendDropTarget(event.clientX, event.clientY)
  if (!hit) {
    return
  }
  const completed = completeAppendDrop({
    store,
    drag,
    listId: hit.listId,
    laneKey: hit.laneKey,
  })
  if (!completed) {
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  suppressSortableMouseUp = true
  clearDropHover()
  if (completed.mode === 'swimlane') {
    dropSwimlane(completed.payload)
    return
  }
  // Classic + child: drop() routes child list ids to dropChildPanel.
  drop(completed.payload)
}

function handleAppendDropMouseUpCapture(event) {
  if (!suppressSortableMouseUp) {
    return
  }
  suppressSortableMouseUp = false
  event.preventDefault()
  event.stopImmediatePropagation()
}

async function playRollbackAnimation(cardName, destinationRect) {
  if (!destinationRect) {
    return
  }
  await nextTick()
  await animateCardRollback(cardName, destinationRect, {
    root: kanbanBoard.value || document,
  })
}

function setColumnRef(index, el) {
  if (el) {
    columnRefs.value[index] = el
    return
  }
  delete columnRefs.value[index]
}

function registerHeaderColumnRef(index, el) {
  if (el) {
    headerColumnRefs.value[index] = el
    return
  }
  delete headerColumnRefs.value[index]
}

function registerCellColumnRef(listId, el) {
  if (el) {
    cellColumnRefs.value[listId] = el
    return
  }
  delete cellColumnRefs.value[listId]
}

function registerChildColumnRef(scopeId, columnIndex, el) {
  const scope = String(scopeId || '').trim()
  if (!scope || !Number.isFinite(columnIndex)) {
    return
  }
  const byScope = { ...(childColumnRefs.value[scope] || {}) }
  if (el) {
    byScope[columnIndex] = el
  } else {
    delete byScope[columnIndex]
  }
  if (Object.keys(byScope).length === 0) {
    const next = { ...childColumnRefs.value }
    delete next[scope]
    childColumnRefs.value = next
    return
  }
  childColumnRefs.value = {
    ...childColumnRefs.value,
    [scope]: byScope,
  }
}

function resolveColumnDomEl(columnIndex, { preferHeader = false } = {}) {
  const board = kanbanBoard.value
  const column = columns.value[columnIndex]
  const columnKey = column ? getColumnKey(column) : null

  if (preferHeader || swimlanesEnabled.value) {
    const headerComponent = headerColumnRefs.value[columnIndex]
    const headerEl = resolveComponentRootEl(headerComponent)
    if (headerEl) {
      return headerEl
    }
  }

  if (!swimlanesEnabled.value) {
    const classicEl = resolveComponentRootEl(columnRefs.value[columnIndex])
    if (classicEl) {
      return classicEl
    }
  }

  if (!board || !columnKey) {
    return null
  }

  const escaped = typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(String(columnKey))
    : String(columnKey).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  if (swimlanesEnabled.value) {
    return board.querySelector(
      `.swimlane-header-row .kanban-column[data-column-value="${escaped}"]`,
    )
  }
  return board.querySelector(`.kanban-column[data-column-value="${escaped}"]`)
}

function resolveCardColumnComponent(columnIndex, laneIndex, childScopeId = null) {
  if (childScopeId) {
    return childColumnRefs.value[childScopeId]?.[columnIndex] || null
  }
  if (swimlanesEnabled.value && Number.isFinite(laneIndex)) {
    const listId = encodeCellListId(laneIndex, columnIndex)
    return cellColumnRefs.value[listId] || null
  }
  return columnRefs.value[columnIndex] || null
}

async function expandDestinationForReveal(columnIndex, laneIndex) {
  let didExpandColumn = false
  let didExpandLane = false
  const column = columns.value[columnIndex]
  if (column) {
    const columnKey = getColumnKey(column)
    if (columnKey && store.getters.isColumnCollapsed(columnKey)) {
      store.commit('SET_COLUMN_COLLAPSED', {
        columnKey,
        collapsed: false,
      })
      didExpandColumn = true
    }
  }

  if (swimlanesEnabled.value && Number.isFinite(laneIndex)) {
    const lane = lanes.value[laneIndex]
    const laneKey = lane?.key
    if (laneKey != null && !store.getters.isLaneExpanded(laneKey)) {
      store.commit('ADD_EXPANDED_LANE', laneKey)
      didExpandLane = true
    }
  }

  return { didExpandColumn, didExpandLane }
}

async function scrollToMovedCard({
  columnIndex,
  cardName,
  cardIndex,
  laneIndex = null,
  childScopeId = null,
}) {
  const { didExpandColumn, didExpandLane } = await expandDestinationForReveal(
    columnIndex,
    laneIndex,
  )
  await nextTick()
  await waitForPaint()
  if (!prefersReducedMotion()) {
    const waitExpandMs = Math.max(
      didExpandColumn ? COLUMN_COLLAPSE_ANIMATION_MS : 0,
      didExpandLane ? SWIMLANE_LANE_ANIMATION_MS : 0,
    )
    if (waitExpandMs > 0) {
      await waitMs(waitExpandMs)
      await waitForPaint()
    }
  }

  const board = kanbanBoard.value

  if (childScopeId) {
    const childComponent = resolveCardColumnComponent(
      columnIndex,
      laneIndex,
      childScopeId,
    )
    const horizontalEl = resolveComponentRootEl(childComponent)
    if (board && horizontalEl) {
      // Child panel rides board.scrollLeft; .child-panel-scroll is overflow:visible.
      scrollColumnIntoView(horizontalEl, board, {
        behavior: 'auto',
      })
      await waitForPaint()
    }
    await revealCardInChildColumn({
      cardName,
      cardIndex,
      root: board || document,
      getListEl: () => (
        resolveComponentRootEl(childComponent)?.querySelector?.('.kanban-card-list')
        || null
      ),
      scrollToCard: (name, index) => {
        childComponent?.scrollToCard?.(name, index)
      },
    })
    return
  }

  const horizontalEl = resolveColumnDomEl(columnIndex, {
    preferHeader: swimlanesEnabled.value,
  })
  if (board && horizontalEl) {
    // Use instant scroll so vertical reveal does not race a smooth tween.
    scrollColumnIntoView(horizontalEl, board, {
      behavior: 'auto',
    })
    await waitForPaint()
  }

  const revealOptions = {
    cardName,
    cardIndex,
    root: board || document,
    getListEl: () => {
      const component = resolveCardColumnComponent(columnIndex, laneIndex)
      return resolveComponentRootEl(component)?.querySelector?.('.kanban-card-list') || null
    },
    scrollToCard: (name, index) => {
      const component = resolveCardColumnComponent(columnIndex, laneIndex)
      component?.scrollToCard?.(name, index)
    },
  }

  if (swimlanesEnabled.value) {
    revealOptions.getScrollerEl = () => kanbanBoard.value
  }

  await revealCardInColumn(revealOptions)
}

provide('scrollToMovedCard', scrollToMovedCard)
provide('registerHeaderColumnRef', registerHeaderColumnRef)
provide('registerCellColumnRef', registerCellColumnRef)
provide('registerChildColumnRef', registerChildColumnRef)

watch(
  () => store.state.revealCreatedCard,
  async (payload) => {
    if (!payload?.cardName) {
      return
    }
    try {
      await scrollToMovedCard(payload)
    } catch {
      // Reveal is best-effort; create already succeeded.
    }
    if (payload.flash) {
      try {
        await flashMovedCard(payload.cardName, { outcome: 'success' })
      } catch {
        // Flash is best-effort.
      }
    }
    store.commit('CLEAR_REVEAL_CREATED_CARD')
  },
)

function teardownColumnSortable() {
  destroyColumnSortable(columnSortable)
  columnSortable = null
}

function setupColumnSortable() {
  teardownColumnSortable()
  const board = kanbanBoard.value
  if (
    !board
    || !canEditBoard.value
    || columns.value.length < 2
  ) {
    return
  }
  const container = swimlanesEnabled.value
    ? board.querySelector('.swimlane-header-row')
    : board
  if (!container) {
    return
  }
  columnSortable = createColumnSortable(container, {
    boardRoot: board,
    onDragStart() {
      columnDragActive = true
      snapSwimlaneTracks(widthsFromTracks(targetSwimlaneTracks.value))
    },
    onDragEnd() {
      columnDragActive = false
      snapSwimlaneTracks(widthsFromTracks(targetSwimlaneTracks.value))
    },
    onReorder(order) {
      store.dispatch('updateColumnOrder', order)
    },
  })
}

watch(
  [
    canEditBoard,
    swimlanesEnabled,
    () => columns.value.length,
    () => config.value.board_name,
  ],
  async () => {
    await nextTick()
    setupColumnSortable()
    setupSwimlaneStickyTopObserver()
    await scheduleSwimlaneLayoutMetricsUpdate()
  },
)

onMounted(() => {
  window.refreshKanbanBoard = refreshKanbanBoard;
  window.hydrateDinextKanban = hydrateDinextKanban;
  if (window.dinextKanbanInitialData) {
    hydrateDinextKanban(window.dinextKanbanInitialData)
    delete window.dinextKanbanInitialData
  } else {
    refreshKanbanBoard();
  }
  bindClickDrag();
  nextTick(async () => {
    setupColumnSortable()
    setupSwimlaneStickyTopObserver()
    await scheduleSwimlaneLayoutMetricsUpdate()
  })
  if (globalThis.__dinextKanbanExposeColumnReorder) {
    globalThis.__reorderDinextKanbanColumns = (order) =>
      store.dispatch('updateColumnOrder', order)
  }
  onPointerUp = () => clearActiveDragVisual()
  onPointerCancel = () => {
    suppressSortableMouseUp = false
    clearActiveDragVisual()
  }
  onAppendDropPointerUpCapture = handleAppendDropPointerUpCapture
  onAppendDropMouseUpCapture = handleAppendDropMouseUpCapture
  onCardDropHoverPointerMove = handleCardDropHoverPointerMove
  document.addEventListener('pointerup', onAppendDropPointerUpCapture, true)
  document.addEventListener('mouseup', onAppendDropMouseUpCapture, true)
  document.addEventListener('pointermove', onCardDropHoverPointerMove, { passive: true })
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
});

onBeforeUnmount(() => {
  disposeBoardHostedChildPanels()
  cancelSwimlaneTrackTween()
  teardownColumnSortable()
  teardownSwimlaneStickyTopObserver()
  unbindClickDrag();
  tagDragController?.destroy()
  tagDragController = null
  clearDropHover()
  setCardDragActive(false)
  if (onAppendDropPointerUpCapture) {
    document.removeEventListener('pointerup', onAppendDropPointerUpCapture, true)
  }
  if (onAppendDropMouseUpCapture) {
    document.removeEventListener('mouseup', onAppendDropMouseUpCapture, true)
  }
  if (onCardDropHoverPointerMove) {
    document.removeEventListener('pointermove', onCardDropHoverPointerMove)
  }
  if (onPointerUp) {
    document.removeEventListener('pointerup', onPointerUp)
  }
  if (onPointerCancel) {
    document.removeEventListener('pointercancel', onPointerCancel)
  }
  suppressSortableMouseUp = false
  delete window.refreshKanbanBoard
  delete window.hydrateDinextKanban
  delete globalThis.__reorderDinextKanbanColumns
});

const refreshKanbanBoard = async (args, forceConfig = false) => {
  hydrationToken += 1
  try {
    await store.dispatch("refreshBoard", {
      board_name: currentBoardName(),
      args,
      forceConfig,
    })
  } catch {
    // The store exposes the user-facing error state.
  }
};

async function hydrateDinextKanban(payload) {
  const token = ++hydrationToken
  await store.dispatch("hydrateFromList", payload)
  if (token !== hydrationToken) return
  // Swimlane boards hydrate cells lazily per visible expanded lane.
  if (store.getters.swimlanesEnabled) {
    return
  }
  try {
    const current = await store.dispatch("fetchColumnTotals", {
      args: payload.args,
    })
    if (current === false || token !== hydrationToken) return
    await store.dispatch("topUpInitialColumns", { args: payload.args })
  } catch {
    // The store exposes errors and keeps per-column scroll retry available.
  }
}

function retry() {
  return refreshKanbanBoard(window.cur_list?.get_args?.(), true)
}

function rememberDrag(context) {
  dragContext = context
  store.commit('SET_ACTIVE_DRAG', context)
  setCardDragActive(true)
  if (context?.fromLaneKey != null) {
    store.commit('SET_DRAG_SOURCE_LANE', context.fromLaneKey)
  }
}

function clearDragLaneState() {
  store.commit('SET_DRAG_EXPANDED_LANE', null)
  store.commit('SET_DRAG_SOURCE_LANE', null)
}

async function drop(event) {
  clearActiveDragVisual()

  const context = dragContext
  dragContext = null

  if (!context) {
    return
  }

  const toId = event.event?.to?.id
  const fromId = event.event?.from?.id ?? context.fromColumn

  if (isChildListId(toId) || isChildListId(fromId) || context.childScopeId) {
    await dropChildPanel({
      event,
      context,
      toId,
      fromId,
    })
    return
  }

  const toColumn = Number(toId)
  const fromColumn = Number(fromId)

  if (!Number.isFinite(toColumn) || fromColumn === toColumn) {
    return
  }

  const destinationRect = captureCardRect(
    context.cardName,
    kanbanBoard.value || document,
  )

  await nextTick()

  const result = await store.dispatch("persistMovedCard", {
    ...context,
    fromColumn,
    toColumn,
    toIndex: event.newIndex,
  }).catch(() => null)

  if (globalThis.__trackKanbanDrops) {
    globalThis.__lastKanbanDrop = { context, toColumn, fromColumn, result }
  }

  await nextTick()

  if (result?.needsAnimatedRollback) {
    await playRollbackAnimation(context.cardName, destinationRect)
  }

  await nextTick()
  if (result?.ok) {
    try {
      await scrollToMovedCard({
        columnIndex: toColumn,
        cardName: context.cardName,
        cardIndex: event.newIndex,
      })
    } catch {
      // Reveal is best-effort; move already succeeded.
    }
  }
  await flashMovedCard(context.cardName, {
    outcome: result?.ok ? 'success' : 'failure',
  })
}

async function dropChildPanel({ event, context, toId, fromId }) {
  const resolved = resolveChildPanelDropTarget({
    toId,
    fromId,
    contextChildScopeId: context.childScopeId || null,
    contextFromColumn: context.fromColumn,
    childPanels: store.state.childPanels,
  })

  if (!resolved.ok) {
    if (resolved.childScopeId && context?.cardName != null) {
      store.commit('RECOVER_CHILD_PANEL_DRAG', {
        cardName: context.cardName,
        fromColumn: resolved.fromColumn ?? context.fromColumn,
        fromIndex: context.fromIndex,
        childScopeId: resolved.childScopeId,
      })
    }
    return
  }

  if (resolved.sameColumn) {
    restoreBoardHostedPanelPinScrolls()
    return
  }

  const { childScopeId, fromColumn, toColumn } = resolved
  const destinationRect = captureCardRect(
    context.cardName,
    kanbanBoard.value || document,
  )
  await nextTick()
  const result = await store.dispatch('persistMovedCard', {
    cardName: context.cardName,
    fromColumn,
    toColumn,
    fromIndex: context.fromIndex,
    toIndex: event.newIndex,
    childScopeId,
  }).catch(() => null)

  await nextTick()
  if (result?.needsAnimatedRollback) {
    await playRollbackAnimation(context.cardName, destinationRect)
  }

  await nextTick()
  if (result?.ok) {
    try {
      await scrollToMovedCard({
        columnIndex: toColumn,
        cardName: context.cardName,
        cardIndex: event.newIndex,
        childScopeId,
      })
    } catch {
      // Reveal is best-effort; move already succeeded.
    }
  }
  restoreBoardHostedPanelPinScrolls()
  await flashMovedCard(context.cardName, {
    outcome: result?.ok ? 'success' : 'failure',
  })
}

async function dropSwimlane(event) {
  clearActiveDragVisual()
  const context = dragContext
  dragContext = null
  if (!context) {
    clearDragLaneState()
    return
  }

  const toId = event.event?.to?.id
  const fromId = event.event?.from?.id
  if (isChildListId(toId) || isChildListId(fromId) || context.childScopeId) {
    await dropChildPanel({
      event,
      context,
      toId,
      fromId,
    })
    clearDragLaneState()
    return
  }

  const toDecoded = decodeCellListId(toId)
  const fromDecoded = decodeCellListId(fromId)
  const toLaneIndex = Number.isFinite(toDecoded.laneIndex)
    ? toDecoded.laneIndex
    : event.laneIndex
  const toColumn = toDecoded.columnIndex
  const fromLaneIndex = Number.isFinite(fromDecoded.laneIndex)
    ? fromDecoded.laneIndex
    : context.fromLaneIndex
  const fromColumn = Number.isFinite(fromDecoded.columnIndex)
    ? fromDecoded.columnIndex
    : context.fromColumn

  const sameCell = fromLaneIndex === toLaneIndex && fromColumn === toColumn
  if (sameCell) {
    clearDragLaneState()
    return
  }

  const destinationRect = captureCardRect(
    context.cardName,
    kanbanBoard.value || document,
  )
  await nextTick()

  const result = await store.dispatch('persistMovedCardToCell', {
    cardName: context.cardName,
    fromLaneIndex,
    toLaneIndex,
    fromColumn,
    toColumn,
    fromIndex: context.fromIndex,
    toIndex: event.newIndex,
  }).catch(() => null)

  clearDragLaneState()
  await nextTick()
  if (result?.needsAnimatedRollback) {
    await playRollbackAnimation(context.cardName, destinationRect)
  }
  await nextTick()
  if (result?.ok) {
    try {
      await scrollToMovedCard({
        columnIndex: toColumn,
        cardName: context.cardName,
        cardIndex: event.newIndex,
        laneIndex: toLaneIndex,
      })
    } catch {
      // Reveal is best-effort; move already succeeded.
    }
  }
  await flashMovedCard(context.cardName, {
    outcome: result?.ok ? 'success' : 'failure',
  })
}

const bindClickDrag = () => {
  let isDown = false;
  let startX;
  let scrollLeft;

  const draggable = kanbanBoard.value;

  onMouseDown = (e) => {
    let ignoreEl = [
      ".kanban-column .kanban-column-header",
      ".kanban-column .add-card",
      ".kanban-column .kanban-card",
      ".kanban-card-wrapper",
      ".kanban-column-resize-handle",
      ".swimlane-lane-sticky",
      ".swimlane-cell-spacer",
    ];
    if (ignoreEl.some((el) => e.target.closest(el))) return;

    isDown = true;
    draggable.classList.add("clickdrag-active");
    startX = e.pageX - draggable.offsetLeft;
    scrollLeft = draggable.scrollLeft;
  };

  onMouseLeave = () => {
    isDown = false;
    draggable.classList.remove("clickdrag-active");
  };

  onMouseUp = () => {
    isDown = false;
    draggable.classList.remove("clickdrag-active");
  };

  onMouseMove = (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - draggable.offsetLeft;
    const walk = x - startX;
    draggable.scrollLeft = scrollLeft - walk;
  };

  draggable.addEventListener("mousedown", onMouseDown);
  draggable.addEventListener("mouseleave", onMouseLeave);
  draggable.addEventListener("mouseup", onMouseUp);
  draggable.addEventListener("mousemove", onMouseMove);
};

const unbindClickDrag = () => {
  const draggable = kanbanBoard.value;
  if (!draggable) return
  draggable.removeEventListener("mousedown", onMouseDown);
  draggable.removeEventListener("mouseleave", onMouseLeave);
  draggable.removeEventListener("mouseup", onMouseUp);
  draggable.removeEventListener("mousemove", onMouseMove);
};

</script>
