<template>
  <section
    class="kanban-column"
    role="region"
    :aria-label="columnAriaLabel"
    :style="getColumnStyle(column.indicator)"
  >
    <header class="kanban-column-header">
      <div class="column-heading">
        <span
          class="column-count"
          :class="Number.isFinite(columnTotal)
            ? getIndicatorClass(column.indicator)
            : 'loading'"
        >
          {{ totalDisplay }}
        </span>
        <h2 :id="headingId" class="column-title">
          {{ column.column_name }}
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
            :aria-label="__('Change {0} column color', [column.column_name])"
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
              :aria-label="__('Set {0} color to {1}', [column.column_name, indicator.name])"
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
          :aria-label="__('Add {0} to {1}', [config.ref_doctype, column.column_name])"
          @click="newDoc(column.column_name)"
        >
          <svg class="icon icon-sm" aria-hidden="true">
            <use href="#icon-add"></use>
          </svg>
        </button>
      </div>
    </header>

    <VirtualList
      v-model="cards"
      role="list"
      tabindex="0"
      :aria-label="__('Cards in {0}', [column.column_name])"
      @drag="drag"
      @drop="emits('drop', $event)"
      @bottom="loadNextPage"
      @scroll.passive="handleNativeScroll"
      :dataKey="'name'"
      :id="columnIndex"
      class="kanban-card-list"
      :handle="'.drag-handle'"
      :disabled="dragDisabled"
      :keeps="cardsLimit"
      group="kanban"
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
            @click="newDoc(column.column_name)"
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
import { getIndicatorClass, isNearScrollEnd } from "../../utils/kanban";
import { useDismissibleMenu } from "../../utils/menu";
import KanbanCard from "./KanbanCard.vue";
import IndicatorPill from "../IndicatorPill.vue";

const store = useStore();
const cardsLimit = ref(30);
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
const pagination = computed(
  () => store.state.columnPagination[props.column.name || props.column.column_name] || {
    loading: false,
    hasMore: false,
  },
)
const columnTotal = computed(
  () => store.state.columnTotals[props.column.name || props.column.column_name],
)
const totalDisplay = computed(
  () => Number.isFinite(columnTotal.value) ? columnTotal.value : '…',
)
const columnAriaLabel = computed(
  () => Number.isFinite(columnTotal.value)
    ? __('{0}, {1} records', [props.column.column_name, columnTotal.value])
    : __('{0}, total loading', [props.column.column_name]),
)

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

function newDoc(field) {
  frappe.new_doc(props.config.ref_doctype, {
    [props.config.field_name]: field,
  });
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
</script>
