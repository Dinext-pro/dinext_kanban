<template>
  <section class="kanban-shell" :aria-label="__('Kanban board {0}', [config.board_name])">
    <div v-if="loading" class="kanban-state" role="status">
      <span class="loading-indicator" aria-hidden="true"></span>
      {{ __('Loading Kanban board…') }}
    </div>

    <div v-if="error" class="kanban-state kanban-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn btn-default btn-sm" @click="retry">
        {{ __('Retry') }}
      </button>
    </div>

    <div
      ref="kanbanBoard"
      class="kanban"
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
import AddColumnControl from "./AddColumnControl.vue";
import {
  createColumnSortable,
  destroyColumnSortable,
} from "../../utils/columnSortable";
import { createTagDragController } from "../../utils/tagDragDrop";
import {
  animateCardRollback,
  captureCardRect,
} from "../../utils/cardRollbackAnimation";
import { flashMovedCard } from "../../utils/cardMoveFlash";
import {
  revealCardInColumn,
  resolveScrollBehavior,
  scrollColumnIntoView,
} from "../../utils/menuMoveScroll";

const store = useStore();
const columns = computed(() => store.getters.getColumns);
const config = computed(() => store.getters.getConfig);
const canEditBoard = computed(() => store.getters.canEditBoard);
const showAddColumn = computed(
  () => canEditBoard.value && (store.getters.getAddableColumns || []).length > 0,
);
const kanbanBoard = ref(null);
const columnRefs = ref([])
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

const currentBoardName = () => frappe.get_route()[3]

tagDragController = createTagDragController({
  store,
  getDoctype: () => store.state.config?.ref_doctype || '',
  onDrop: (payload) => store.dispatch('persistTagTransfer', payload),
})
provide('tagDragController', tagDragController)

function clearActiveDragVisual() {
  store.commit('SET_ACTIVE_DRAG', null)
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

async function scrollToMovedCard({ columnIndex, cardName, cardIndex }) {
  await nextTick()
  await nextTick()

  const board = kanbanBoard.value
  const columnComponent = columnRefs.value[columnIndex]
  const columnEl = columnComponent?.$el
  if (board && columnEl) {
    scrollColumnIntoView(columnEl, board, {
      behavior: resolveScrollBehavior(),
    })
  }

  const listEl = columnEl?.querySelector?.('.kanban-card-list') || null
  await revealCardInColumn({
    cardName,
    cardIndex,
    listEl,
    root: board || document,
    scrollToCard: columnComponent?.scrollToCard?.bind(columnComponent),
  })
}

provide('scrollToMovedCard', scrollToMovedCard)

function teardownColumnSortable() {
  destroyColumnSortable(columnSortable)
  columnSortable = null
}

function setupColumnSortable() {
  teardownColumnSortable()
  const board = kanbanBoard.value
  if (!board || !canEditBoard.value || columns.value.length < 2) {
    return
  }
  columnSortable = createColumnSortable(board, {
    onReorder(order) {
      store.dispatch('updateColumnOrder', order)
    },
  })
}

watch(
  [canEditBoard, () => columns.value.length, () => config.value.board_name],
  async () => {
    await nextTick()
    setupColumnSortable()
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
  nextTick(() => setupColumnSortable())
  if (globalThis.__quickKanbanExposeColumnReorder) {
    globalThis.__reorderQuickKanbanColumns = (order) =>
      store.dispatch('updateColumnOrder', order)
  }
  onPointerUp = () => clearActiveDragVisual()
  onPointerCancel = () => clearActiveDragVisual()
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
});

onBeforeUnmount(() => {
  teardownColumnSortable()
  unbindClickDrag();
  tagDragController?.destroy()
  tagDragController = null
  if (onPointerUp) {
    document.removeEventListener('pointerup', onPointerUp)
  }
  if (onPointerCancel) {
    document.removeEventListener('pointercancel', onPointerCancel)
  }
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
}

async function drop(event) {
  clearActiveDragVisual()

  const context = dragContext
  dragContext = null

  if (!context) {
    return
  }

  const toColumn = Number(event.event?.to?.id)
  const fromColumn = Number(event.event?.from?.id ?? context.fromColumn)

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
