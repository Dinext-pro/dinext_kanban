<template>
  <div
    v-if="visible"
    class="add-column-control"
    @keydown.esc.prevent="closeMenu"
  >
    <button
      ref="triggerRef"
      type="button"
      class="add-column-trigger"
      :aria-label="__('Add column')"
      :aria-expanded="String(menuOpen)"
      :aria-haspopup="true"
      @click="toggleMenu"
    >
      <svg class="icon icon-sm" aria-hidden="true">
        <use href="#icon-add"></use>
      </svg>
      <span>{{ __('Add column') }}</span>
    </button>

    <div
      v-if="menuOpen"
      ref="menuRef"
      class="add-column-dropdown"
      role="menu"
      :aria-label="__('Available columns')"
    >
      <button
        v-for="column in addableColumns"
        :key="column.column_name"
        type="button"
        class="add-column-option"
        role="menuitem"
        :aria-label="__('Add {0} column', [columnLabel(column)])"
        @click="addColumn(column.column_name)"
      >
        <span class="ellipsis">{{ columnLabel(column) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useStore } from 'vuex'
import { useDismissibleMenu } from '../../utils/menu'

const store = useStore()
const __ = globalThis.__
const triggerRef = ref(null)
const menuRef = ref(null)
const menuOpen = ref(false)

const addableColumns = computed(() => store.getters.getAddableColumns || [])
const canEditBoard = computed(() => store.getters.canEditBoard)
const visible = computed(
  () => canEditBoard.value && addableColumns.value.length > 0,
)

useDismissibleMenu({
  isOpen: menuOpen,
  triggerRef,
  menuRef,
  close: closeMenu,
})

function columnLabel(column) {
  return column.display_name || column.column_name
}

function closeMenu({ restoreFocus = true } = {}) {
  if (!menuOpen.value) {
    return
  }
  menuOpen.value = false
  if (restoreFocus) {
    triggerRef.value?.focus?.()
  }
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

async function addColumn(columnTitle) {
  closeMenu({ restoreFocus: false })
  await store.dispatch('addColumn', { column_title: columnTitle })
}
</script>
