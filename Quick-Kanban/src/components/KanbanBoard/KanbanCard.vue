<template>
  <article
    ref="cardRoot"
    class="kanban-card"
    :class="[moveFlashClasses, cardColorClass, densityClasses, tagDropClasses, panelModeClasses]"
    :style="cardAccentStyle"
    role="listitem"
    :aria-busy="pending"
    :data-card-name="card.name"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @click="onPanelDismissCardClick"
    @dblclick="onCardDblclick"
  >
    <header class="kanban-title-area">
      <div class="kanban-title-main">
        <span
          v-if="cardDeadlineTone"
          class="kanban-deadline-icon kanban-title-deadline-icon"
          :class="[
            `kanban-deadline-icon--${cardDeadlineTone}`,
            { 'kanban-title-deadline-icon--visible': isDense },
          ]"
          aria-hidden="true"
        >
          <svg
            class="icon icon-sm"
            aria-hidden="true"
          >
            <use
              :href="cardDeadlineTone === 'overdue'
                ? '#icon-solid-error'
                : '#icon-solid-warning'"
            ></use>
          </svg>
        </span>
        <InlineCardField
          class="card-title"
          field-role="title"
          display-mode="text"
          :card="card"
          :field-meta="titleFieldMeta"
          :doctype="config.ref_doctype"
          :display-text="title"
          :disabled="inlineDisabled"
        />
      </div>
      <button
        v-if="childPanelOpen && showChildCount"
        type="button"
        class="kanban-child-count"
        :aria-label="childCountLabel"
        :title="childCountLabel"
        :aria-expanded="String(childPanelOpen)"
        @click.stop="onChildCountClick"
        @pointerdown.stop
        @dblclick.stop
      >
        <svg class="icon icon-sm" aria-hidden="true">
          <use href="#icon-collapse"></use>
        </svg>
        <span class="kanban-child-count__value">{{ childCountDisplay }}</span>
      </button>
      <template v-else-if="!childPanelOpen">
        <span
          v-if="canDrag"
          class="drag-handle drag"
          :aria-label="__('Drag {0}', [title])"
          role="img"
        >
          <svg class="icon icon-sm" aria-hidden="true">
            <use href="#icon-drag"></use>
          </svg>
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
          <svg class="icon icon-sm" aria-hidden="true">
            <use href="#icon-drag"></use>
          </svg>
        </span>
      </template>
    </header>

    <div
      v-if="showDetailsSlot"
      ref="fieldsSlotRef"
      class="kanban-card-fields-slot"
    >
      <div class="kanban-card-density-inner">
        <dl
          v-if="displayFields.length"
          class="kanban-card-fields"
        >
          <div
            v-for="field in displayFields"
            :key="field.fieldname"
            class="kanban-card-field"
            :class="deadlineFieldClass(field)"
          >
            <dt v-if="config.show_labels">{{ translateFieldLabel(field) }}</dt>
            <dd :data-fieldtype="field.fieldtype">
              <span
                v-if="deadlineToneForField(field)"
                class="kanban-deadline-icon"
                :class="`kanban-deadline-icon--${deadlineToneForField(field)}`"
                aria-hidden="true"
              >
                <svg
                  v-if="deadlineToneForField(field) === 'overdue'"
                  class="icon icon-sm"
                  aria-hidden="true"
                >
                  <use href="#icon-solid-error"></use>
                </svg>
                <svg
                  v-else
                  class="icon icon-sm"
                  aria-hidden="true"
                >
                  <use href="#icon-solid-warning"></use>
                </svg>
              </span>
              <InlineCardField
                field-role="display"
                display-mode="html"
                :card="card"
                :field-meta="field"
                :doctype="config.ref_doctype"
                :display-html="formatValue(field)"
                :display-text="String(card[field.fieldname] ?? '')"
                :disabled="inlineDisabled"
              />
            </dd>
          </div>
        </dl>

        <CardTags
          v-if="canEditTags"
          :card="card"
          :doctype="config.ref_doctype"
          :user-tags="card._user_tags || ''"
        />
        <div
          v-else-if="config.show_tags && tagsHtml"
          class="kanban-tags"
          :title="tagFilterHint"
          v-html="tagsHtml"
          @dblclick.stop="onReadonlyTagDblclick"
        ></div>

        <CardExtraInfo
          v-if="config.show_extra_info"
          :card="card"
          :doctype="config.ref_doctype"
          @files-menu-open="onFilesMenuOpen"
        />
      </div>
    </div>

    <div class="kanban-card-meta">
      <InlineCardField
        v-if="hasHighlightField"
        class="kanban-highlight"
        field-role="highlight"
        display-mode="text"
        :card="card"
        :field-meta="highlightFieldMeta"
        :doctype="config.ref_doctype"
        :display-text="highlightValue || '—'"
        :disabled="inlineDisabled"
        :style="highlightStyle"
      />

      <button
        v-if="showChildCount && !childPanelOpen"
        type="button"
        class="kanban-child-count"
        :aria-label="childCountLabel"
        :title="childCountLabel"
        :aria-expanded="String(childPanelOpen)"
        @click.stop="onChildCountClick"
        @pointerdown.stop
        @pointerenter.stop="onChildCountPointerEnter"
        @pointerleave.stop="onChildCountPointerLeave"
        @dblclick.stop
      >
        <!-- eslint-disable-next-line vue/no-v-html -- theme-aware glyph from childTreeIcon.js -->
        <span
          class="kanban-child-count__icon"
          aria-hidden="true"
          v-html="childTreeIconSvg"
        ></span>
        <span class="kanban-child-count__value">{{ childCountDisplay }}</span>
      </button>

      <div class="kanban-card-actions" @dblclick.stop>
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
            :disabled="pending || !canMove || inlineBusy"
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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import Assignments from '../Assignments.vue'
import CardExtraInfo from './CardExtraInfo.vue'
import CardTags from './CardTags.vue'
import InlineCardField from './InlineCardField.vue'
import {
  CARD_COLLAPSE_DELAY_MS,
  CARD_DENSITY_ANIMATION_MS,
  CARD_EXPAND_DELAY_MS,
  CARD_EXPAND_DELAY_OVER_CHILD_COUNT_MS,
  formatCardField,
  getCardFieldDisplayValue,
  getCardTagsHtml,
  parseCardAccentColor,
  translateFieldLabel,
} from '../../utils/kanban'
import { useDismissibleMenu } from '../../utils/menu'
import { flashMovedCard } from '../../utils/cardMoveFlash'
import { applyUserTagFilter } from '../../utils/listNavigation'
import { navigateToForm } from '../../utils/inlineEditing'
import { canDropTag, canWriteCardTags } from '../../utils/tagDragDrop'
import { formatActivityCount } from '../../utils/cardExtraInfo'
import { deadlineToneForCard } from '../../utils/deadline'
import { getChildTreeIconSvg } from '../../icons/childTreeIcon'

const childTreeIconSvg = getChildTreeIconSvg()

const CHILD_COUNT_CONTEXT = 'QuickKanban.ChildCount'

const props = defineProps({
  card: { type: Object, required: true },
  config: { type: Object, required: true },
  columnIndex: { type: Number, required: true },
  laneIndex: { type: Number, default: null },
  laneKey: { type: [String, Number], default: null },
  childDepth: { type: Number, default: 0 },
})
const store = useStore()
const scrollToMovedCard = inject('scrollToMovedCard', null)
const __ = globalThis.__
const cardRoot = ref(null)
const moveMenuButton = ref(null)
const moveMenuPanel = ref(null)
const moveMenuOpen = ref(false)
const filesMenuOpen = ref(false)
const moveMenuStyle = ref({})
const expanded = ref(
  Boolean(
    store.state.minimize_cards
    && store.state.densityHoldExpandedCard === props.card.name
    && !store.state.densityForceCollapsedCards?.[props.card.name],
  ),
)
const fieldsSlotRef = ref(null)
let densityReady = false
let densityTransitionEnd = null
let densityClearTimer = null
let expandTimer = null
let collapseTimer = null

useDismissibleMenu({
  isOpen: moveMenuOpen,
  triggerRef: moveMenuButton,
  menuRef: moveMenuPanel,
  close: closeMoveMenu,
})

const columns = computed(() => store.state.columns)
const pending = computed(() => store.getters.isMovePending(props.card.name))
const inlineBusy = computed(() => store.getters.isCardInlineBusy(props.card.name))
const moveOptionsLoading = computed(() => store.getters.isMoveOptionsLoading)
const minimizeCards = computed(() => store.state.minimize_cards)
const forceCollapsed = computed(
  () => Boolean(store.state.densityForceCollapsedCards?.[props.card.name]),
)
const childPanelOpen = computed(() =>
  store.getters.isChildPanelOpenFor(props.card.name, props.childDepth),
)
const panelMode = computed(() =>
  store.getters.getCardChildPanelMode(props.card.name, props.childDepth),
)
const isPanelInteractionActive = computed(() => panelMode.value === 'active')
const panelModeClasses = computed(() => ({
  'kanban-card--panel-inert': panelMode.value === 'inert',
  'kanban-card--panel-ancestor': panelMode.value === 'ancestor',
  'kanban-card--panel-host-nested': (
    panelMode.value === 'ancestor' && Number(props.childDepth) >= 1
  ),
}))
const inlineDisabled = computed(() => pending.value || !isPanelInteractionActive.value)
// Panel host is always dense (any Minimize checkbox state). Otherwise densify
// only follows minimize_cards + local/force collapse.
const isDense = computed(
  () => childPanelOpen.value
    || (minimizeCards.value && (forceCollapsed.value || !expanded.value)),
)
const densityClasses = computed(() => ({
  'kanban-card--minimized': isDense.value,
  'kanban-card--expanded': minimizeCards.value && !isDense.value,
}))
const isThisCardDragging = computed(
  () => store.state.activeDrag?.cardName === props.card.name,
)
const isThisCardTagDragSource = computed(
  () => store.state.activeTagDrag?.sourceCardName === props.card.name,
)
const isThisCardEditing = computed(
  () => store.state.activeInlineEdit?.cardName === props.card.name,
)
const activeTagDrag = computed(() => store.state.activeTagDrag)
const tagDropClasses = computed(() => {
  const drag = activeTagDrag.value
  if (!drag || store.state.tagDragHoverCard !== props.card.name) {
    return {}
  }
  const writeOk = canWriteCardTags(props.config.ref_doctype)
  const allowed = canDropTag({
    tag: drag.tag,
    sourceName: drag.sourceCardName,
    targetName: props.card.name,
    targetUserTags: props.card._user_tags || '',
    canWriteTarget: writeOk,
    canWriteSource: writeOk,
  })
  return {
    'kanban-card-tag-drop-allowed': allowed,
    'kanban-card-tag-drop-forbidden': !allowed,
  }
})

function clearForceDensityCollapse() {
  if (store.state.densityForceCollapsedCards?.[props.card.name]) {
    store.commit('CLEAR_FORCE_DENSITY_COLLAPSE', props.card.name)
  }
}

function holdExpandedDensity() {
  if (
    childPanelOpen.value
    || !minimizeCards.value
    || !expanded.value
    || forceCollapsed.value
  ) {
    return
  }
  store.commit('SET_DENSITY_HOLD_EXPANDED', props.card.name)
}

function clearDensityHold() {
  store.commit('CLEAR_DENSITY_HOLD_EXPANDED', props.card.name)
}

function isPointerOverCard() {
  return Boolean(cardRoot.value?.matches?.(':hover'))
}

function hasBlockingOverlay() {
  return Boolean(
    isThisCardDragging.value
    || isThisCardTagDragSource.value
    || isThisCardEditing.value
    || moveMenuOpen.value
    || filesMenuOpen.value,
  )
}

function onFilesMenuOpen(open) {
  filesMenuOpen.value = Boolean(open)
}

function expandIntentionally() {
  if (childPanelOpen.value || !isPanelInteractionActive.value) {
    return
  }
  clearForceDensityCollapse()
  expanded.value = true
}
const titleFieldMeta = computed(() => props.config.title_field_meta || {
  fieldname: props.config.title_field || 'name',
  fieldtype: 'Data',
  label: props.config.title_field || 'name',
  parent: props.config.ref_doctype,
})
const linkTitlesVersion = computed(() => store.state.linkTitlesVersion)
const title = computed(() => {
  void linkTitlesVersion.value
  return getCardFieldDisplayValue(
    props.card[props.config.title_field] || props.card.name,
    props.config.title_field_meta,
    globalThis.__,
    props.card,
  ) || props.card.name
})
const canDrag = computed(() => (
  isPanelInteractionActive.value && store.getters.canDragCard(props.card.name)
))
const canMove = computed(() => (
  isPanelInteractionActive.value
  && store.getters.getAllowedDestinations(props.card.name).length > 0
))
const allowedDestinations = computed(() =>
  store.getters.getAllowedDestinations(props.card.name)
    .filter((destination) => destination.columnIndex !== props.columnIndex),
)
const moveBlockedLabel = computed(() => {
  if (inlineBusy.value) {
    return __('Editing {0}', [title.value], 'QuickKanban.Inline')
  }
  if (moveOptionsLoading.value) {
    return __('Move permissions are loading for {0}', [title.value])
  }
  return __('Move is not available for {0}', [title.value])
})
const displayFields = computed(() => props.config.display_fields || [])
const cardDeadlineTone = computed(() => deadlineToneForCard(props.card, props.config))

function deadlineToneForField(field) {
  if (!field?.fieldname || field.fieldname !== props.config.deadline_field) {
    return ''
  }
  return deadlineToneForCard(props.card, props.config)
}

function deadlineFieldClass(field) {
  const tone = deadlineToneForField(field)
  if (!tone) {
    return null
  }
  return {
    'kanban-card-field--deadline': true,
    [`kanban-card-field--deadline-${tone}`]: true,
  }
}

const canEditTags = computed(() =>
  Boolean(
    props.config.show_tags
    && props.config.ref_doctype
    && globalThis.frappe?.model?.can_write?.(props.config.ref_doctype),
  ),
)
const tagsHtml = computed(() => {
  if (!props.config.show_tags || canEditTags.value) {
    return ''
  }
  return getCardTagsHtml(props.card._user_tags)
})
const showDetailsSlot = computed(
  () => displayFields.value.length > 0
    || canEditTags.value
    || Boolean(props.config.show_tags && tagsHtml.value)
    || Boolean(props.config.show_extra_info),
)
const tagFilterHint = computed(() =>
  __('Double-click to filter by tag', null, 'QuickKanban.Tags'),
)
const hasHighlightField = computed(() => Boolean(props.config.highlighted_field))
const childCount = computed(() => Math.max(0, Number(props.card._child_count) || 0))
const showChildCount = computed(() => childCount.value > 0)
const childCountDisplay = computed(() => formatActivityCount(childCount.value))
const childCountLabel = computed(() =>
  __('Child records', null, CHILD_COUNT_CONTEXT),
)

function onChildCountClick() {
  store.dispatch('toggleChildPanel', {
    parentName: props.card.name,
    depth: props.childDepth,
  })
}

function onPanelDismissCardClick() {
  if (panelMode.value === 'ancestor') {
    store.dispatch('toggleChildPanel', {
      parentName: props.card.name,
      depth: props.childDepth,
    })
    return
  }
  if (panelMode.value === 'inert') {
    store.commit('CLOSE_CHILD_PANELS_FROM_DEPTH', props.childDepth)
  }
}

const highlightFieldMeta = computed(() => props.config.highlighted_field_meta || {
  fieldname: props.config.highlighted_field,
  fieldtype: 'Data',
  label: props.config.highlighted_field,
  parent: props.config.ref_doctype,
})
const highlightValue = computed(() => {
  void linkTitlesVersion.value
  if (!props.config.highlighted_field) return ''
  return getCardFieldDisplayValue(
    props.card[props.config.highlighted_field],
    props.config.highlighted_field_meta,
    globalThis.__,
    props.card,
  )
})
const highlightRawValue = computed(() =>
  props.config.highlighted_field
    ? props.card[props.config.highlighted_field]
    : '',
)
const highlightStyle = computed(() => {
  if (!highlightValue.value && highlightRawValue.value !== 0) {
    return {}
  }
  const configured = (props.config.highlight_table || []).find(
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

function clearExpandTimers() {
  if (expandTimer) {
    clearTimeout(expandTimer)
    expandTimer = null
  }
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
}

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
}

function clearDensityTransition() {
  const el = fieldsSlotRef.value
  if (el && densityTransitionEnd) {
    el.removeEventListener('transitionend', densityTransitionEnd)
  }
  densityTransitionEnd = null
  if (densityClearTimer) {
    clearTimeout(densityClearTimer)
    densityClearTimer = null
  }
}

function applyDenseSlotFinal(dense) {
  const el = fieldsSlotRef.value
  if (!el) {
    return
  }
  el.style.maxHeight = dense ? '0px' : ''
}

function animateDetailsSlot(toDense) {
  const el = fieldsSlotRef.value
  if (!el) {
    return
  }

  clearDensityTransition()

  if (prefersReducedMotion()) {
    applyDenseSlotFinal(toDense)
    return
  }

  if (toDense) {
    el.style.maxHeight = 'none'
    const from = el.scrollHeight
    el.style.maxHeight = `${from}px`
    void el.offsetHeight
    el.style.maxHeight = '0px'
    return
  }

  el.style.maxHeight = 'none'
  const to = el.scrollHeight
  el.style.maxHeight = '0px'
  void el.offsetHeight
  el.style.maxHeight = `${Math.max(to, 1)}px`

  const onEnd = (event) => {
    if (event.target !== el || event.propertyName !== 'max-height') {
      return
    }
    clearDensityTransition()
    if (fieldsSlotRef.value === el && !isDense.value) {
      el.style.maxHeight = ''
    }
  }
  densityTransitionEnd = onEnd
  el.addEventListener('transitionend', onEnd)
  densityClearTimer = setTimeout(() => {
    clearDensityTransition()
    if (fieldsSlotRef.value === el && !isDense.value) {
      el.style.maxHeight = ''
    }
  }, CARD_DENSITY_ANIMATION_MS + 50)
}

watch(isDense, (dense) => {
  if (!densityReady) {
    return
  }
  animateDetailsSlot(dense)
}, { flush: 'post' })

// Panel host densifies even when Minimize is off; isDense already includes
// childPanelOpen. Re-run slot animation when entering/leaving host mode so
// fields collapse/expand in sync with ancestor chrome (meta uses CSS).
watch(childPanelOpen, (open, wasOpen) => {
  if (!densityReady || open === wasOpen) {
    return
  }
  if (open || !minimizeCards.value) {
    animateDetailsSlot(isDense.value)
  }
}, { flush: 'post' })

watch(showDetailsSlot, async (show) => {
  if (!show || !densityReady) {
    return
  }
  await nextTick()
  applyDenseSlotFinal(isDense.value)
})

onMounted(async () => {
  await nextTick()
  applyDenseSlotFinal(isDense.value)
  densityReady = true
})

function canScheduleHoverExpand(event) {
  if (!minimizeCards.value || childPanelOpen.value || !isPanelInteractionActive.value) {
    return false
  }
  if (event?.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
    return false
  }
  // Card-move DnD should not expand unrelated cards. Tag-drag allows expand
  // (also driven by tagDragHoverCard when pointerenter is suppressed under button-down).
  if (store.state.activeDrag) {
    return false
  }
  return true
}

function scheduleHoverExpand(delayMs) {
  clearExpandTimers()
  expandTimer = setTimeout(() => {
    expandTimer = null
    if (!store.state.activeDrag) {
      expandIntentionally()
    }
  }, delayMs)
}

function onPointerEnter(event) {
  if (!canScheduleHoverExpand(event)) {
    return
  }
  scheduleHoverExpand(CARD_EXPAND_DELAY_MS)
}

function onChildCountPointerEnter(event) {
  if (!canScheduleHoverExpand(event)) {
    return
  }
  scheduleHoverExpand(CARD_EXPAND_DELAY_OVER_CHILD_COUNT_MS)
}

function onChildCountPointerLeave(event) {
  if (!canScheduleHoverExpand(event)) {
    return
  }
  if (!isPointerOverCard()) {
    return
  }
  scheduleHoverExpand(CARD_EXPAND_DELAY_MS)
}

function scheduleCollapseForHoverLeave() {
  if (hasBlockingOverlay()) {
    holdExpandedDensity()
    clearExpandTimers()
    return
  }
  clearExpandTimers()
  collapseTimer = setTimeout(() => {
    collapseTimer = null
    if (hasBlockingOverlay()) {
      holdExpandedDensity()
      return
    }
    expanded.value = false
    clearDensityHold()
  }, CARD_COLLAPSE_DELAY_MS)
}

function onPointerLeave() {
  if (!minimizeCards.value) {
    return
  }
  // Keep the open density while this card is dragged so the drop remount
  // can restore the same visual state.
  scheduleCollapseForHoverLeave()
}

watch(isThisCardDragging, (dragging) => {
  if (!dragging) {
    return
  }
  clearExpandTimers()
  holdExpandedDensity()
})

watch(isThisCardTagDragSource, (dragging) => {
  if (!dragging) {
    return
  }
  clearExpandTimers()
  expandIntentionally()
  holdExpandedDensity()
})

watch(isThisCardEditing, (editing) => {
  if (!minimizeCards.value) {
    return
  }
  if (editing) {
    clearExpandTimers()
    expandIntentionally()
    holdExpandedDensity()
    return
  }
  // Leave-while-editing skipped collapse; if the pointer already left, resume it.
  if (!isPointerOverCard()) {
    scheduleCollapseForHoverLeave()
  }
})

function onOverlayMenuOpenChange(open) {
  if (!minimizeCards.value) {
    return
  }
  if (open) {
    clearExpandTimers()
    holdExpandedDensity()
    return
  }
  // Leave-while-menu-open skipped collapse; if the pointer already left, resume it.
  if (!isPointerOverCard()) {
    scheduleCollapseForHoverLeave()
  }
}

watch(moveMenuOpen, onOverlayMenuOpenChange)
watch(filesMenuOpen, onOverlayMenuOpenChange)

watch(forceCollapsed, (forced) => {
  if (!forced) {
    return
  }
  clearExpandTimers()
  expanded.value = false
})

watch(childPanelOpen, (open) => {
  if (!open) {
    return
  }
  clearExpandTimers()
  expanded.value = false
  clearDensityHold()
})

watch(panelMode, (mode) => {
  if (mode === 'active') {
    return
  }
  if (moveMenuOpen.value) {
    closeMoveMenu({ restoreFocus: false })
  }
  clearExpandTimers()
})

watch(
  () => store.state.densityHoldExpandedCard,
  (cardName) => {
    if (!minimizeCards.value || childPanelOpen.value) {
      return
    }
    if (cardName === props.card.name && !forceCollapsed.value) {
      clearExpandTimers()
      expanded.value = true
    }
  },
)

watch(
  () => [store.state.activeTagDrag, store.state.tagDragHoverCard],
  ([drag, hoverCard]) => {
    if (!minimizeCards.value || !drag) {
      return
    }
    if (hoverCard === props.card.name) {
      clearExpandTimers()
      expandTimer = setTimeout(() => {
        expandTimer = null
        if (store.state.activeTagDrag && store.state.tagDragHoverCard === props.card.name) {
          expandIntentionally()
        }
      }, CARD_EXPAND_DELAY_MS)
      return
    }
    // Hover left this card while tag-drag is still active.
    scheduleCollapseForHoverLeave()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearExpandTimers()
  clearDensityTransition()
})

function getColumnLabel(column) {
  return column.display_name || column.column_name
}

function formatValue(field) {
  void linkTitlesVersion.value
  return formatCardField(props.card[field.fieldname], field, frappe.format, props.card)
}

function onReadonlyTagDblclick(event) {
  if (!isPanelInteractionActive.value) {
    return
  }
  const pill = event.target?.closest?.('.tag-pill')
  if (!pill) {
    return
  }
  const tag = (pill.getAttribute('title') || pill.textContent || '').trim()
  if (!tag) {
    return
  }
  applyUserTagFilter(tag)
}

function onCardDblclick() {
  if (!isPanelInteractionActive.value) {
    return
  }
  navigateToForm(props.config.ref_doctype, props.card.name)
}

async function moveCard(toColumn) {
  closeMoveMenu()
  if (toColumn === props.columnIndex) return

  let fromIndex = -1
  // Always insert at top so reveal works in paginated columns.
  const toIndex = 0
  if (props.laneIndex != null && store.getters.swimlanesEnabled) {
    const lane = store.state.lanes[props.laneIndex]
    fromIndex = lane?.columns?.[props.columnIndex]?.cards?.findIndex(
      ({ name }) => name === props.card.name,
    ) ?? -1
  } else {
    fromIndex = columns.value[props.columnIndex].cards.findIndex(
      ({ name }) => name === props.card.name,
    )
  }
  if (fromIndex < 0) return

  let moved = false
  try {
    moved = await store.dispatch('moveCard', {
      cardName: props.card.name,
      fromColumn: props.columnIndex,
      toColumn,
      fromIndex,
      toIndex,
      fromLaneIndex: props.laneIndex,
    })
    if (moved && scrollToMovedCard) {
      try {
        await scrollToMovedCard({
          columnIndex: toColumn,
          cardName: props.card.name,
          cardIndex: toIndex,
          laneIndex: props.laneIndex,
        })
      } catch {
        // Reveal is best-effort; move already succeeded.
      }
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
  if (!canMove.value || !isPanelInteractionActive.value) {
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
  if (!isPanelInteractionActive.value) {
    return
  }
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
  if (!isPanelInteractionActive.value) {
    return
  }
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
