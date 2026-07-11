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
        :key="column.name"
        :column="column"
        :columnIndex="columnIndex"
        :config="config"
        @dragstart="rememberDrag"
        @drop="drop"
      />
      <p v-if="!loading && !error && columns.length === 0" class="kanban-state">
        {{ __('No columns are configured for this board.') }}
      </p>
    </div>

    <p class="sr-only" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import KanbanColumn from "./KanbanColumn.vue";

const store = useStore();
const columns = computed(() => store.getters.getColumns);
const config = computed(() => store.getters.getConfig);
const kanbanBoard = ref(null);
const loading = computed(() => store.state.loading)
const error = computed(() => store.state.error)
const announcement = computed(() => store.state.announcement)
const __ = globalThis.__
let dragContext = null
let hydrationToken = 0
let onMouseDown
let onMouseLeave
let onMouseUp
let onMouseMove

const currentBoardName = () => frappe.get_route()[3]

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
});

onBeforeUnmount(() => {
  unbindClickDrag();
  delete window.refreshKanbanBoard
  delete window.hydrateQuickKanban
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
}

function drop(event) {
  if (event.oldIndex !== -1 || !dragContext) return

  const toColumn = Number(event.event.to.id)
  if (toColumn === dragContext.fromColumn) return
  store.dispatch("persistMovedCard", {
    ...dragContext,
    toColumn,
    toIndex: event.newIndex,
  }).catch(() => {})
  dragContext = null
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
