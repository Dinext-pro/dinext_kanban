<template>
  <article
    class="kanban-card"
    :class="[moveFlashClasses, cardColorClass]"
    :style="cardAccentStyle"
    role="listitem"
    :aria-busy="pending"
    :data-card-name="card.name"
  >
    <header class="kanban-title-area">
      <a :href="getUrl()" draggable="false" class="card-title" :title="title">
        {{ title }}
      </a>
      <span
        v-if="canDrag"
        class="drag-handle drag"
        :aria-label="__('Drag {0}', [title])"
        role="img"
      >
        <svg class="icon icon-sm" aria-hidden="true">
          <use href="#icon-drag"></use>
        </svg>
      </span>
      <span
        v-else
        class="drag-handle drag-handle-disabled"
        :aria-label="moveBlockedLabel"
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
        <dt v-if="config.show_labels">{{ translateFieldLabel(field) }}</dt>
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
            :disabled="pending || !canMove"
            :aria-busy="String(moveOptionsLoading)"
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
            v-for="destination in allowedDestinations"
            :key="destination.column.name"
              type="button"
              class="dropdown-item"
              :aria-label="__('Move {0} to {1}', [title, getColumnLabel(destination.column)])"
              @click="moveCard(destination.columnIndex)"
            >
              {{ getColumnLabel(destination.column) }}
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
import { computed, inject, nextTick, ref } from 'vue'
import { useStore } from 'vuex'
import Assignments from '../Assignments.vue'
import { formatCardField, getCardFieldDisplayValue, parseCardAccentColor, translateFieldLabel } from '../../utils/kanban'
import { useDismissibleMenu } from '../../utils/menu'
import { flashMovedCard } from '../../utils/cardMoveFlash'

const props = defineProps({
  card: { type: Object, required: true },
  config: { type: Object, required: true },
  columnIndex: { type: Number, required: true },
})
const store = useStore()
const scrollToMovedCard = inject('scrollToMovedCard', null)
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
const moveOptionsLoading = computed(() => store.getters.isMoveOptionsLoading)
const title = computed(() =>
  getCardFieldDisplayValue(
    props.card[props.config.title_field] || props.card.name,
    props.config.title_field_meta,
  ) || props.card.name,
)
const canDrag = computed(() => store.getters.canDragCard(props.card.name))
const canMove = computed(() => store.getters.getAllowedDestinations(props.card.name).length > 0)
const allowedDestinations = computed(() =>
  store.getters.getAllowedDestinations(props.card.name)
    .filter((destination) => destination.columnIndex !== props.columnIndex),
)
const moveBlockedLabel = computed(() => {
  if (moveOptionsLoading.value) {
    return __('Move permissions are loading for {0}', [title.value])
  }
  return __('Move is not available for {0}', [title.value])
})
const displayFields = computed(() => props.config.display_fields || [])
const highlightValue = computed(() => {
  if (!props.config.highlighted_field) return ''
  return getCardFieldDisplayValue(
    props.card[props.config.highlighted_field],
    props.config.highlighted_field_meta,
  )
})
const highlightRawValue = computed(() =>
  props.config.highlighted_field
    ? props.card[props.config.highlighted_field]
    : '',
)
const highlightStyle = computed(() => {
  const configured = props.config.highlight_table.find(
    ({ tag }) => tag === highlightRawValue.value,
  )
  const color = configured?.color || 'gray'
  return {
    backgroundColor: `var(--${color}-200, var(--gray-200))`,
    color: `var(--${color}-800, var(--gray-800))`,
  }
})
const cardAccentColor = computed(() => {
  const colorField = props.config.color_field
  if (!colorField) {
    return null
  }
  return parseCardAccentColor(props.card[colorField])
})
const cardAccentStyle = computed(() => {
  if (!cardAccentColor.value) {
    return {}
  }
  return { '--card-accent-color': cardAccentColor.value }
})
const cardColorClass = computed(() =>
  cardAccentColor.value ? 'kanban-card--has-color' : '',
)
const moveFlashClasses = computed(() => {
  const flash = store.state.cardMoveFlash[props.card.name]
  if (!flash) {
    return {}
  }
  return {
    [`kanban-card-move-flash--${flash.outcome}`]: true,
    'kanban-card-move-flash--instant': flash.instant,
    'kanban-card-move-flash': !flash.instant,
  }
})

function getColumnLabel(column) {
  return column.display_name || column.column_name
}

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
  const toIndex = columns.value[toColumn].cards.length
  closeMoveMenu()
  if (toColumn === props.columnIndex || fromIndex < 0) return

  let moved = false
  try {
    moved = await store.dispatch('moveCard', {
      cardName: props.card.name,
      fromColumn: props.columnIndex,
      toColumn,
      fromIndex,
      toIndex,
    })
    if (moved && scrollToMovedCard) {
      await scrollToMovedCard({
        columnIndex: toColumn,
        cardName: props.card.name,
        cardIndex: toIndex,
      })
    }
  } catch {
    // The store restores the card and exposes the error to the user.
  } finally {
    await flashMovedCard(props.card.name, {
      outcome: moved ? 'success' : 'failure',
    })
  }
}

function closeMoveMenu({ restoreFocus = true } = {}) {
  moveMenuOpen.value = false
  if (restoreFocus) nextTick(() => moveMenuButton.value?.focus())
}

function toggleMoveMenu() {
  if (!canMove.value) {
    return
  }
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