<template>
  <ul
    ref="mountRef"
    class="list-unstyled kanban-tags kanban-tags--editable"
    role="group"
    :aria-label="__('Tags', null, 'QuickKanban.Tags')"
    :title="__('Double-click to filter by tag', null, 'QuickKanban.Tags')"
    @pointerdown.stop="onTagsPointerDown"
    @click.stop
    @dblclick.stop="onTagDblclick"
  >
    <li class="kanban-tags-toolbar">
      <span class="form-sidebar-items"></span>
    </li>
  </ul>
</template>

<script setup>
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import {
  normalizeUserTagsForEditor,
  toListUserTags,
} from '../../utils/kanban'
import { applyUserTagFilter } from '../../utils/listNavigation'
import {
  findTagPillFromEventTarget,
  getTagLabelFromPill,
} from '../../utils/tagDragDrop'

const TAGS_TRANSLATION_CONTEXT = 'QuickKanban.Tags'

const props = defineProps({
  card: { type: Object, required: true },
  doctype: { type: String, required: true },
  userTags: { type: String, default: '' },
})

const store = useStore()
const tagDragController = inject('tagDragController', null)
const __ = globalThis.__
const mountRef = ref(null)
let editor = null
let syncingFromProps = false

function applyAddButtonChrome(root) {
  if (!root) {
    return
  }
  const addButton = root.querySelector('.add-tags-btn')
  if (!addButton) {
    return
  }
  addButton.setAttribute(
    'aria-label',
    __('Add Tag', null, TAGS_TRANSLATION_CONTEXT),
  )
  const iconUse = addButton.querySelector('use')
  if (iconUse) {
    iconUse.setAttribute('href', '#es-line-tag')
  }
}

function bindDensityHold(root) {
  if (!root) {
    return
  }
  const input = root.querySelector('input.tags-input')
  if (!input || input.dataset.kanbanDensityBound === '1') {
    return
  }
  input.dataset.kanbanDensityBound = '1'
  // Hold on user pointer interaction, not focus — TagEditor refresh after tag DnD
  // can focus the input and would re-expand a source card we just collapsed.
  input.addEventListener('pointerdown', () => {
    store.commit('SET_DENSITY_HOLD_EXPANDED', props.card.name)
  })
  input.addEventListener('blur', () => {
    store.commit('CLEAR_DENSITY_HOLD_EXPANDED', props.card.name)
  })
}

function syncTagsToStore(userTags) {
  store.commit('UPDATE_CARD_FIELD', {
    cardName: props.card.name,
    fieldname: '_user_tags',
    value: toListUserTags(userTags),
  })
}

function onTagDblclick(event) {
  const pill = findTagPillFromEventTarget(event.target)
  if (!pill) {
    return
  }
  const tag = getTagLabelFromPill(pill)
  if (!tag) {
    return
  }
  applyUserTagFilter(tag)
}

function onTagsPointerDown(event) {
  const pill = findTagPillFromEventTarget(event.target)
  if (!pill || !tagDragController) {
    return
  }
  const tag = getTagLabelFromPill(pill)
  if (!tag) {
    return
  }
  const started = tagDragController.beginPending(event, {
    tag,
    sourceCardName: props.card.name,
    sourcePill: pill,
  })
  if (started) {
    event.preventDefault()
    pill.classList.add('kanban-tag-pill--dragging')
    const clearDraggingClass = () => {
      pill.classList.remove('kanban-tag-pill--dragging')
      document.removeEventListener('pointerup', clearDraggingClass)
      document.removeEventListener('pointercancel', clearDraggingClass)
    }
    document.addEventListener('pointerup', clearDraggingClass)
    document.addEventListener('pointercancel', clearDraggingClass)
  }
}

function mountEditor() {
  const mount = mountRef.value
  const TagEditor = globalThis.frappe?.ui?.TagEditor
  if (!mount || typeof TagEditor !== 'function') {
    return
  }

  editor?.awesomplete?.destroy?.()
  editor = null

  // Keep toolbar scaffold; remove previous TagEditor rows/input.
  mount.querySelectorAll(':scope > li:not(.kanban-tags-toolbar)').forEach((node) => {
    node.remove()
  })
  mount.querySelector('.form-sidebar-items')?.replaceChildren()

  editor = new TagEditor({
    parent: globalThis.$(mount),
    frm: {
      doctype: props.doctype,
      docname: props.card.name,
    },
    user_tags: normalizeUserTagsForEditor(props.userTags),
    on_change(userTags) {
      if (syncingFromProps) {
        return
      }
      syncTagsToStore(userTags)
    },
  })

  applyAddButtonChrome(mount)
  bindDensityHold(mount)
}

function refreshEditorFromProps() {
  if (!editor || typeof editor.refresh !== 'function') {
    return
  }
  const next = normalizeUserTagsForEditor(props.userTags)
  const current = normalizeUserTagsForEditor(editor.user_tags)
  if (next === current) {
    return
  }
  syncingFromProps = true
  try {
    editor.refresh(next)
  } finally {
    syncingFromProps = false
  }
}

onMounted(() => {
  nextTick(() => {
    mountEditor()
  })
})

watch(
  () => props.userTags,
  () => {
    nextTick(refreshEditorFromProps)
  },
)

watch(
  () => [props.doctype, props.card.name],
  () => {
    nextTick(mountEditor)
  },
)

onBeforeUnmount(() => {
  store.commit('CLEAR_DENSITY_HOLD_EXPANDED', props.card.name)
  editor?.awesomplete?.destroy?.()
  editor = null
})
</script>
