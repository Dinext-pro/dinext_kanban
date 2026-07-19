<template>
  <section
    ref="columnRootRef"
    class="kanban-column"
    :class="columnClasses"
    role="region"
    :aria-label="columnAriaLabel"
    :data-column-value="column.column_name"
    :style="getColumnStyle(column.indicator)"
    @dblclick="onColumnDblclick"
    @pointerenter="onColumnPointerEnter"
    @pointerleave="onColumnPointerLeave"
    @dragenter="onColumnDragEnter"
    @dragleave="onColumnDragLeave"
  >
    <div
      v-if="showForbiddenOverlay"
      class="kanban-column-drop-overlay"
      aria-hidden="true"
    >
      <span class="kanban-column-drop-overlay__mark" />
    </div>
    <header v-if="!hideHeader" class="kanban-column-header">
      <div class="column-heading">
        <span
          class="column-count"
          :class="Number.isFinite(columnTotal)
            ? getIndicatorClass(column.indicator)
            : 'loading'"
          :title="collapsed
            ? undefined
            : __('Double-click to open filtered list')"
          @dblclick.prevent.stop="onCountDblclick"
        >
          {{ totalDisplay }}
        </span>
        <h2
          :id="headingId"
          class="column-title"
          :class="{ 'column-title--draggable': canEditBoard && !hasCustomBody }"
          :title="canEditBoard && !hasCustomBody ? __('Drag to reorder column') : undefined"
        >
          {{ columnLabel }}
        </h2>
      </div>

      <div class="column-header-actions">
        <div
          class="quick-kanban-column-menu"
          @keydown.esc.prevent="closeColorMenu"
          @dblclick.stop
        >
          <button
            ref="colorMenuButton"
            type="button"
            class="header-item"
            :aria-label="__('Change {0} column color', [columnLabel])"
            :aria-expanded="String(colorMenuOpen)"
            @click="toggleColorMenu"
          >
            <svg class="icon icon-sm" aria-hidden="true">
              <use href="#icon-dot-horizontal"></use>
            </svg>
          </button>

          <div
            v-if="colorMenuOpen"
            ref="colorMenuPanel"
            class="column-dropdown"
            role="group"
            :aria-label="__('Column colors')"
            :style="collapsed ? columnMenuStyle : undefined"
          >
            <div class="column-color-swatches">
              <button
                v-for="indicator in indicators"
                :key="indicator.name"
                type="button"
                class="indicator-choice"
                :aria-label="__('Set {0} color to {1}', [columnLabel, indicator.name])"
                @click="setIndicator(indicator.value)"
              >
                <IndicatorPill :indicator="indicator.class" />
                <span class="sr-only">{{ indicator.name }}</span>
              </button>
            </div>
            <button
              type="button"
              class="column-menu-action"
              :aria-label="collapsed
                ? __('Open {0} column', [columnLabel], COLUMN_CTX)
                : __('Collapse {0} column', [columnLabel], COLUMN_CTX)"
              @click="toggleCollapsedFromMenu"
            >
              <svg class="icon icon-sm" aria-hidden="true">
                <use :href="collapsed ? '#icon-sidebar-expand' : '#icon-sidebar-collapse'"></use>
              </svg>
              <span>{{ collapsed
                ? __('Open', [], COLUMN_CTX)
                : __('Collapse', [], COLUMN_CTX) }}</span>
            </button>
            <button
              v-if="canEditBoard"
              type="button"
              class="column-menu-action"
              :aria-label="__('Hide {0} column', [columnLabel])"
              @click="hideColumn"
            >
              <svg class="icon icon-sm" aria-hidden="true">
                <use href="#icon-hide"></use>
              </svg>
              <span>{{ __('Hide') }}</span>
            </button>
          </div>
        </div>

        <button
          v-if="createAllowed"
          v-show="!collapsed"
          type="button"
          class="header-item"
          :aria-label="__('Add {0} to {1}', [doctypeLabel, columnLabel])"
          :disabled="createBlocked"
          @click="startCreate"
          @dblclick.stop
        >
          <svg class="icon icon-sm" aria-hidden="true">
            <use href="#icon-add"></use>
          </svg>
        </button>
      </div>
    </header>

    <slot v-if="hasCustomBody" name="body" />

    <VirtualList
      v-else-if="!headerOnly"
      ref="virtualListRef"
      v-model="cards"
      :key="`${laneKey ?? ''}-${column.column_name}-${dragSyncGeneration}`"
      role="list"
      tabindex="0"
      :aria-label="__('Cards in {0}', [columnLabel])"
      :aria-hidden="collapsed ? 'true' : undefined"
      @drag="drag"
      @drop="emits('drop', $event)"
      @bottom="loadNextPage"
      @scroll.passive="handleNativeScroll"
      :dataKey="'name'"
      :id="resolvedListId"
      class="kanban-card-list"
      :class="{ 'kanban-card-list--external-scroller': Boolean(externalScroller) }"
      :scroller="externalScroller || undefined"
      :handle="'.drag-handle.drag'"
      :disabled="dragDisabled"
      :keeps="cardsLimit"
      :group="dragGroup"
      chosenClass="chosen-card"
      ghostClass="ghost-card"
    >
      <template v-slot:item="{ record }">
        <KanbanCard
          :card="record"
          :config="config"
          :columnIndex="columnIndex"
          :laneIndex="laneIndex"
          :laneKey="laneKey"
        />
      </template>

      <template #footer>
        <p v-if="pagination.loading" class="column-loading" role="status">
          {{ __('Loading more data…') }}
        </p>
        <p
          v-if="column.cards.length === 0"
          class="empty-column"
          :class="{ 'empty-column--drop-target': Boolean(externalScroller) }"
        >
          {{ __('No data') }}
        </p>
      </template>
    </VirtualList>

    <div
      v-if="!hasCustomBody && !headerOnly"
      v-show="!collapsed"
      class="column-footer-actions"
      :class="{
        'column-footer-actions--swimlane': Boolean(externalScroller),
      }"
    >
      <div v-if="createAllowed" class="addcard">
        <button
          type="button"
          @click="startCreate"
          class="btn btn-default btn-sm w-100"
          :disabled="createBlocked"
        >
          <svg class="icon icon-xs" aria-hidden="true">
            <use href="#icon-add"></use>
          </svg>
          <span>{{ __('Add {0}', [doctypeLabel]) }}</span>
        </button>
      </div>
      <button
        v-show="showScrollTop"
        type="button"
        class="column-scroll-top"
        :aria-label="__('Scroll to top of column', [], COLUMN_CTX)"
        :title="__('Scroll to top of column', [], COLUMN_CTX)"
        @click.stop="scrollColumnToTop"
      >
        <svg class="icon icon-xs" aria-hidden="true">
          <use href="#icon-up-line"></use>
        </svg>
      </button>
    </div>

    <div
      v-if="externalScroller && !hasCustomBody && !headerOnly"
      v-show="!collapsed"
      class="column-stick-room-dropzone"
      aria-hidden="true"
    />

    <div
      v-if="canEditBoard && !collapsed && !hideResize && !hideHeader"
      class="kanban-column-resize-handle"
      role="separator"
      aria-orientation="vertical"
      :aria-label="__('Drag to resize column', [], COLUMN_CTX)"
      :title="__('Drag to resize column. Hold Shift to resize all columns.', [], COLUMN_CTX)"
      @pointerdown.stop.prevent="onResizePointerDown"
      @dblclick.stop
    />
  </section>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useSlots,
  watch,
} from "vue";
import { useStore } from "vuex";
import VirtualList from "vue-virtual-draglist";
import { getIndicators } from "../../utils/colors";
import {
  clampColumnWidthForResize,
  COLLAPSED_COLUMN_WIDTH_PX,
  COLUMN_DRAG_EXPAND_DELAY_MS,
  getColumnKey,
  getIndicatorClass,
  isNearScrollEnd,
  QUICK_KANBAN_COLUMN_TRANSLATION_CONTEXT,
  resolveColumnWidthPx,
} from "../../utils/kanban";
import { openColumnListView } from "../../utils/listNavigation";
import { useDismissibleMenu } from "../../utils/menu";
import { getLaneStickyBottom } from "../../utils/menuMoveScroll";
import KanbanCard from "./KanbanCard.vue";
import IndicatorPill from "../IndicatorPill.vue";

const COLUMN_CTX = QUICK_KANBAN_COLUMN_TRANSLATION_CONTEXT
const SCROLL_TOP_VISIBLE_PX = 8
const store = useStore();
const slots = useSlots()
const canEditBoard = computed(() => store.getters.canEditBoard)
const cardsLimit = ref(30);
const virtualListRef = ref(null)
const showScrollTop = ref(false)
let boundExternalScroller = null
let onExternalScroll = null
let boundListScroller = null
let onListScroll = null
let externalResizeObserver = null
let scrollTopRaf = null
const colorMenuButton = ref(null)
const colorMenuPanel = ref(null)
const colorMenuOpen = ref(false)
const columnMenuStyle = ref({})
const columnRootRef = ref(null)
const resizePreviewWidth = ref(null)
const __ = globalThis.__
const indicators = computed(() => getIndicators())
let expandOnDragTimer = null
let resizeSession = null

useDismissibleMenu({
  isOpen: colorMenuOpen,
  triggerRef: colorMenuButton,
  menuRef: colorMenuPanel,
  close: closeColorMenu,
})

const props = defineProps({
  column: {
    type: Object,
    required: true,
    default: () => ({ cards: [] }),
  },
  config: { type: Object, required: true },
  columnIndex: { type: Number, required: true },
  laneIndex: { type: Number, default: null },
  laneKey: { type: [String, Number], default: null },
  listId: { type: Number, default: null },
  hideHeader: { type: Boolean, default: false },
  hideResize: { type: Boolean, default: false },
  headerOnly: { type: Boolean, default: false },
  externalScroller: { type: Object, default: null },
  totalOverride: { type: Number, default: null },
});

const emits = defineEmits(["drop", "dragstart"]);
const hasCustomBody = computed(() => Boolean(slots.body))
const headingId = `kanban-column-${props.laneKey ?? ''}-${props.column.name || props.columnIndex}`
const resolvedListId = computed(() => (
  Number.isFinite(props.listId) ? props.listId : props.columnIndex
))
const cards = computed({
  get: () => props.column.cards,
  set: (value) => store.commit("SET_COLUMN_CARDS", {
    columnIndex: props.columnIndex,
    laneIndex: props.laneIndex,
    cards: value,
  }),
})
const dragDisabled = computed(
  () => Object.keys(store.state.pendingMoves).length > 0,
)
const activeDrag = computed(() => store.getters.activeDragCard)
const dragSyncGeneration = computed(() => store.state.dragSyncGeneration)
function flatColumnIndexForPolicy() {
  if (props.laneIndex == null) {
    return props.columnIndex
  }
  return store.state.columns.findIndex(
    (column) => column.column_name === props.column.column_name,
  )
}
function isTargetDropAllowed(cardName) {
  if (props.laneKey != null) {
    return store.getters.isCellDropAllowed({
      cardName,
      columnIndex: flatColumnIndexForPolicy(),
      laneColumnIndex: props.columnIndex,
      laneKey: props.laneKey,
    })
  }
  return store.getters.isDropAllowed({
    cardName,
    columnIndex: flatColumnIndexForPolicy(),
  })
}
const dragGroup = computed(() => {
  if (globalThis.__quickKanbanPermissiveMoves) {
    return 'kanban'
  }
  return {
    name: 'kanban',
    pull: true,
    put: (to, from, dragEl) => {
      const cardName = dragEl?.dataset?.key
        || dragEl?.getAttribute?.('data-key')
        || dragEl?.closest?.('[data-key]')?.getAttribute?.('data-key')
      if (!cardName) {
        return false
      }
      return isTargetDropAllowed(cardName)
    },
  }
})
const columnKey = computed(() => getColumnKey(props.column))
const collapsed = computed(
  () => store.getters.isColumnCollapsed(columnKey.value),
)
const columnDropClasses = computed(() => {
  if (hasCustomBody.value || props.headerOnly) {
    return {}
  }
  // Classic columns and swimlane cells (hideHeader + externalScroller).
  if (props.hideHeader && !props.externalScroller) {
    return {}
  }
  if (!activeDrag.value?.cardName) {
    return {}
  }
  const allowed = isTargetDropAllowed(activeDrag.value.cardName)
  return {
    'kanban-column-drop-allowed': allowed,
    'kanban-column-drop-forbidden': !allowed,
  }
})
const columnWidthPx = computed(() => {
  if (Number.isFinite(resizePreviewWidth.value)) {
    return resizePreviewWidth.value
  }
  return resolveColumnWidthPx(props.column)
})
const columnClasses = computed(() => ({
  ...columnDropClasses.value,
  'kanban-column--collapsed': collapsed.value,
  'kanban-column--resizing': Number.isFinite(resizePreviewWidth.value),
  'kanban-column--cell': props.hideHeader,
  'kanban-column--header-only': props.headerOnly,
  'kanban-column--external-scroller': Boolean(props.externalScroller),
  'kanban-column--swimlane-shell': hasCustomBody.value,
}))
const showForbiddenOverlay = computed(() => {
  if (hasCustomBody.value || props.headerOnly) {
    return false
  }
  if (props.hideHeader && !props.externalScroller) {
    return false
  }
  if (!activeDrag.value?.cardName) {
    return false
  }
  return !isTargetDropAllowed(activeDrag.value.cardName)
})
const pagination = computed(() => {
  if (props.laneKey != null && store.getters.swimlanesEnabled) {
    return store.getters.getCellPagination(props.laneKey, props.column.column_name)
  }
  return store.state.columnPagination[columnKey.value] || {
    loading: false,
    hasMore: false,
  }
})
const columnTotal = computed(() => {
  if (Number.isFinite(props.totalOverride)) {
    return props.totalOverride
  }
  if (props.laneKey != null && store.getters.swimlanesEnabled) {
    return store.getters.getCellTotal(props.laneKey, props.column.column_name)
  }
  return store.state.columnTotals[columnKey.value]
})
const totalDisplay = computed(
  () => Number.isFinite(columnTotal.value) ? columnTotal.value : '…',
)
const columnLabel = computed(
  () => props.column.display_name || props.column.column_name,
)
const doctypeLabel = computed(() => __(props.config.ref_doctype))
const columnAriaLabel = computed(() => {
  if (activeDrag.value?.cardName) {
    const allowed = isTargetDropAllowed(activeDrag.value.cardName)
    if (allowed) {
      return __('{0}, drop allowed', [columnLabel.value])
    }
    return __('{0}, drop not allowed', [columnLabel.value])
  }
  const base = Number.isFinite(columnTotal.value)
    ? __('{0}, {1} records', [columnLabel.value, columnTotal.value])
    : __('{0}, total loading', [columnLabel.value])
  if (collapsed.value) {
    return __('{0}, collapsed', [base], COLUMN_CTX)
  }
  return base
})

function setCollapsed(nextCollapsed) {
  store.commit('SET_COLUMN_COLLAPSED', {
    columnKey: columnKey.value,
    collapsed: nextCollapsed,
  })
}

function toggleCollapsedFromMenu() {
  setCollapsed(!collapsed.value)
  closeColorMenu()
}

function onCountDblclick() {
  if (collapsed.value) {
    setCollapsed(false)
    return
  }
  openListForColumn()
}

function onColumnDblclick(event) {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  if (
    target.closest('.column-count')
    || target.closest('.quick-kanban-column-menu')
    || target.closest('.header-item')
    || target.closest('.kanban-card')
    || target.closest('.addcard')
    || target.closest('.column-footer-actions')
    || target.closest('.column-scroll-top')
    || target.closest('button')
    || target.closest('a')
  ) {
    return
  }
  setCollapsed(!collapsed.value)
}

function clearExpandOnDragTimer() {
  if (expandOnDragTimer) {
    clearTimeout(expandOnDragTimer)
    expandOnDragTimer = null
  }
}

function scheduleExpandOnDrag() {
  if (!collapsed.value || !activeDrag.value?.cardName) {
    return
  }
  if (expandOnDragTimer) {
    return
  }
  expandOnDragTimer = setTimeout(() => {
    expandOnDragTimer = null
    if (collapsed.value && activeDrag.value?.cardName) {
      setCollapsed(false)
    }
  }, COLUMN_DRAG_EXPAND_DELAY_MS)
}

function isLeavingColumn(event) {
  const related = event.relatedTarget
  const root = columnRootRef.value
  if (!(related instanceof Node) || !root) {
    return true
  }
  return !root.contains(related)
}

function onColumnPointerEnter() {
  scheduleExpandOnDrag()
}

function onColumnPointerLeave(event) {
  if (isLeavingColumn(event)) {
    clearExpandOnDragTimer()
  }
}

function onColumnDragEnter(event) {
  event.preventDefault?.()
  scheduleExpandOnDrag()
}

function onColumnDragLeave(event) {
  if (isLeavingColumn(event)) {
    clearExpandOnDragTimer()
  }
}

function endResizeSession() {
  if (!resizeSession) {
    return
  }
  const { pointerId, onMove, onUp, onCancel } = resizeSession
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
  document.body.classList.remove('kanban-column-resize-active')
  try {
    columnRootRef.value?.releasePointerCapture?.(pointerId)
  } catch {
    // Pointer may already be released.
  }
  resizeSession = null
}

function applyResizePreview(widthPx, resizeAll, previousWidths) {
  const nextWidth = clampColumnWidthForResize(widthPx)
  resizePreviewWidth.value = nextWidth
  if (resizeAll) {
    const widths = {}
    for (const column of store.state.columns) {
      widths[column.column_name] = nextWidth
    }
    store.commit('UPDATE_COLUMN_WIDTHS', widths)
    return nextWidth
  }
  store.commit('UPDATE_COLUMN_WIDTHS', {
    ...previousWidths,
    [props.column.column_name]: nextWidth,
  })
  return nextWidth
}

function onResizePointerDown(event) {
  if (!canEditBoard.value || collapsed.value || event.button !== 0) {
    return
  }
  const startX = event.clientX
  const startWidth = resolveColumnWidthPx(props.column)
  const previousWidths = Object.fromEntries(
    store.state.columns.map((column) => [
      column.column_name,
      column.custom_column_width,
    ]),
  )

  const onMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX
    applyResizePreview(startWidth + delta, moveEvent.shiftKey, previousWidths)
  }

  const finish = async (endEvent) => {
    const delta = endEvent.clientX - startX
    const resizeAll = Boolean(endEvent.shiftKey)
    const nextWidth = clampColumnWidthForResize(startWidth + delta)
    endResizeSession()
    resizePreviewWidth.value = null

    if (!resizeAll && nextWidth === startWidth) {
      store.commit('UPDATE_COLUMN_WIDTHS', previousWidths)
      return
    }

    const widths = resizeAll
      ? Object.fromEntries(
        store.state.columns.map((column) => [column.column_name, nextWidth]),
      )
      : { [props.column.column_name]: nextWidth }

    store.commit('UPDATE_COLUMN_WIDTHS', {
      ...previousWidths,
      ...widths,
    })

    try {
      await store.dispatch('setColumnWidths', widths)
    } catch {
      store.commit('UPDATE_COLUMN_WIDTHS', previousWidths)
    }
  }

  const onUp = (upEvent) => {
    finish(upEvent)
  }
  const onCancel = (cancelEvent) => {
    endResizeSession()
    resizePreviewWidth.value = null
    store.commit('UPDATE_COLUMN_WIDTHS', previousWidths)
    cancelEvent.preventDefault?.()
  }

  resizeSession = {
    pointerId: event.pointerId,
    onMove,
    onUp,
    onCancel,
  }
  document.body.classList.add('kanban-column-resize-active')
  columnRootRef.value?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  applyResizePreview(startWidth, event.shiftKey, previousWidths)
}

onMounted(() => {
  nextTick(() => bindScrollTopListeners())
})

onBeforeUnmount(() => {
  if (scrollTopRaf != null) {
    cancelAnimationFrame(scrollTopRaf)
    scrollTopRaf = null
  }
  unbindScrollTopListeners()
  clearExpandOnDragTimer()
  if (resizeSession) {
    const previousWidths = Object.fromEntries(
      store.state.columns.map((column) => [
        column.column_name,
        column.custom_column_width,
      ]),
    )
    endResizeSession()
    resizePreviewWidth.value = null
    store.commit('UPDATE_COLUMN_WIDTHS', previousWidths)
  }
})

function drag(evt) {
  emits("dragstart", {
    cardName: evt.key,
    fromColumn: props.columnIndex,
    fromIndex: evt.index,
    fromLaneIndex: props.laneIndex,
    fromLaneKey: props.laneKey,
  })
}

function loadNextPage() {
  if (pagination.value.loading || !pagination.value.hasMore) {
    return Promise.resolve(false)
  }
  if (props.laneIndex != null && store.getters.swimlanesEnabled) {
    return store.dispatch("loadCellPage", {
      laneIndex: props.laneIndex,
      columnIndex: props.columnIndex,
      args: window.cur_list?.get_args?.(),
    }).catch(() => {})
  }
  return store.dispatch("loadColumnPage", {
    columnIndex: props.columnIndex,
    args: window.cur_list?.get_args?.(),
  }).catch(() => {})
}

function handleNativeScroll(event) {
  updateScrollTopVisibility(event.currentTarget)
  if (isNearScrollEnd(event.currentTarget)) {
    loadNextPage()
  }
}

const columnCreateOptions = computed(
  () => store.state.createOptionsByColumn?.[props.column.column_name],
)
/** Hide when server policy explicitly denies create for this column. */
const createAllowed = computed(() => columnCreateOptions.value?.allowed !== false)
/** Keep clickable while options still loading (blocked message on click). */
const createBlocked = computed(() => (
  Boolean(columnCreateOptions.value && columnCreateOptions.value.allowed === false)
))

function startCreate(_columnName) {
  store.dispatch('startCreateCard', {
    columnIndex: props.columnIndex,
    column: props.column,
    laneKey: props.laneKey,
  })
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

function updateScrollTopVisibility(listEl = null) {
  if (collapsed.value || props.column.cards.length === 0) {
    showScrollTop.value = false
    return
  }
  const external = resolveScrollElement(props.externalScroller)
  if (external) {
    const columnEl = columnRootRef.value
    if (!columnEl) {
      showScrollTop.value = false
      return
    }
    const stickyBottom = getLaneStickyBottom(external, columnEl)
    showScrollTop.value = (
      columnEl.getBoundingClientRect().top < stickyBottom - SCROLL_TOP_VISIBLE_PX
    )
    return
  }
  const scrollList = listEl || columnRootRef.value?.querySelector('.kanban-card-list')
  if (!scrollList) {
    showScrollTop.value = false
    return
  }
  showScrollTop.value = scrollList.scrollTop > SCROLL_TOP_VISIBLE_PX
}

function scheduleScrollTopUpdate() {
  if (scrollTopRaf != null) {
    return
  }
  scrollTopRaf = requestAnimationFrame(() => {
    scrollTopRaf = null
    updateScrollTopVisibility()
  })
}

function unbindScrollTopListeners() {
  if (boundExternalScroller && onExternalScroll) {
    boundExternalScroller.removeEventListener('scroll', onExternalScroll)
  }
  boundExternalScroller = null
  onExternalScroll = null
  if (boundListScroller && onListScroll) {
    boundListScroller.removeEventListener('scroll', onListScroll)
  }
  boundListScroller = null
  onListScroll = null
  if (externalResizeObserver) {
    externalResizeObserver.disconnect()
    externalResizeObserver = null
  }
}

function bindScrollTopListeners() {
  unbindScrollTopListeners()
  const external = resolveScrollElement(props.externalScroller)
  if (external) {
    boundExternalScroller = external
    onExternalScroll = () => scheduleScrollTopUpdate()
    external.addEventListener('scroll', onExternalScroll, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      externalResizeObserver = new ResizeObserver(() => scheduleScrollTopUpdate())
      externalResizeObserver.observe(external)
      if (columnRootRef.value) {
        externalResizeObserver.observe(columnRootRef.value)
      }
    }
    scheduleScrollTopUpdate()
    return
  }
  const listEl = columnRootRef.value?.querySelector('.kanban-card-list')
  if (listEl) {
    boundListScroller = listEl
    onListScroll = () => updateScrollTopVisibility(listEl)
    listEl.addEventListener('scroll', onListScroll, { passive: true })
  }
  updateScrollTopVisibility(listEl)
}

function scrollColumnToTop() {
  const external = resolveScrollElement(props.externalScroller)
  if (external) {
    const columnEl = columnRootRef.value
    if (!columnEl) {
      return
    }
    const stickyBottom = getLaneStickyBottom(external, columnEl)
    const nextTop = external.scrollTop
      + (columnEl.getBoundingClientRect().top - stickyBottom)
    external.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' })
    return
  }

  const listEl = columnRootRef.value?.querySelector('.kanban-card-list')
  if (listEl) {
    listEl.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

watch(
  () => [
    props.externalScroller,
    props.column.column_name,
    props.laneKey,
    dragSyncGeneration.value,
  ],
  () => {
    nextTick(() => bindScrollTopListeners())
  },
  { immediate: true },
)

watch(
  () => [props.column.cards.length, collapsed.value],
  () => {
    if (props.externalScroller) {
      scheduleScrollTopUpdate()
      return
    }
    updateScrollTopVisibility()
  },
)

function openListForColumn() {
  openColumnListView(props.config, props.column)
}

function getColumnStyle(columnIndicator) {
  if (props.hideHeader) {
    return {
      backgroundColor: 'transparent',
      color: 'inherit',
      width: '100%',
      maxWidth: 'none',
      flexBasis: 'auto',
      minHeight: 0,
    }
  }
  const color = getIndicatorClass(columnIndicator);
  const style = {
    backgroundColor: `var(--kanban-column-${color})`,
    color: `var(--text-on-${color}, var(--text-color))`,
  }
  if (props.headerOnly) {
    style.width = '100%'
    style.flexBasis = 'auto'
    style.maxWidth = 'none'
    style.minHeight = 0
    return style
  }
  const widthPx = collapsed.value
    ? COLLAPSED_COLUMN_WIDTH_PX
    : columnWidthPx.value
  style.width = `${widthPx}px`
  style.flexBasis = `${widthPx}px`
  return style
}

function setIndicator(indicator) {
  store.dispatch("setIndicator", {
    indicator,
    columnIndex: props.columnIndex,
  });
  closeColorMenu()
}

function hideColumn() {
  closeColorMenu()
  store.dispatch("hideColumn", {
    columnIndex: props.columnIndex,
  })
}

function closeColorMenu({ restoreFocus = true } = {}) {
  colorMenuOpen.value = false
  columnMenuStyle.value = {}
  if (restoreFocus) nextTick(() => colorMenuButton.value?.focus())
}

function positionCollapsedColorMenu() {
  const triggerRect = colorMenuButton.value?.getBoundingClientRect()
  const menuRect = colorMenuPanel.value?.getBoundingClientRect()
  if (!triggerRect || !menuRect) return

  const margin = 8
  const gap = 4
  const preferredLeft = triggerRect.right + gap
  const flippedLeft = triggerRect.left - menuRect.width - gap
  const left = preferredLeft + menuRect.width <= window.innerWidth - margin
    ? Math.max(margin, preferredLeft)
    : Math.max(margin, Math.min(flippedLeft, window.innerWidth - menuRect.width - margin))

  const preferredTop = triggerRect.top
  const top = preferredTop + menuRect.height <= window.innerHeight - margin
    ? Math.max(margin, preferredTop)
    : Math.max(margin, triggerRect.bottom - menuRect.height)

  columnMenuStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    visibility: 'visible',
  }
}

function toggleColorMenu() {
  if (colorMenuOpen.value) {
    closeColorMenu()
    return
  }

  if (!collapsed.value) {
    columnMenuStyle.value = {}
    colorMenuOpen.value = true
    return
  }

  columnMenuStyle.value = { visibility: 'hidden' }
  colorMenuOpen.value = true
  nextTick(() => positionCollapsedColorMenu())
}

function scrollToCard(cardName, cardIndex) {
  if (Number.isFinite(cardIndex)) {
    virtualListRef.value?.scrollToIndex?.(cardIndex)
    return
  }
  virtualListRef.value?.scrollToKey?.(cardName)
}

defineExpose({
  scrollToCard,
  updateScrollTopVisibility,
  getRootEl: () => columnRootRef.value,
})
</script>
