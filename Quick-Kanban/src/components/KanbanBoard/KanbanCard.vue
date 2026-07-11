<template>
  <article
    class="kanban-card"
    role="listitem"
    :aria-busy="pending"
  >
    <header class="kanban-title-area">
      <a :href="getUrl()" draggable="false" class="card-title" :title="title">
        {{ title }}
      </a>
      <span
        class="drag-handle drag"
        :aria-label="__('Drag {0}', [title])"
        role="img"
      >
        <svg class="icon icon-sm" aria-hidden="true">
          <use href="#icon-drag"></use>
        </svg>
      </span>
    </header>

    <dl
      v-if="displayFields.length"
      class="kanban-card-fields"
      :class="{ 'values-only': !config.show_labels }"
    >
      <template v-for="field in displayFields" :key="field.fieldname">
        <dt v-if="config.show_labels">{{ field.label }}</dt>
        <dd
          :class="{ 'field-without-label': !config.show_labels }"
          :data-fieldtype="field.fieldtype"
          v-html="formatValue(field)"
        ></dd>
      </template>
    </dl>

    <div class="kanban-card-meta">
      <span
        v-if="highlightValue"
        class="kanban-highlight"
        :style="highlightStyle"
      >
        {{ highlightValue }}
      </span>

      <div class="kanban-card-actions">
        <div
          class="compact-move-menu"
          @keydown.esc.prevent="closeMoveMenu"
        >
          <button
            ref="moveMenuButton"
            type="button"
            class="card-action-button"
            :aria-label="__('Move {0}', [title])"
            :aria-expanded="String(moveMenuOpen)"
            :disabled="pending"
            @click="toggleMoveMenu"
          >
            <svg class="icon icon-sm" aria-hidden="true">
              <use href="#icon-move"></use>
            </svg>
          </button>
        </div>
        <Teleport to="body">
          <div
              v-if="moveMenuOpen"
              ref="moveMenuPanel"
              class="move-card-menu"
              role="group"
              :aria-label="__('Move {0} to column', [title])"
              :style="moveMenuStyle"
              @keydown.esc.prevent="closeMoveMenu"
            >
            <button
            v-for="(column, index) in columns"
            :key="column.name"
              v-show="index !== columnIndex"
              type="button"
              class="dropdown-item"
              :aria-label="__('Move {0} to {1}', [title, column.column_name])"
              @click="moveCard(index)"
            >
              {{ column.column_name }}
            </button>
          </div>
        </Teleport>

        <Assignments
          :assignments="card._assign"
          @assign-edit="openAssignmentDialog"
          @assign-add="openAssignToDialog"
        />
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { useStore } from 'vuex'
import Assignments from '../Assignments.vue'
import { formatCardField } from '../../utils/kanban'
import { useDismissibleMenu } from '../../utils/menu'

const props = defineProps({
  card: { type: Object, required: true },
  config: { type: Object, required: true },
  columnIndex: { type: Number, required: true },
})
const store = useStore()
const __ = globalThis.__
const moveMenuButton = ref(null)
const moveMenuPanel = ref(null)
const moveMenuOpen = ref(false)
const moveMenuStyle = ref({})

useDismissibleMenu({
  isOpen: moveMenuOpen,
  triggerRef: moveMenuButton,
  menuRef: moveMenuPanel,
  close: closeMoveMenu,
})

const columns = computed(() => store.state.columns)
const pending = computed(() => store.getters.isMovePending(props.card.name))
const title = computed(() =>
  props.card[props.config.title_field] || props.card.name,
)
const displayFields = computed(() => props.config.display_fields || [])
const highlightValue = computed(() =>
  props.config.highlighted_field
    ? props.card[props.config.highlighted_field]
    : '',
)
const highlightStyle = computed(() => {
  const configured = props.config.highlight_table.find(
    ({ tag }) => tag === highlightValue.value,
  )
  const color = configured?.color || 'gray'
  return {
    backgroundColor: `var(--${color}-200, var(--gray-200))`,
    color: `var(--${color}-800, var(--gray-800))`,
  }
})

function formatValue(field) {
  return formatCardField(props.card[field.fieldname], field, frappe.format, props.card)
}

function getUrl() {
  return frappe.utils.get_form_link(
    props.config.ref_doctype,
    props.card.name,
  )
}

async function moveCard(toColumn) {
  const fromIndex = columns.value[props.columnIndex].cards.findIndex(
    ({ name }) => name === props.card.name,
  )
  closeMoveMenu()
  if (toColumn === props.columnIndex || fromIndex < 0) return

  try {
    await store.dispatch('moveCard', {
      cardName: props.card.name,
      fromColumn: props.columnIndex,
      toColumn,
      fromIndex,
      toIndex: columns.value[toColumn].cards.length,
    })
  } catch {
    // The store restores the card and exposes the error to the user.
  }
}

function closeMoveMenu({ restoreFocus = true } = {}) {
  moveMenuOpen.value = false
  if (restoreFocus) nextTick(() => moveMenuButton.value?.focus())
}

function toggleMoveMenu() {
  if (moveMenuOpen.value) {
    closeMoveMenu()
    return
  }

  moveMenuStyle.value = { visibility: 'hidden' }
  moveMenuOpen.value = true
  nextTick(() => {
    const triggerRect = moveMenuButton.value?.getBoundingClientRect()
    const menuRect = moveMenuPanel.value?.getBoundingClientRect()
    if (!triggerRect || !menuRect) return
    const margin = 8
    const left = Math.min(
      Math.max(margin, triggerRect.right - menuRect.width),
      window.innerWidth - menuRect.width - margin,
    )
    const preferredTop = triggerRect.bottom + 4
    const top = preferredTop + menuRect.height <= window.innerHeight - margin
      ? preferredTop
      : Math.max(margin, triggerRect.top - menuRect.height - 4)
    moveMenuStyle.value = {
      top: `${top}px`,
      left: `${left}px`,
      visibility: 'visible',
    }
  })
}

function openAssignToDialog() {
  const dialog = new frappe.ui.form.AssignToDialog({
    obj: props.card,
    method: 'frappe.desk.form.assign_to.add',
    doctype: props.config.ref_doctype,
    docname: props.card.name,
    callback: () => store.dispatch('refreshCard', { cardName: props.card.name }),
  })
  dialog.dialog.show()
}

function openAssignmentDialog() {
  new frappe.ui.form.AssignmentDialog({
    assignments: Object.keys(props.card._assign),
    frm: {
      doctype: props.config.ref_doctype,
      docname: props.card.name,
      perm: [{ write: 1 }],
      assign_to: {
        render: () => store.dispatch('refreshCard', { cardName: props.card.name }),
      },
    },
  })
}
</script>