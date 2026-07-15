<template>
  <div
    ref="fieldRoot"
    class="kanban-inline-field"
    :class="fieldClasses"
    :data-fieldname="fieldMeta.fieldname"
    :data-fieldtype="fieldMeta.fieldtype"
    :data-role="fieldRole"
    :aria-busy="String(busy)"
    @click="onClick"
    @dblclick="onDblclick"
    @click.capture="onAnchorNavigateBlock"
    @mousedown.capture="onAnchorNavigateBlock"
  >
    <div
      v-if="!editing"
      ref="displayEl"
      class="kanban-inline-display"
      :title="plainTitle"
    >
      <template v-if="displayMode === 'text'">{{ displayText }}</template>
      <div v-else v-html="renderedDisplayHtml"></div>
    </div>
    <div
      v-else
      ref="controlParent"
      class="kanban-inline-control"
      :style="editBoxStyle"
      @click.stop
      @dblclick.stop="onDblclick"
    ></div>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'
import { useStore } from 'vuex'
import {
  buildInlineControlDf,
  canOpenInlineEditor,
  clearCardDocument,
  getInlineEditClickDelayMs,
  isInlineFieldTypeSupported,
  loadCardDocument,
  navigateToForm,
  normalizeFieldtype,
  openInlineSelectOptions,
  resolveDoubleClickNavigation,
  sanitizeDisplayHtmlForInlineEdit,
  valuesEqual,
} from '../../utils/inlineEditing'

const props = defineProps({
  card: { type: Object, required: true },
  fieldMeta: { type: Object, required: true },
  doctype: { type: String, required: true },
  fieldRole: {
    type: String,
    default: 'display',
    validator: (value) => ['title', 'display', 'highlight'].includes(value),
  },
  displayMode: {
    type: String,
    default: 'html',
    validator: (value) => ['text', 'html'].includes(value),
  },
  displayText: { type: String, default: '' },
  displayHtml: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

const FLOATING_EDIT_UI_SELECTOR = [
  '.awesomplete > ul',
  'ul[role="listbox"]',
  '.datepicker',
  '.datepicker--dropdown',
  '.datepicker-picker',
  '.flatpickr-calendar',
].join(',')

const store = useStore()
const fieldRoot = ref(null)
const displayEl = ref(null)
const controlParent = ref(null)
const editing = ref(false)
const busy = ref(false)
const clickTimer = ref(null)
const control = ref(null)
const loadedDoc = ref(null)
const originalValue = ref(null)
const suppressBlurCommit = ref(false)
const editBoxMetrics = ref(null)
let listeningOutside = false

const __ = globalThis.__

const fieldValue = computed(() => props.card[props.fieldMeta.fieldname])
const plainTitle = computed(() => {
  if (props.displayMode === 'text') {
    return props.displayText
  }
  return props.displayText || String(fieldValue.value ?? '')
})
const quickEditable = computed(
  () => !props.disabled && isInlineFieldTypeSupported(props.fieldMeta),
)
const pendingUpdate = computed(() =>
  store.getters.isFieldUpdatePending?.(props.card.name, props.fieldMeta.fieldname),
)
const renderedDisplayHtml = computed(() => {
  if (quickEditable.value) {
    return sanitizeDisplayHtmlForInlineEdit(props.displayHtml)
  }
  return props.displayHtml
})
const editBoxStyle = computed(() => {
  const metrics = editBoxMetrics.value
  if (!metrics) {
    return undefined
  }
  return {
    '--kanban-inline-edit-height': `${metrics.height}px`,
    '--kanban-inline-edit-width': `${metrics.width}px`,
    '--kanban-inline-edit-font-size': metrics.fontSize,
    '--kanban-inline-edit-line-height': metrics.lineHeight,
    '--kanban-inline-edit-font-weight': metrics.fontWeight,
    '--kanban-inline-edit-font-family': metrics.fontFamily,
    minHeight: `${metrics.height}px`,
    width: `${metrics.width}px`,
    maxWidth: '100%',
  }
})
const fieldClasses = computed(() => ({
  'is-editing': editing.value,
  'is-busy': busy.value || pendingUpdate.value,
  'is-editable': quickEditable.value && !editing.value,
  'kanban-inline-field--title': props.fieldRole === 'title',
  'kanban-inline-field--highlight': props.fieldRole === 'highlight',
}))

function clearClickTimer() {
  if (clickTimer.value) {
    clearTimeout(clickTimer.value)
    clickTimer.value = null
  }
}

function destroyControl() {
  if (control.value?.$wrapper) {
    control.value.$wrapper.off?.('.kanban-inline')
    control.value.$wrapper.remove()
  } else if (controlParent.value) {
    controlParent.value.innerHTML = ''
  }
  control.value = null
}

function isRelatedFloatingTarget(target) {
  return target instanceof Element && Boolean(target.closest(FLOATING_EDIT_UI_SELECTOR))
}

function containsEditTarget(target) {
  if (!(target instanceof Node)) {
    return false
  }
  if (fieldRoot.value?.contains(target)) {
    return true
  }
  return isRelatedFloatingTarget(target)
}

function stopOutsideListening() {
  if (!listeningOutside) {
    return
  }
  listeningOutside = false
  document.removeEventListener('pointerdown', onPointerDownOutside, true)
}

function startOutsideListening() {
  if (listeningOutside) {
    return
  }
  listeningOutside = true
  document.addEventListener('pointerdown', onPointerDownOutside, true)
}

function onPointerDownOutside(event) {
  if (!editing.value || busy.value || suppressBlurCommit.value) {
    return
  }
  if (containsEditTarget(event.target)) {
    return
  }
  suppressBlurCommit.value = true
  void commitEdit(readControlValue(control.value))
}

function closeEditor() {
  stopOutsideListening()
  destroyControl()
  editing.value = false
  busy.value = false
  loadedDoc.value = null
  originalValue.value = null
  editBoxMetrics.value = null
  if (
    store.state.activeInlineEdit?.cardName === props.card.name
    && store.state.activeInlineEdit?.fieldname === props.fieldMeta.fieldname
  ) {
    store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  }
}

async function cancelEdit() {
  suppressBlurCommit.value = true
  clearClickTimer()
  closeEditor()
  await nextTick()
  suppressBlurCommit.value = false
}

async function commitEdit(nextValue) {
  if (valuesEqual(nextValue, originalValue.value)) {
    await cancelEdit()
    return
  }

  const fieldname = props.fieldMeta.fieldname
  const cardName = props.card.name
  const previous = originalValue.value
  const doctype = props.doctype

  // Drop overlay immediately; store update is already optimistic.
  suppressBlurCommit.value = true
  clearClickTimer()
  closeEditor()

  try {
    await store.dispatch('updateCardField', {
      cardName,
      fieldname,
      value: nextValue,
      previousValue: previous,
    })
    clearCardDocument(doctype, cardName)
  } catch {
    // Store already rolled back / alerted; editor stays closed.
  } finally {
    await nextTick()
    suppressBlurCommit.value = false
  }
}

function readControlValue(controlInstance) {
  if (!controlInstance) {
    return originalValue.value
  }
  if (typeof controlInstance.get_value === 'function') {
    return controlInstance.get_value()
  }
  return controlInstance.value
}

async function handleControlChange(controlInstance) {
  if (suppressBlurCommit.value || busy.value) {
    return
  }
  const nextValue = readControlValue(controlInstance)
  await commitEdit(nextValue)
}

function measureDisplayMetrics() {
  const el = displayEl.value
  if (!el) {
    return null
  }
  const rect = el.getBoundingClientRect()
  if (!rect.height || !rect.width) {
    return null
  }
  const styles = getComputedStyle(el)
  return {
    height: Math.ceil(rect.height),
    width: Math.ceil(rect.width),
    fontSize: styles.fontSize || 'inherit',
    lineHeight: styles.lineHeight || 'inherit',
    fontWeight: styles.fontWeight || 'inherit',
    fontFamily: styles.fontFamily || 'inherit',
  }
}

function applyControlBoxSize(controlInstance, metrics) {
  if (!metrics || !controlInstance) {
    return
  }
  const candidates = []
  if (controlInstance.$input?.get) {
    const node = controlInstance.$input.get(0)
    if (node) {
      candidates.push(node)
    }
  } else if (controlInstance.$input?.[0]) {
    candidates.push(controlInstance.$input[0])
  } else if (controlInstance.input) {
    candidates.push(controlInstance.input)
  }
  const wrapperInput = controlInstance.$wrapper?.find?.('input, textarea, select')?.get?.(0)
  if (wrapperInput && !candidates.includes(wrapperInput)) {
    candidates.push(wrapperInput)
  }
  candidates.forEach((node) => {
    node.style.boxSizing = 'border-box'
    node.style.height = `${metrics.height}px`
    node.style.minHeight = `${metrics.height}px`
    node.style.width = `${metrics.width}px`
    node.style.maxWidth = '100%'
    node.style.fontSize = metrics.fontSize
    node.style.lineHeight = metrics.lineHeight
    node.style.fontWeight = metrics.fontWeight
    node.style.fontFamily = metrics.fontFamily
    if (node.tagName === 'TEXTAREA') {
      node.style.resize = 'none'
    }
  })
}

async function openEditor() {
  if (props.disabled || editing.value || busy.value || pendingUpdate.value) {
    return
  }
  if (!quickEditable.value) {
    return
  }

  busy.value = true
  store.commit('SET_ACTIVE_INLINE_EDIT', {
    cardName: props.card.name,
    fieldname: props.fieldMeta.fieldname,
  })

  try {
    const measured = measureDisplayMetrics()
    const doc = await loadCardDocument(props.doctype, props.card.name)
    loadedDoc.value = doc
    if (!canOpenInlineEditor({
      doctype: props.doctype,
      docname: props.card.name,
      fieldMeta: props.fieldMeta,
      doc,
    })) {
      store.commit('CLEAR_ACTIVE_INLINE_EDIT')
      busy.value = false
      return
    }

    editBoxMetrics.value = measured || measureDisplayMetrics()
    editing.value = true
    await nextTick()
    const parent = controlParent.value
    if (!parent) {
      store.commit('CLEAR_ACTIVE_INLINE_EDIT')
      editing.value = false
      editBoxMetrics.value = null
      busy.value = false
      return
    }
    parent.innerHTML = ''

    originalValue.value = fieldValue.value ?? null
    const df = buildInlineControlDf({
      fieldMeta: props.fieldMeta,
      doctype: props.doctype,
      docname: props.card.name,
      doc,
      onChange: handleControlChange,
    })

    const created = frappe.ui.form.make_control({
      parent: $(parent),
      doctype: props.doctype,
      docname: props.card.name,
      df,
      render_input: true,
      only_input: true,
      value: originalValue.value,
    })

    created.toggle_label?.(false)
    created.toggle_description?.(false)
    if (typeof created.set_value === 'function') {
      await created.set_value(originalValue.value)
    }
    control.value = created
    applyControlBoxSize(created, editBoxMetrics.value)

    created.$wrapper?.on('keydown.kanban-inline', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelEdit()
      }
      if (event.key === 'Enter' && props.fieldMeta.fieldtype !== 'Text' && props.fieldMeta.fieldtype !== 'Small Text') {
        event.preventDefault()
        commitEdit(readControlValue(created))
      }
    })

    await nextTick()
    applyControlBoxSize(created, editBoxMetrics.value)
    created.$input?.trigger?.('focus')
    created.set_focus?.()
    if (normalizeFieldtype(props.fieldMeta) === 'Select') {
      openInlineSelectOptions(created)
    }
    busy.value = false
  } catch (error) {
    store.commit('CLEAR_ACTIVE_INLINE_EDIT')
    editing.value = false
    editBoxMetrics.value = null
    busy.value = false
    destroyControl()
    frappe.show_alert({
      message: __('Could not open field editor.', null, 'QuickKanban.Inline'),
      indicator: 'red',
    })
    throw error
  }
}

function onAnchorNavigateBlock(event) {
  if (!quickEditable.value || editing.value) {
    return
  }
  const anchor = event.target?.closest?.('a')
  if (!anchor) {
    return
  }
  event.preventDefault()
}

function onClick(event) {
  if (editing.value || props.disabled) {
    return
  }
  if (event.target.closest('a')) {
    event.preventDefault()
  }
  if (!quickEditable.value) {
    return
  }
  clearClickTimer()
  clickTimer.value = setTimeout(() => {
    clickTimer.value = null
    openEditor()
  }, getInlineEditClickDelayMs(props.fieldMeta))
}

function onDblclick(event) {
  event.preventDefault()
  event.stopPropagation()
  clearClickTimer()

  if (editing.value) {
    cancelEdit()
  }

  const navigation = resolveDoubleClickNavigation({
    role: props.fieldRole,
    fieldMeta: props.fieldMeta,
    card: props.card,
    refDoctype: props.doctype,
    value: fieldValue.value,
  })
  if (navigation) {
    navigateToForm(navigation.doctype, navigation.name)
  }
}

watch(
  () => store.state.activeInlineEdit,
  (current) => {
    if (!editing.value) {
      return
    }
    if (
      !current
      || current.cardName !== props.card.name
      || current.fieldname !== props.fieldMeta.fieldname
    ) {
      cancelEdit()
    }
  },
)

watch(
  editing,
  (isEditing) => {
    if (isEditing) {
      startOutsideListening()
    } else {
      stopOutsideListening()
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  clearClickTimer()
  stopOutsideListening()
  destroyControl()
  if (
    store.state.activeInlineEdit?.cardName === props.card.name
    && store.state.activeInlineEdit?.fieldname === props.fieldMeta.fieldname
  ) {
    store.commit('CLEAR_ACTIVE_INLINE_EDIT')
  }
})
</script>
