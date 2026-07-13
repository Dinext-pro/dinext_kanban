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
    />
    <header class="kanban-column-header">
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
          :class="{ 'column-title--draggable': canEditBoard }"
          :title="canEditBoard ? __('Drag to reorder column') : undefined"
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
          v-show="!collapsed"
          type="button"
          class="header-item"
          :aria-label="__('Add {0} to {1}', [config.ref_doctype, columnLabel])"
          @click="startCreate"
          @dblclick.stop
        >
          <svg class="icon icon-sm" aria-hidden="true">
            <use href="#icon-add"></use>
          </svg>
        </button>
      </div>
    </header>

    <VirtualList
      ref="virtualListRef"
      v-model="cards"
      :key="`${column.name || column.column_name}-${dragSyncGeneration}`"
      role="list"
      tabindex="0"
      :aria-label="__('Cards in {0}', [columnLabel])"
      :aria-hidden="collapsed ? 'true' : undefined"
      @drag="drag"
      @drop="emits('drop', $event)"
      @bottom="loadNextPage"
      @scroll.passive="handleNativeScroll"
      :dataKey="'name'"
      :id="columnIndex"
      class="kanban-card-list"
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
        />
      </template>

      <template #footer>
        <p v-if="pagination.loading" class="column-loading" role="status">
          {{ __('Loading more cards…') }}
        </p>
        <p v-if="column.cards.length === 0" class="empty-column">
          {{ __('No cards') }}
        </p>
        <div v-show="!collapsed" class="addcard">
          <button
            type="button"
            @click="startCreate"
            class="btn btn-default btn-sm w-100"
          >
            <svg class="icon icon-xs" aria-hidden="true">
              <use href="#icon-add"></use>
            </svg>
            <span>{{ __('Add {0}', [config.ref_doctype]) }}</span>
          </button>
        </div>
      </template>
    </VirtualList>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useStore } from "vuex";
import VirtualList from "vue-virtual-draglist";
import { getIndicators } from "../../utils/colors";
import {
  COLUMN_DRAG_EXPAND_DELAY_MS,
  getColumnKey,
  getIndicatorClass,
  isNearScrollEnd,
  QUICK_KANBAN_COLUMN_TRANSLATION_CONTEXT,
} from "../../utils/kanban";
import { openColumnListView } from "../../utils/listNavigation";
import { useDismissibleMenu } from "../../utils/menu";
import KanbanCard from "./KanbanCard.vue";
import IndicatorPill from "../IndicatorPill.vue";

const COLUMN_CTX = QUICK_KANBAN_COLUMN_TRANSLATION_CONTEXT
const store = useStore();
const canEditBoard = computed(() => store.getters.canEditBoard)
const cardsLimit = ref(30);
const virtualListRef = ref(null)
const colorMenuButton = ref(null)
const colorMenuPanel = ref(null)
const colorMenuOpen = ref(false)
const columnMenuStyle = ref({})
const columnRootRef = ref(null)
const __ = globalThis.__
const indicators = computed(() => getIndicators())
let expandOnDragTimer = null

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
});

const emits = defineEmits(["drop", "dragstart"]);
const headingId = `kanban-column-${props.column.name || props.columnIndex}`
const cards = computed({
  get: () => props.column.cards,
  set: (value) => store.commit("SET_COLUMN_CARDS", {
    columnIndex: props.columnIndex,
    cards: value,
  }),
})
const dragDisabled = computed(
  () => Object.keys(store.state.pendingMoves).length > 0,
)
const activeDrag = computed(() => store.getters.activeDragCard)
const dragSyncGeneration = computed(() => store.state.dragSyncGeneration)
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
      if (store.getters.activeDragCard?.cardName) {
        return true
      }
      return store.getters.isDropAllowed({
        cardName,
        columnIndex: props.columnIndex,
      })
    },
  }
})
const columnKey = computed(() => getColumnKey(props.column))
const collapsed = computed(
  () => store.getters.isColumnCollapsed(columnKey.value),
)
const columnDropClasses = computed(() => {
  if (!activeDrag.value?.cardName) {
    return {}
  }
  const allowed = store.getters.isDropAllowed({
    cardName: activeDrag.value.cardName,
    columnIndex: props.columnIndex,
  })
  return {
    'kanban-column-drop-allowed': allowed,
    'kanban-column-drop-forbidden': !allowed,
  }
})
const columnClasses = computed(() => ({
  ...columnDropClasses.value,
  'kanban-column--collapsed': collapsed.value,
}))
const showForbiddenOverlay = computed(() => {
  if (!activeDrag.value?.cardName) {
    return false
  }
  return !store.getters.isDropAllowed({
    cardName: activeDrag.value.cardName,
    columnIndex: props.columnIndex,
  })
})
const pagination = computed(
  () => store.state.columnPagination[columnKey.value] || {
    loading: false,
    hasMore: false,
  },
)
const columnTotal = computed(
  () => store.state.columnTotals[columnKey.value],
)
const totalDisplay = computed(
  () => Number.isFinite(columnTotal.value) ? columnTotal.value : '…',
)
const columnLabel = computed(
  () => props.column.display_name || props.column.column_name,
)
const columnAriaLabel = computed(() => {
  if (activeDrag.value?.cardName) {
    const allowed = store.getters.isDropAllowed({
      cardName: activeDrag.value.cardName,
      columnIndex: props.columnIndex,
    })
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

onBeforeUnmount(() => {
  clearExpandOnDragTimer()
})

function drag(evt) {
  emits("dragstart", {
    cardName: evt.key,
    fromColumn: props.columnIndex,
    fromIndex: evt.index,
  })
}

function loadNextPage() {
  if (pagination.value.loading || !pagination.value.hasMore) {
    return Promise.resolve(false)
  }
  return store.dispatch("loadColumnPage", {
    columnIndex: props.columnIndex,
    args: window.cur_list?.get_args?.(),
  }).catch(() => {})
}

function handleNativeScroll(event) {
  if (isNearScrollEnd(event.currentTarget)) {
    loadNextPage()
  }
}

function startCreate(columnName) {
  store.dispatch('startCreateCard', {
    columnIndex: props.columnIndex,
    column: props.column,
  })
}

function openListForColumn() {
  openColumnListView(props.config, props.column)
}

function getColumnStyle(columnIndicator) {
  const color = getIndicatorClass(columnIndicator);
  return {
    backgroundColor: `var(--kanban-column-${color})`,
    color: `var(--text-on-${color}, var(--text-color))`,
  };
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
})
</script>
