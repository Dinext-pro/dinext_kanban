<template>
  <section
    class="kanban-column"
    :class="columnDropClasses"
    role="region"
    :aria-label="columnAriaLabel"
    :data-column-value="column.column_name"
    :style="getColumnStyle(column.indicator)"
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
          :title="__('Double-click to open filtered list')"
          @dblclick.prevent="openListForColumn"
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
        >
          <button
            ref="colorMenuButton"
            type="button"
            class="header-item"
            :aria-label="__('Change {0} column color', [columnLabel])"
            :aria-expanded="String(colorMenuOpen)"
            @click="colorMenuOpen = !colorMenuOpen"
          >
            <svg class="icon icon-sm" aria-hidden="true">
              <use href="#icon-dot-horizontal"></use>
            </svg>
          </button>

          <div
            v-if="colorMenuOpen"
            ref="colorMenuPanel"
            class="column-dropdown button-group"
            role="group"
            :aria-label="__('Column colors')"
          >
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
        </div>

        <button
          type="button"
          class="header-item"
          :aria-label="__('Add {0} to {1}', [config.ref_doctype, columnLabel])"
          @click="startCreate"
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
        <div class="addcard">
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
import { computed, nextTick, ref } from "vue";
import { useStore } from "vuex";
import VirtualList from "vue-virtual-draglist";
import { getIndicators } from "../../utils/colors";
import { getColumnKey, getIndicatorClass, isNearScrollEnd } from "../../utils/kanban";
import { openColumnListView } from "../../utils/listNavigation";
import { useDismissibleMenu } from "../../utils/menu";
import KanbanCard from "./KanbanCard.vue";
import IndicatorPill from "../IndicatorPill.vue";

const store = useStore();
const canEditBoard = computed(() => store.getters.canEditBoard)
const cardsLimit = ref(30);
const virtualListRef = ref(null)
const colorMenuButton = ref(null)
const colorMenuPanel = ref(null)
const colorMenuOpen = ref(false)
const __ = globalThis.__
const indicators = computed(() => getIndicators())

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
const showForbiddenOverlay = computed(() => {
  if (!activeDrag.value?.cardName) {
    return false
  }
  return !store.getters.isDropAllowed({
    cardName: activeDrag.value.cardName,
    columnIndex: props.columnIndex,
  })
})
const columnKey = computed(() => getColumnKey(props.column))
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
  return Number.isFinite(columnTotal.value)
    ? __('{0}, {1} records', [columnLabel.value, columnTotal.value])
    : __('{0}, total loading', [columnLabel.value])
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

function closeColorMenu({ restoreFocus = true } = {}) {
  colorMenuOpen.value = false
  if (restoreFocus) nextTick(() => colorMenuButton.value?.focus())
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
