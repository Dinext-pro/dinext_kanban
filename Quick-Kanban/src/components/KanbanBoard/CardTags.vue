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
import {
  captureTagLayoutPositions,
  scheduleTagLayoutAnimation,
} from '../../utils/tagLayoutAnimation'

const TAGS_TRANSLATION_CONTEXT = 'QuickKanban.Tags'
const TAG_EDIT_FIELDNAME = '_user_tags'
const FLOATING_TAG_UI_SELECTOR = [
  '.awesomplete > ul',
  'ul[role="listbox"]',
].join(', ')

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
let layoutPlayToken = 0
let listeningOutside = false
let boundInput = null
let boundAddButton = null

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

function isThisCardTagEditing() {
  return (
    store.state.activeInlineEdit?.cardName === props.card.name
    && store.state.activeInlineEdit?.fieldname === TAG_EDIT_FIELDNAME
  )
}

function beginTagEdit() {
  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: props.card.name,
    fieldname: TAG_EDIT_FIELDNAME,
  })
  store.commit('SET_DENSITY_HOLD_EXPANDED', props.card.name)
  startOutsideListening()
}

function endTagEdit() {
  stopOutsideListening()
  if (isThisCardTagEditing()) {
    store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  }
  store.commit('CLEAR_DENSITY_HOLD_EXPANDED', props.card.name)
}

function isRelatedFloatingTagTarget(target) {
  return target instanceof Element && Boolean(target.closest(FLOATING_TAG_UI_SELECTOR))
}

function isInsideThisCard(target) {
  if (!(target instanceof Node)) {
    return false
  }
  const card = mountRef.value?.closest?.(`.kanban-card[data-card-name="${props.card.name}"]`)
  if (card?.contains(target)) {
    return true
  }
  // Fallback when mounted without a card host (unit tests): keep clicks in the tags root.
  if (!card && mountRef.value?.contains(target)) {
    return true
  }
  return isRelatedFloatingTagTarget(target)
}

function onPointerDownOutside(event) {
  if (!isThisCardTagEditing()) {
    return
  }
  if (isInsideThisCard(event.target)) {
    return
  }
  boundInput?.blur?.()
}

function startOutsideListening() {
  if (listeningOutside) {
    return
  }
  listeningOutside = true
  document.addEventListener('pointerdown', onPointerDownOutside, true)
}

function stopOutsideListening() {
  if (!listeningOutside) {
    return
  }
  listeningOutside = false
  document.removeEventListener('pointerdown', onPointerDownOutside, true)
}

function onTagsInputPointerDown() {
  // Hold on user pointer interaction, not focus — TagEditor refresh after tag DnD
  // can focus the input and would re-expand a source card we just collapsed.
  beginTagEdit()
}

function onTagsInputBlur() {
  endTagEdit()
}

function onAddTagsButtonClick() {
  beginTagEdit()
}

function unbindTagEditLifecycle() {
  stopOutsideListening()
  if (boundInput) {
    boundInput.removeEventListener('pointerdown', onTagsInputPointerDown)
    boundInput.removeEventListener('blur', onTagsInputBlur)
    delete boundInput.dataset.kanbanTagEditBound
    boundInput = null
  }
  if (boundAddButton) {
    boundAddButton.removeEventListener('click', onAddTagsButtonClick)
    delete boundAddButton.dataset.kanbanTagEditBound
    boundAddButton = null
  }
}

function bindTagEditLifecycle(root) {
  if (!root) {
    return
  }
  unbindTagEditLifecycle()

  const input = root.querySelector('input.tags-input')
  if (input) {
    boundInput = input
    input.dataset.kanbanTagEditBound = '1'
    input.addEventListener('pointerdown', onTagsInputPointerDown)
    input.addEventListener('blur', onTagsInputBlur)
  }

  const addButton = root.querySelector('.add-tags-btn')
  if (addButton) {
    boundAddButton = addButton
    addButton.dataset.kanbanTagEditBound = '1'
    addButton.addEventListener('click', onAddTagsButtonClick)
  }
}

function syncTagsToStore(userTags) {
  store.commit('UPDATE_CARD_FIELD', {
    cardName: props.card.name,
    fieldname: '_user_tags',
    value: toListUserTags(userTags),
  })
}

function runTagLayoutAnimation(root, firstPositions) {
  if (!root || !firstPositions?.size) {
    return Promise.resolve(false)
  }
  layoutPlayToken += 1
  // Clone so later captures cannot mutate the scheduled First snapshot.
  return scheduleTagLayoutAnimation(root, new Map(firstPositions))
}

function onTagsClickCapture(event) {
  const root = mountRef.value
  if (!root || !(event.target instanceof Element)) {
    return
  }
  if (!event.target.closest('.remove-btn') && !event.target.closest('.add-tags-btn')) {
    return
  }
  runTagLayoutAnimation(root, captureTagLayoutPositions(root))
}

function onTagsFocusOutCapture(event) {
  const root = mountRef.value
  if (!root || !(event.target instanceof Element)) {
    return
  }
  if (!event.target.classList?.contains('tags-input')) {
    return
  }
  const next = event.relatedTarget
  if (next instanceof Node && root.contains(next)) {
    return
  }
  runTagLayoutAnimation(root, captureTagLayoutPositions(root))
}

function unbindTagLayoutAnimation(root) {
  if (root) {
    root.removeEventListener('click', onTagsClickCapture, true)
    root.removeEventListener('focusout', onTagsFocusOutCapture, true)
  }
  layoutPlayToken += 1
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

  endTagEdit()
  unbindTagEditLifecycle()
  unbindTagLayoutAnimation(mount)
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
  bindTagEditLifecycle(mount)
  mount.addEventListener('click', onTagsClickCapture, true)
  mount.addEventListener('focusout', onTagsFocusOutCapture, true)
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
  const root = mountRef.value
  const first = captureTagLayoutPositions(root)
  syncingFromProps = true
  try {
    editor.refresh(next)
  } finally {
    syncingFromProps = false
  }
  runTagLayoutAnimation(root, first)
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

watch(
  () => store.state.activeInlineEdit,
  (active) => {
    if (!boundInput) {
      return
    }
    const stillOurs = (
      active?.cardName === props.card.name
      && active?.fieldname === TAG_EDIT_FIELDNAME
    )
    if (stillOurs) {
      startOutsideListening()
      return
    }
    stopOutsideListening()
    if (document.activeElement === boundInput) {
      boundInput.blur()
    }
  },
)

onBeforeUnmount(() => {
  endTagEdit()
  unbindTagEditLifecycle()
  unbindTagLayoutAnimation(mountRef.value)
  editor?.awesomplete?.destroy?.()
  editor = null
})
</script>
