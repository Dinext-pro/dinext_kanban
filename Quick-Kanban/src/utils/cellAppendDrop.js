import { encodeCellListId, decodeCellListId } from './swimlaneBoard'
import {
  encodeChildListId,
  isChildListId,
  resolveChildPanelDropTarget,
} from './childPanelBoard'

/** Floating Sortable ghosts that sit above real drop targets. */
export const CARD_DRAG_SKIP_HIT_SELECTOR =
  '.ghost-card, .chosen-card, .sortable-fallback, .sortable-drag, .sortable-ghost'

const APPEND_TARGET_SELECTOR =
  '.column-stick-room-dropzone, .empty-column--drop-target'

const COLUMN_HOST_SELECTOR =
  '.kanban-column--cell, .kanban-column:not(.kanban-column--header-only):not(.kanban-column--swimlane-shell)'

const COLUMN_HOVER_SELECTOR = COLUMN_HOST_SELECTOR

export const CARD_DRAG_ACTIVE_CLASS = 'kanban-card-drag-active'
export const CARD_DRAG_FORBIDDEN_CLASS = 'kanban-card-drag-forbidden'
export const CARD_DROP_HOVER_CLASS = 'kanban-drop-hover'

function elementsFromPointStack(x, y, doc = document) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return []
  }
  const elementsFromPoint =
    typeof doc.elementsFromPoint === 'function'
      ? doc.elementsFromPoint.bind(doc)
      : null
  if (!elementsFromPoint) {
    return []
  }
  try {
    return elementsFromPoint(x, y) || []
  } catch {
    return []
  }
}

function resolveColumnHost(target) {
  if (!target?.closest) {
    return null
  }
  return (
    target.closest('.kanban-column--cell.kanban-column--external-scroller')
    || target.closest('.kanban-column--cell')
    || target.closest(
      '.kanban-column:not(.kanban-column--header-only):not(.kanban-column--swimlane-shell)',
    )
  )
}

/**
 * Find append drop target under the pointer, skipping drag ghosts.
 * Works for swimlane cells, classic columns, and child-panel columns.
 * @param {number} x
 * @param {number} y
 * @param {Document} [doc=document]
 * @returns {{ target: Element, cell: Element, listId: string, laneKey: string|null } | null}
 */
export function findAppendDropTarget(x, y, doc = document) {
  const stack = elementsFromPointStack(x, y, doc)

  for (const el of stack) {
    if (!(el instanceof Element)) {
      continue
    }
    if (el.closest?.(CARD_DRAG_SKIP_HIT_SELECTOR)) {
      continue
    }
    const target = el.closest?.(APPEND_TARGET_SELECTOR)
    if (!target) {
      continue
    }
    const cell = resolveColumnHost(target)
    if (!cell) {
      continue
    }
    if (
      cell.classList.contains('kanban-column--header-only')
      || cell.classList.contains('kanban-column--swimlane-shell')
    ) {
      continue
    }
    const list = cell.querySelector('.kanban-card-list')
    // id "0" is valid (lane 0, column 0)
    if (!list || list.id == null || list.id === '') {
      continue
    }
    const laneHost = cell.closest('[data-lane-key]')
    return {
      target,
      cell,
      listId: String(list.id),
      laneKey: laneHost?.getAttribute('data-lane-key') ?? null,
    }
  }
  return null
}

/**
 * Find the drop area under the pointer for hover highlight.
 * Prefers append zones, then the column/cell body.
 * @returns {{ el: Element, kind: 'append' | 'column' } | null}
 */
export function findCardDropHoverTarget(x, y, doc = document) {
  const stack = elementsFromPointStack(x, y, doc)

  for (const el of stack) {
    if (!(el instanceof Element)) {
      continue
    }
    if (el.closest?.(CARD_DRAG_SKIP_HIT_SELECTOR)) {
      continue
    }
    const append = el.closest?.(APPEND_TARGET_SELECTOR)
    if (append) {
      return { el: append, kind: 'append' }
    }
  }

  for (const el of stack) {
    if (!(el instanceof Element)) {
      continue
    }
    if (el.closest?.(CARD_DRAG_SKIP_HIT_SELECTOR)) {
      continue
    }
    const column = el.closest?.(COLUMN_HOVER_SELECTOR)
    if (!column) {
      continue
    }
    if (
      column.classList.contains('kanban-column--header-only')
      || column.classList.contains('kanban-column--swimlane-shell')
    ) {
      continue
    }
    return { el: column, kind: 'column' }
  }
  return null
}

/**
 * True when the hover hit (append zone or column body) sits inside a
 * forbidden drop column/cell.
 * @param {{ el: Element, kind: string } | null} hit
 */
export function isForbiddenDropHoverTarget(hit) {
  return Boolean(hit?.el?.closest?.('.kanban-column-drop-forbidden'))
}

/**
 * @param {Element | null} nextEl
 * @param {Element | null} currentEl
 * @returns {Element | null} the element that now has hover class
 */
export function setCardDropHoverElement(nextEl, currentEl = null) {
  if (currentEl && currentEl !== nextEl) {
    currentEl.classList.remove(CARD_DROP_HOVER_CLASS)
  }
  if (nextEl && nextEl instanceof Element) {
    nextEl.classList.add(CARD_DROP_HOVER_CLASS)
    return nextEl
  }
  return null
}

export function clearCardDropHoverElement(el) {
  el?.classList?.remove?.(CARD_DROP_HOVER_CLASS)
}

export function setCardDragActive(active, doc = document) {
  const root = doc.documentElement
  if (!root) {
    return
  }
  if (active) {
    root.classList.add(CARD_DRAG_ACTIVE_CLASS)
  } else {
    root.classList.remove(CARD_DRAG_ACTIVE_CLASS)
    root.classList.remove(CARD_DRAG_FORBIDDEN_CLASS)
  }
}

export function setCardDragForbidden(active, doc = document) {
  const root = doc.documentElement
  if (!root) {
    return
  }
  if (active) {
    root.classList.add(CARD_DRAG_FORBIDDEN_CLASS)
  } else {
    root.classList.remove(CARD_DRAG_FORBIDDEN_CLASS)
  }
}

/**
 * Resolve destination lane index. Prefer data-lane-key because encodeCellListId
 * for lane 0 yields ids < 10000 that decodeCellListId treats as classic columns.
 */
function resolveToLaneIndex(store, listId, laneKey) {
  if (laneKey != null && laneKey !== '') {
    const byKey = store.state.lanes?.findIndex(
      (lane) => String(lane.key) === String(laneKey),
    )
    if (byKey >= 0) {
      return byKey
    }
  }
  const decoded = decodeCellListId(listId)
  if (Number.isFinite(decoded.laneIndex)) {
    return decoded.laneIndex
  }
  return null
}

/**
 * Commit optimistic cell move and build the same drop payload Sortable emits.
 * @returns {{ payload: object, toLaneIndex: number, toColumn: number, toIndex: number } | null}
 */
export function completeCellAppendDrop({ store, drag, listId, laneKey = null }) {
  if (!store || !drag?.cardName) {
    return null
  }
  const decoded = decodeCellListId(listId)
  const toColumn = decoded.columnIndex
  const toLaneIndex = resolveToLaneIndex(store, listId, laneKey)
  if (!Number.isFinite(toLaneIndex) || !Number.isFinite(toColumn)) {
    return null
  }

  const fromLaneIndex = drag.fromLaneIndex
  const fromColumn = drag.fromColumn
  if (!Number.isFinite(fromLaneIndex) || !Number.isFinite(fromColumn)) {
    return null
  }
  if (fromLaneIndex === toLaneIndex && fromColumn === toColumn) {
    return null
  }

  const lane = store.state.lanes?.[toLaneIndex]
  const column = lane?.columns?.[toColumn]
  if (!lane || !column) {
    return null
  }

  if (globalThis.__quickKanbanPermissiveMoves !== true) {
    const allowed = store.getters.isCellDropAllowed({
      cardName: drag.cardName,
      columnIndex: toColumn,
      laneColumnIndex: toColumn,
      laneKey: lane.key,
    })
    if (!allowed) {
      return null
    }
  }

  // Insert at top so reveal works in paginated / tall cells.
  const toIndex = 0
  store.commit('MOVE_CARD_CELL', {
    cardName: drag.cardName,
    fromLaneIndex,
    toLaneIndex,
    fromColumn,
    toColumn,
    fromIndex: drag.fromIndex,
    toIndex,
  })

  const fromListId = encodeCellListId(fromLaneIndex, fromColumn)
  const toListId = encodeCellListId(toLaneIndex, toColumn)
  return {
    toLaneIndex,
    toColumn,
    toIndex,
    payload: {
      key: drag.cardName,
      newIndex: toIndex,
      laneIndex: toLaneIndex,
      event: {
        from: { id: String(fromListId) },
        to: { id: String(toListId) },
      },
    },
  }
}

function completeClassicAppendDrop({ store, drag, listId }) {
  if (!store || !drag?.cardName) {
    return null
  }
  const toColumn = Number(listId)
  const fromColumn = Number(drag.fromColumn)
  if (!Number.isFinite(toColumn) || !Number.isFinite(fromColumn)) {
    return null
  }
  if (fromColumn === toColumn) {
    return null
  }
  if (!store.state.columns?.[toColumn]) {
    return null
  }

  if (globalThis.__quickKanbanPermissiveMoves !== true) {
    const allowed = store.getters.isDropAllowed({
      cardName: drag.cardName,
      columnIndex: toColumn,
    })
    if (!allowed) {
      return null
    }
  }

  const toIndex = 0
  store.commit('MOVE_CARD', {
    cardName: drag.cardName,
    fromColumn,
    toColumn,
    fromIndex: drag.fromIndex,
    toIndex,
  })

  return {
    mode: 'board',
    toColumn,
    toIndex,
    payload: {
      key: drag.cardName,
      newIndex: toIndex,
      event: {
        from: { id: String(fromColumn) },
        to: { id: String(toColumn) },
      },
    },
  }
}

function completeChildAppendDrop({ store, drag, listId }) {
  if (!store || !drag?.cardName) {
    return null
  }

  let fromId = drag.fromColumn
  if (drag.childScopeId && store.state.childPanels?.[drag.childScopeId]) {
    const ordinal = store.state.childPanels[drag.childScopeId].ordinal
    if (Number.isFinite(ordinal)) {
      fromId = encodeChildListId(ordinal, drag.fromColumn)
    }
  }

  const resolved = resolveChildPanelDropTarget({
    toId: listId,
    fromId,
    contextChildScopeId: drag.childScopeId || null,
    contextFromColumn: drag.fromColumn,
    childPanels: store.state.childPanels,
  })
  if (!resolved.ok || resolved.sameColumn) {
    return null
  }

  if (globalThis.__quickKanbanPermissiveMoves !== true) {
    const allowed = store.getters.isDropAllowed({
      cardName: drag.cardName,
      columnIndex: resolved.toColumn,
    })
    if (!allowed) {
      return null
    }
  }

  const toIndex = 0
  store.commit('MOVE_CARD', {
    cardName: drag.cardName,
    fromColumn: resolved.fromColumn,
    toColumn: resolved.toColumn,
    fromIndex: drag.fromIndex,
    toIndex,
    childScopeId: resolved.childScopeId,
  })

  const panelOrdinal = store.state.childPanels[resolved.childScopeId]?.ordinal
  const fromListId = Number.isFinite(panelOrdinal)
    ? encodeChildListId(panelOrdinal, resolved.fromColumn)
    : resolved.fromColumn

  return {
    mode: 'board',
    toColumn: resolved.toColumn,
    toIndex,
    payload: {
      key: drag.cardName,
      newIndex: toIndex,
      event: {
        from: { id: String(fromListId) },
        to: { id: String(listId) },
      },
    },
  }
}

/**
 * Optimistic append onto «No data» / stick-room for swimlane, classic, or child.
 * @returns {{ mode: 'swimlane'|'board', payload: object, toColumn?: number, toIndex?: number } | null}
 */
export function completeAppendDrop({ store, drag, listId, laneKey = null }) {
  if (!store || !drag?.cardName || listId == null || listId === '') {
    return null
  }

  if (isChildListId(listId)) {
    return completeChildAppendDrop({ store, drag, listId })
  }

  const swimlaneLikely = (
    (laneKey != null && laneKey !== '')
    || (
      Number.isFinite(drag.fromLaneIndex)
      && Boolean(store.getters?.swimlanesEnabled)
    )
  )
  if (swimlaneLikely && store.state.lanes?.length) {
    const cellResult = completeCellAppendDrop({
      store,
      drag,
      listId,
      laneKey,
    })
    if (!cellResult) {
      return null
    }
    return {
      mode: 'swimlane',
      ...cellResult,
    }
  }

  return completeClassicAppendDrop({ store, drag, listId })
}
