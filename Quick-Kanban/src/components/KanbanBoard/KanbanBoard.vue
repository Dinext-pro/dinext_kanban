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
      :class="{ 'kanban--child-panel-open': boardHostedChildPanels.length > 0 }"
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
        <ChildPanel
          v-for="panel in boardHostedChildPanels"
          :key="panel.scopeId"
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
      </div>
    </div>

    <div
      v-else
      ref="kanbanBoard"
      class="kanban"
      :class="{ 'kanban--child-panel-open': boardHostedChildPanels.length > 0 }"
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
        <ChildPanel
          v-for="panel in boardHostedChildPanels"
          :key="panel.scopeId"
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
  getScrollerTopInset,
  resolveComponentRootEl,
  revealCardInColumn,
  scrollCardToScrollerTop,
  scrollColumnIntoView,
  waitForPaint,
  waitMs,
} from "../../utils/menuMoveScroll";
import {
  decodeCellListId,
  encodeCellListId,
} from "../../utils/swimlaneBoard";
import {
  decodeChildListId,
  isChildListId,
  resolveChildPanelSpacerHeight,
} from "../../utils/childPanelBoard";
import {
  clearCardDropHoverElement,
  completeCellAppendDrop,
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
    return
  }
  cancelSwimlaneTrackTween()
  const tween = animateColumnTracks({
    from: current,
    to: target,
    onFrame(widths) {
      animatedSwimlaneTrackWidths.value = widths
    },
    onDone(widths) {
      animatedSwimlaneTrackWidths.value = widths
      trackTweenCancel = null
    },
  })
  trackTweenCancel = () => tween.cancel()
}

const swimlaneColumnTracks = computed(() => (
  formatTrackTemplate(animatedSwimlaneTrackWidths.value)
))
const boardColumnTracks = computed(() => {
  if (swimlanesEnabled.value) {
    return swimlaneColumnTracks.value
  }
  return formatTrackTemplate(widthsFromTracks(targetSwimlaneTracks.value))
})
provide('boardColumnTracks', boardColumnTracks)
const childPanelPortal = ref(null)
const boardHostedPanelRects = ref({})
const childPanelSpacerHeights = ref({})
provide('childPanelSpacerHeights', childPanelSpacerHeights)
const boardHostedChildPanels = computed(() => {
  const byDepth = store.state.childPanelByDepth || {}
  return Object.keys(byDepth)
    .map((depthKey) => Number(depthKey))
    .filter((depth) => Number.isFinite(depth))
    .sort((a, b) => a - b)
    .map((depth) => {
      const scopeId = byDepth[depth]
      const panel = scopeId ? store.state.childPanels?.[scopeId] : null
      if (!panel) {
        return null
      }
      return {
        scopeId,
        parentName: panel.parentName,
        depth: panel.depth ?? depth,
      }
    })
    .filter(Boolean)
})
let boardHostedGeometryRaf = 0
let boardHostedScrollBound = false
let boardHostedPanelsSignature = ''
/**
 * Parent-panel lists kept as bounded scrollports while nested hosts are pinned.
 * Multi-level open needs a stack: clearing an ancestor lock re-grows that list
 * (maxScroll 0) and unpins the mid-host.
 */
const nestedPinListLocks = new Set()

function unlockNestedPinListEl(el) {
  if (!el?.style) {
    nestedPinListLocks.delete(el)
    return
  }
  el.classList.remove('kanban-card-list--nested-pin')
  el.style.removeProperty('overflow-y')
  el.style.removeProperty('height')
  el.style.removeProperty('max-height')
  nestedPinListLocks.delete(el)
}

function clearNestedPinListLocks() {
  for (const el of [...nestedPinListLocks]) {
    unlockNestedPinListEl(el)
  }
}

/** Keep locks only for lists that still host an open nested (depth >= 1) panel. */
function pruneNestedPinListLocks() {
  const board = kanbanBoard.value
  const panels = boardHostedChildPanels.value || []
  const needed = new Set()
  for (const panel of panels) {
    if ((Number(panel.depth) || 0) < 1) {
      continue
    }
    const parent = String(panel.parentName || '').trim()
    if (!parent || !board) {
      continue
    }
    const host = board.querySelector?.(
      `.kanban-card[data-card-name="${escapePanelParentName(parent)}"]`,
    )
    const list = host?.closest?.('.kanban-card-list')
    if (list?.closest?.('.child-panel')) {
      needed.add(list)
    }
  }
  for (const el of [...nestedPinListLocks]) {
    if (!el?.isConnected || !needed.has(el)) {
      unlockNestedPinListEl(el)
    }
  }
}

/**
 * Non-fill child-panel lists grow with content (overflow visible / height auto),
 * so scrollTop cannot move mid-host cards. Bound the list to the board
 * remainder and keep overflow auto while nested panels stay open.
 * When spacer moved to a deeper host, shrink height so cards above still scroll away.
 */
function lockNestedPinListScroller(scroller) {
  const isNestedList = Boolean(
    scroller?.style
    && scroller !== kanbanBoard.value
    && scroller.classList?.contains('kanban-card-list')
    && scroller.closest?.('.child-panel'),
  )
  if (!isNestedList) {
    // Board / depth-0 column pin: drop nested scrollports only when no nested open.
    const newest = resolveNewestPanelParentName()
    const board = kanbanBoard.value
    const newestHost = newest && board?.querySelector?.(
      `.kanban-card[data-card-name="${escapePanelParentName(newest)}"]`,
    )
    if (!newestHost?.closest?.('.child-panel')) {
      clearNestedPinListLocks()
    } else {
      pruneNestedPinListLocks()
    }
    return false
  }
  const board = kanbanBoard.value
  if (!board) {
    return false
  }
  const listRect = scroller.getBoundingClientRect()
  const boardRect = board.getBoundingClientRect()
  const boardRoom = Math.max(120, Math.floor(boardRect.bottom - listRect.top))
  const hostCard = scroller.querySelector?.('.kanban-vl-item--panel-host .kanban-card')
  // Measure before constraining — height:auto scrollHeight is full content.
  const naturalContentH = scroller.scrollHeight || 0
  const naturalHostOffset = hostCard
    ? Math.max(
      0,
      hostCard.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top
        + (scroller.scrollTop || 0),
    )
    : 0
  let heightPx = boardRoom
  if (naturalHostOffset > 1 && naturalContentH > naturalHostOffset + 80) {
    // maxScroll must cover cards above; spacer may already be on a deeper host.
    heightPx = Math.max(80, Math.min(boardRoom, Math.floor(naturalContentH - naturalHostOffset)))
  }
  nestedPinListLocks.add(scroller)
  scroller.classList.add('kanban-card-list--nested-pin')
  scroller.style.setProperty('height', `${heightPx}px`, 'important')
  scroller.style.setProperty('max-height', `${heightPx}px`, 'important')
  scroller.style.setProperty('overflow-y', 'auto', 'important')
  void scroller.scrollHeight
  // Layout can shrink content after the first constrain — top up maxScroll if needed.
  if (hostCard && naturalHostOffset > 1) {
    const maxScroll = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0))
    if (maxScroll + 1 < naturalHostOffset) {
      heightPx = Math.max(
        80,
        Math.min(boardRoom, Math.floor((scroller.scrollHeight || 0) - naturalHostOffset)),
      )
      scroller.style.setProperty('height', `${heightPx}px`, 'important')
      scroller.style.setProperty('max-height', `${heightPx}px`, 'important')
    }
  }
  return true
}

function clearBoardHostedPanelChrome() {
  clearNestedPinListLocks()
  boardHostedPanelRects.value = {}
  childPanelSpacerHeights.value = {}
}

/**
 * Newest open panel parent (deepest). Nested hosts pin inside the parent panel
 * list scroller; depth-0 pins on the board — never board-scroll a nested host.
 */
function resolveNewestPanelParentName(panels = boardHostedChildPanels.value) {
  if (!panels?.length) {
    return ''
  }
  const newest = panels[panels.length - 1]
  return String(newest?.parentName || '').trim()
}

/** Open panel hosts shallow → deep (depth-0 first). */
function resolveOpenPanelParentNames(panels = boardHostedChildPanels.value) {
  return (panels || [])
    .map((panel) => String(panel?.parentName || '').trim())
    .filter(Boolean)
}

function isPanelHostNearTop(parentName) {
  const board = kanbanBoard.value
  const parent = String(parentName || '').trim()
  if (!board || !parent) {
    return true
  }
  const escaped = escapePanelParentName(parent)
  const hostCard = board.querySelector?.(`.kanban-card[data-card-name="${escaped}"]`)
  if (!hostCard) {
    return true
  }
  const insideChildPanel = Boolean(hostCard.closest?.('.child-panel'))
  let scroller
  let topInset = 0
  if (insideChildPanel) {
    scroller = hostCard.closest?.('.kanban-card-list') || board
  } else if (swimlanesEnabled.value) {
    scroller = board
    topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
  } else {
    scroller = hostCard.closest?.('.kanban-card-list') || board
    topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
  }
  const cardRect = hostCard.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  return Math.abs(cardRect.top - (scrollerRect.top + topInset)) < 1.5
}

function escapePanelParentName(parentName) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(parentName)
  }
  return String(parentName).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function waitAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function panelRectsEqual(left, right) {
  const a = left || {}
  const b = right || {}
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) < 0.5
  for (const key of aKeys) {
    const l = a[key]
    const r = b[key]
    if (!r) {
      return false
    }
    if (
      !near(l.top, r.top)
      || !near(l.left, r.left)
      || !near(l.width, r.width)
      || !near(l.height, r.height)
    ) {
      return false
    }
  }
  return true
}

let flushPinChain = Promise.resolve()
let flushPinQueuedParent = null

async function onBoardHostedPanelHeight(parentName, height) {
  const parent = String(parentName || '').trim()
  if (!parent) {
    return
  }
  // Emit height is a layout signal; viewport-fill spacer comes from apply.
  // Do not write emit height into spacer map (avoids fight + extra VL churn).
  void height
  // Always pin the deepest open host. Shallow-panel height feedback must not
  // re-pin depth-0 on the board (that clears the nested list scrollport).
  const newest = resolveNewestPanelParentName() || parent
  await flushGeometryThenPin(newest)
}

function resolvePanelHostTop(board, boardRect, parentName, previousTop) {
  const escaped = escapePanelParentName(parentName)
  const spacer = board.querySelector(`.child-panel-spacer[data-panel-parent="${escaped}"]`)
  const hostCard = board.querySelector(`.kanban-card[data-card-name="${escaped}"]`)
  if (spacer) {
    const spacerRect = spacer.getBoundingClientRect()
    return spacerRect.top - boardRect.top + board.scrollTop
  }
  if (hostCard) {
    const cardRect = hostCard.getBoundingClientRect()
    return cardRect.bottom - boardRect.top + board.scrollTop
  }
  if (Number.isFinite(previousTop)) {
    return previousTop
  }
  return null
}

/** Synchronous spacer/rect update — call before pin so maxScroll includes pad. */
function applyBoardHostedPanelGeometry() {
  const board = kanbanBoard.value
  const panels = boardHostedChildPanels.value
  if (!board || !panels.length || typeof board.getBoundingClientRect !== 'function') {
    if (Object.keys(boardHostedPanelRects.value || {}).length) {
      boardHostedPanelRects.value = {}
    }
    return
  }
  const boardRect = board.getBoundingClientRect()
  const width = Math.max(board.scrollWidth || 0, boardRect.width || 0)
  const overhangRaw = getComputedStyle(board).getPropertyValue('--swimlane-lane-overhang')
  const overhang = swimlanesEnabled.value
    ? Math.max(0, Number.parseFloat(overhangRaw) || 0)
    : 0
  const maxDepth = Math.max(...panels.map((panel) => Number(panel.depth) || 0))
  const nextRects = {}
  const previousRects = boardHostedPanelRects.value || {}
  const nextSpacerHeights = {}
  let spacerHeightsChanged = false
  for (const panel of panels) {
    const top = resolvePanelHostTop(
      board,
      boardRect,
      panel.parentName,
      previousRects[panel.scopeId]?.top,
    )
    if (top == null) {
      continue
    }
    const rect = {
      top,
      left: overhang,
      width: Math.max(0, width - overhang),
    }
    if (Number(panel.depth) === maxDepth) {
      const escaped = escapePanelParentName(panel.parentName)
      const hostCard = board.querySelector(`.kanban-card[data-card-name="${escaped}"]`)
      const columnEl = hostCard?.closest?.('.kanban-column')
      const listEl = hostCard?.closest?.('.kanban-card-list')
      // Pin target is list top (under column/lane chrome), not board top — flat headers ~52px.
      const topInset = listEl
        ? Math.max(0, listEl.getBoundingClientRect().top - boardRect.top)
        : getScrollerTopInset(board, columnEl)
      const hostHeight = hostCard?.getBoundingClientRect?.().height || 0
      // Viewport fill as if host were pinned under sticky — not current Y.
      const height = resolveChildPanelSpacerHeight({
        scrollerClientHeight: board.clientHeight,
        topInset,
        hostHeight,
      })
      rect.height = height
      const parent = String(panel.parentName || '').trim()
      if (parent) {
        nextSpacerHeights[parent] = height
        if (childPanelSpacerHeights.value?.[parent] !== height) {
          spacerHeightsChanged = true
        }
      }
    }
    nextRects[panel.scopeId] = rect
  }
  // Drop spacer heights for closed / non-deepest hosts (empty pad only while open).
  const previousSpacer = childPanelSpacerHeights.value || {}
  if (
    spacerHeightsChanged
    || Object.keys(previousSpacer).length !== Object.keys(nextSpacerHeights).length
    || Object.keys(previousSpacer).some((key) => previousSpacer[key] !== nextSpacerHeights[key])
  ) {
    spacerHeightsChanged = true
  }
  // Skip identical rect writes — ChildPanel watches hostRect and would re-emit height.
  if (!panelRectsEqual(previousRects, nextRects)) {
    boardHostedPanelRects.value = nextRects
  }
  if (spacerHeightsChanged) {
    childPanelSpacerHeights.value = nextSpacerHeights
  }
}

/** Debounced for scroll/resize; open/height path uses flushGeometryThenPin instead. */
function syncBoardHostedPanelGeometry() {
  if (boardHostedGeometryRaf) {
    cancelAnimationFrame(boardHostedGeometryRaf)
  }
  boardHostedGeometryRaf = requestAnimationFrame(() => {
    boardHostedGeometryRaf = 0
    applyBoardHostedPanelGeometry()
  })
}

/**
 * Cancel pending rAF sync, apply spacer now, wait for DOM/VL settle, then pin.
 * Single-flight + trailing parent so hostRect/height feedback cannot stack flushes.
 * Re-pin every open host shallow→deep: spacer move remounts VL and drops ancestors.
 */
function flushGeometryThenPin(parentName) {
  if (!parentName) {
    return flushPinChain
  }
  flushPinQueuedParent = parentName
  flushPinChain = flushPinChain
    .catch(() => {})
    .then(async () => {
      const parent = flushPinQueuedParent
      flushPinQueuedParent = null
      if (!parent) {
        return
      }
      if (boardHostedGeometryRaf) {
        cancelAnimationFrame(boardHostedGeometryRaf)
        boardHostedGeometryRaf = 0
      }
      pruneNestedPinListLocks()
      const escaped = escapePanelParentName(parent)
      const openParents = () => {
        const names = resolveOpenPanelParentNames()
        // Ensure trailing flush target is included even if panels lag one tick.
        if (parent && !names.includes(parent)) {
          names.push(parent)
        }
        return names
      }
      const allHostsNearTop = () => openParents().every((name) => isPanelHostNearTop(name))
      const alignOpenChain = async () => {
        for (const name of openParents()) {
          await ensureBoardHostedPanelAnchorVisible(name)
        }
      }
      // Wait until spacer is in layout (needed for short columns; also gates VL height).
      for (let i = 0; i < 8; i += 1) {
        applyBoardHostedPanelGeometry()
        await nextTick()
        await waitAnimationFrame()
        const board = kanbanBoard.value
        const spacer = board?.querySelector?.(
          `.child-panel-spacer[data-panel-parent="${escaped}"]`,
        )
        if (spacer && (spacer.getBoundingClientRect().height || 0) > 1) {
          break
        }
      }
      // Re-pin until stable across a VL remount window (~scrollTop reset).
      const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 1500
      let stableFrames = 0
      while ((typeof performance !== 'undefined' ? performance.now() : Date.now()) < deadline) {
        applyBoardHostedPanelGeometry()
        pruneNestedPinListLocks()
        await alignOpenChain()
        await waitAnimationFrame()
        if (allHostsNearTop()) {
          stableFrames += 1
          if (stableFrames >= 3) {
            return
          }
        } else {
          stableFrames = 0
        }
      }
      await alignOpenChain()
    })
  return flushPinChain
}

provide('syncChildPanelGeometry', syncBoardHostedPanelGeometry)

let boardHostedResizeObserver = null

function bindBoardHostedGeometryListeners() {
  const board = kanbanBoard.value
  if (!board || boardHostedScrollBound) {
    return
  }
  board.addEventListener('scroll', syncBoardHostedPanelGeometry, { passive: true })
  window.addEventListener('resize', syncBoardHostedPanelGeometry, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    boardHostedResizeObserver = new ResizeObserver(() => syncBoardHostedPanelGeometry())
    boardHostedResizeObserver.observe(board)
  }
  boardHostedScrollBound = true
}

function unbindBoardHostedGeometryListeners() {
  const board = kanbanBoard.value
  if (board && boardHostedScrollBound) {
    board.removeEventListener('scroll', syncBoardHostedPanelGeometry)
  }
  window.removeEventListener('resize', syncBoardHostedPanelGeometry)
  boardHostedResizeObserver?.disconnect()
  boardHostedResizeObserver = null
  boardHostedScrollBound = false
}

async function ensureBoardHostedPanelAnchorVisible(parentName) {
  const board = kanbanBoard.value
  if (!board || !parentName) {
    return
  }
  const escaped = escapePanelParentName(parentName)

  const resolveAlignContext = (hostCard) => {
    const insideChildPanel = Boolean(hostCard.closest?.('.child-panel'))
    let scroller
    let topInset = 0
    if (insideChildPanel) {
      // Nested host: pin inside the parent panel column list (not the board).
      scroller = hostCard.closest?.('.kanban-card-list') || board
      topInset = 0
    } else if (swimlanesEnabled.value) {
      scroller = board
      topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
    } else {
      scroller = hostCard.closest?.('.kanban-card-list') || board
      topInset = getScrollerTopInset(scroller, hostCard.closest?.('.kanban-column'))
    }
    return { scroller, topInset }
  }

  /**
   * Unlock scroller for programmatic pin.
   * Nested mid-host: keep a bounded scrollport on the parent list (non-fill
   * lists grow with content → maxScroll 0 unless height is constrained).
   * Board: temporary overflow-y unlock with !important, then restore.
   */
  const withScrollerYScrollUnlock = (scroller, run) => {
    if (!scroller?.style?.setProperty) {
      return run()
    }
    if (lockNestedPinListScroller(scroller)) {
      void scroller.scrollHeight
      return run()
    }
    scroller.style.setProperty('overflow-y', 'auto', 'important')
    void scroller.scrollHeight
    try {
      return run()
    } finally {
      const keptTop = scroller.scrollTop
      scroller.style.removeProperty('overflow-y')
      scroller.scrollTop = keptTop
    }
  }

  const alignHost = () => {
    const hostCard = board.querySelector(`.kanban-card[data-card-name="${escaped}"]`)
    if (!hostCard) {
      return false
    }
    const { scroller, topInset } = resolveAlignContext(hostCard)
    // auto: VirtualList remounts (minimize/spacer) cancel smooth mid-flight.
    return withScrollerYScrollUnlock(scroller, () => scrollCardToScrollerTop(hostCard, scroller, {
      topInset,
      behavior: 'auto',
      margin: 0,
    }))
  }

  const hostNearTop = () => {
    const hostCard = board.querySelector(`.kanban-card[data-card-name="${escaped}"]`)
    if (!hostCard) {
      return true
    }
    const { scroller, topInset } = resolveAlignContext(hostCard)
    const cardRect = hostCard.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const visibleTop = scrollerRect.top + topInset
    return Math.abs(cardRect.top - visibleTop) < 1
  }

  const spacerLaidOut = () => {
    const spacer = board.querySelector(`.child-panel-spacer[data-panel-parent="${escaped}"]`)
    return Boolean(spacer && (spacer.getBoundingClientRect().height || 0) > 1)
  }

  // Retry while spacer/maxScroll catch up (short columns fit viewport without pad).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    alignHost()
    if (hostNearTop()) {
      return
    }
    if (!spacerLaidOut()) {
      applyBoardHostedPanelGeometry()
    }
    await nextTick()
    await waitAnimationFrame()
  }
  alignHost()
}

watch(
  boardHostedChildPanels,
  async (panels) => {
    const signature = panels.map((panel) => panel.scopeId).join('|')
    if (!panels.length) {
      boardHostedPanelsSignature = ''
      clearBoardHostedPanelChrome()
      return
    }
    const previousSignature = boardHostedPanelsSignature
    boardHostedPanelsSignature = signature
    await nextTick()
    bindBoardHostedGeometryListeners()
    // Spacer mounts after VirtualList paints; apply synchronously then pin.
    if (signature !== previousSignature) {
      await flushGeometryThenPin(resolveNewestPanelParentName(panels))
    } else {
      syncBoardHostedPanelGeometry()
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => store.state.collapsedColumns,
  async () => {
    if (!boardHostedChildPanels.value.length) {
      return
    }
    await nextTick()
    syncBoardHostedPanelGeometry()
  },
  { deep: true },
)

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
    if (!swimlanesEnabled.value) {
      lastTrackKeys = nextKeys
      snapSwimlaneTracks(nextWidths)
      return
    }
    const keysChanged = nextKeys !== lastTrackKeys
    lastTrackKeys = nextKeys
    runSwimlaneTrackTween(nextWidths, { animate: !keysChanged })
  },
  { immediate: true, deep: true },
)

watch(swimlanesEnabled, (enabled) => {
  if (!enabled) {
    cancelSwimlaneTrackTween()
    animatedSwimlaneTrackWidths.value = []
    lastTrackKeys = ''
    return
  }
  lastTrackKeys = trackKeysSignature(targetSwimlaneTracks.value)
  snapSwimlaneTracks(widthsFromTracks(targetSwimlaneTracks.value))
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
 */
function handleAppendDropPointerUpCapture(event) {
  if (event.button != null && event.button !== 0) {
    return
  }
  if (!store.getters.swimlanesEnabled) {
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
  const completed = completeCellAppendDrop({
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
  // Persist via the same path as Sortable cell drops.
  dropSwimlane(completed.payload)
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

function resolveCardColumnComponent(columnIndex, laneIndex) {
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
    boardRoot: swimlanesEnabled.value ? board : null,
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
  window.hydrateQuickKanban = hydrateQuickKanban;
  if (window.quickKanbanInitialData) {
    hydrateQuickKanban(window.quickKanbanInitialData)
    delete window.quickKanbanInitialData
  } else {
    refreshKanbanBoard();
  }
  bindClickDrag();
  nextTick(async () => {
    setupColumnSortable()
    setupSwimlaneStickyTopObserver()
    await scheduleSwimlaneLayoutMetricsUpdate()
  })
  if (globalThis.__quickKanbanExposeColumnReorder) {
    globalThis.__reorderQuickKanbanColumns = (order) =>
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
  if (boardHostedGeometryRaf) {
    cancelAnimationFrame(boardHostedGeometryRaf)
    boardHostedGeometryRaf = 0
  }
  unbindBoardHostedGeometryListeners()
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
  delete window.hydrateQuickKanban
  delete globalThis.__reorderQuickKanbanColumns
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

async function hydrateQuickKanban(payload) {
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
  const toDecoded = decodeChildListId(toId)
  const fromDecoded = isChildListId(fromId)
    ? decodeChildListId(fromId)
    : { scopeOrdinal: null, columnIndex: Number(fromId) }
  const toColumn = toDecoded.columnIndex
  const fromColumn = Number.isFinite(fromDecoded.columnIndex)
    ? fromDecoded.columnIndex
    : context.fromColumn
  const scopeOrdinal = Number.isFinite(toDecoded.scopeOrdinal)
    ? toDecoded.scopeOrdinal
    : context.childScopeId
      ? store.state.childPanels[context.childScopeId]?.ordinal
      : fromDecoded.scopeOrdinal

  let childScopeId = context.childScopeId || null
  if (!childScopeId && Number.isFinite(scopeOrdinal)) {
    childScopeId = Object.keys(store.state.childPanels).find(
      (scopeId) => store.state.childPanels[scopeId]?.ordinal === scopeOrdinal,
    ) || null
  }

  if (!childScopeId || !Number.isFinite(toColumn) || fromColumn === toColumn) {
    return
  }

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
