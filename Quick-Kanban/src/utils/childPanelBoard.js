/** Child-panel list ids sit above swimlane cell ids (lane*10000+col). */
export const CHILD_LIST_ID_BASE = 100_000_000

export function encodeChildListId(scopeOrdinal, columnIndex) {
  return CHILD_LIST_ID_BASE + scopeOrdinal * 10000 + columnIndex
}

export function decodeChildListId(id) {
  const numeric = Number(id)
  if (!Number.isFinite(numeric) || numeric < CHILD_LIST_ID_BASE) {
    return { scopeOrdinal: null, columnIndex: null }
  }
  const offset = numeric - CHILD_LIST_ID_BASE
  return {
    scopeOrdinal: Math.floor(offset / 10000),
    columnIndex: offset % 10000,
  }
}

export function isChildListId(id) {
  const numeric = Number(id)
  return Number.isFinite(numeric) && numeric >= CHILD_LIST_ID_BASE
}

/**
 * Sortable group name: isolate child panels from the main board.
 * Uses panel ordinal (not scopeId) so the name stays free of `::` / spaces.
 * Note: Number(null) === 0 — treat null/undefined/'' as board group explicitly.
 */
export function childPanelDragGroupName(scopeOrdinal = null) {
  if (scopeOrdinal == null || scopeOrdinal === '') {
    return 'kanban'
  }
  const ordinal = Number(scopeOrdinal)
  if (!Number.isFinite(ordinal)) {
    return 'kanban'
  }
  return `kanban-child-${ordinal}`
}

/** Resolve sortable-dnd instance hung on a VirtualList root element. */
export function getSortableDndInstance(el) {
  if (!el || typeof el !== 'object') {
    return null
  }
  for (const key of Object.keys(el)) {
    if (key.startsWith('Sortable') && typeof el[key]?.option === 'function') {
      return el[key]
    }
  }
  return null
}

/**
 * Toggle participation in sortable-dnd `_nearestSortable` hit-testing.
 * When disabled, sets emptyInsertThreshold to null so overlapping board lists
 * do not steal drops from teleported child-panel lists.
 */
export function setSortableNearestParticipation(el, enabled) {
  const dnd = getSortableDndInstance(el)
  if (!dnd) {
    return false
  }
  dnd.option('emptyInsertThreshold', enabled ? 0 : null)
  return true
}

/**
 * Resolve a child-panel drop target from Sortable list ids + drag context.
 * Rejects board list ids and cross-scope child drops.
 */
export function resolveChildPanelDropTarget({
  toId,
  fromId,
  contextChildScopeId = null,
  contextFromColumn = null,
  childPanels = {},
} = {}) {
  const toDecoded = decodeChildListId(toId)
  const fromDecoded = isChildListId(fromId)
    ? decodeChildListId(fromId)
    : { scopeOrdinal: null, columnIndex: Number(fromId) }

  const fromColumn = Number.isFinite(fromDecoded.columnIndex)
    ? fromDecoded.columnIndex
    : Number(contextFromColumn)

  let childScopeId = contextChildScopeId || null
  const preferredOrdinal = Number.isFinite(toDecoded.scopeOrdinal)
    ? toDecoded.scopeOrdinal
    : fromDecoded.scopeOrdinal
  if (!childScopeId && Number.isFinite(preferredOrdinal)) {
    childScopeId = Object.keys(childPanels || {}).find(
      (scopeId) => childPanels[scopeId]?.ordinal === preferredOrdinal,
    ) || null
  }

  if (!childScopeId || !Number.isFinite(fromColumn)) {
    return { ok: false, reason: 'missing_scope_or_from' }
  }

  const panelOrdinal = childPanels?.[childScopeId]?.ordinal
  if (!isChildListId(toId)) {
    return {
      ok: false,
      reason: 'non_child_target',
      childScopeId,
      fromColumn,
    }
  }
  if (
    Number.isFinite(panelOrdinal)
    && Number.isFinite(toDecoded.scopeOrdinal)
    && toDecoded.scopeOrdinal !== panelOrdinal
  ) {
    return {
      ok: false,
      reason: 'scope_mismatch',
      childScopeId,
      fromColumn,
      toColumn: toDecoded.columnIndex,
    }
  }
  if (!Number.isFinite(toDecoded.columnIndex)) {
    return {
      ok: false,
      reason: 'invalid_to_column',
      childScopeId,
      fromColumn,
    }
  }

  return {
    ok: true,
    childScopeId,
    fromColumn,
    toColumn: toDecoded.columnIndex,
    sameColumn: fromColumn === toDecoded.columnIndex,
  }
}

export function childPanelKey(parentName, depth) {
  return `${depth}::${String(parentName || '')}`
}

export function childColumnPaginationKey(scopeId, columnName) {
  return `${scopeId}::${columnName}`
}

/** Same step as --swimlane-lane-tint (fg 8% wash). */
export const CHILD_PANEL_COLUMN_TINT_STEP = 8

/**
 * Cumulative column wash strength for a child panel.
 * Accounts for swimlane outer tint plus one step per panel depth level.
 */
export function childPanelColumnTintStrength(depth = 0, swimlanesEnabled = false) {
  const level = Math.max(0, Number(depth) || 0)
  const outer = swimlanesEnabled ? CHILD_PANEL_COLUMN_TINT_STEP : 0
  return outer + (level + 1) * CHILD_PANEL_COLUMN_TINT_STEP
}

export function childPanelColumnTintValue(depth = 0, swimlanesEnabled = false) {
  const strength = childPanelColumnTintStrength(depth, swimlanesEnabled)
  return `color-mix(in srgb, var(--fg, var(--text-color)) ${strength}%, transparent)`
}

export function buildEmptyChildColumns(columnTemplates) {
  return (columnTemplates || []).map((column) => ({
    ...column,
    cards: [],
  }))
}

export function createChildColumnPagination(columns, hasMore = true) {
  return Object.fromEntries(
    (columns || []).map((column) => [
      column.column_name,
      {
        offset: column.cards?.length || 0,
        loading: false,
        hasMore,
      },
    ]),
  )
}

/**
 * Spacer under a pinned ChildPanel host: fill the scroller viewport below sticky
 * chrome / host card. Independent of the host's current Y so bottom cards can
 * still scroll up (temporary pad removed when the panel closes).
 */
export function resolveChildPanelSpacerHeight({
  scrollerClientHeight = 0,
  topInset = 0,
  hostHeight = 0,
} = {}) {
  const client = Math.max(0, Number(scrollerClientHeight) || 0)
  const inset = Math.max(0, Number(topInset) || 0)
  const host = Math.max(0, Number(hostHeight) || 0)
  return Math.max(0, client - inset - host)
}

/**
 * Flat column collapse/expand (and missing host while a ChildPanel track is a
 * cell-spacer) can corrupt spacer-based top/height. Keep previous vertical
 * geometry; still allow left/width updates. Swimlane never needs this.
 *
 * @returns {{ rect: object, verticalFrozen: boolean }}
 */
export function stabilizeHostPanelRectOnColumnToggle({
  previousRect = null,
  nextRect = null,
  hostColumnCollapsed = false,
  hostMissing = false,
  verticalLock = false,
  swimlanesEnabled = false,
} = {}) {
  const next = nextRect && typeof nextRect === 'object' ? { ...nextRect } : null
  if (!next) {
    return { rect: next, verticalFrozen: false }
  }
  const shouldFreeze = Boolean(
    hostColumnCollapsed || hostMissing || verticalLock,
  )
  if (swimlanesEnabled || !shouldFreeze || !previousRect) {
    return { rect: next, verticalFrozen: false }
  }
  const prevTop = previousRect.top
  const prevHeight = previousRect.height
  if (Number.isFinite(prevTop)) {
    next.top = prevTop
  }
  if (Number.isFinite(prevHeight) && prevHeight > 0) {
    next.height = prevHeight
  }
  return { rect: next, verticalFrozen: true }
}

/** @deprecated Use stabilizeHostPanelRectOnColumnToggle */
export function stabilizeCollapsedHostPanelRect(options = {}) {
  return stabilizeHostPanelRectOnColumnToggle(options)
}

/** CSS.escape for data-card-name / data-panel-parent selectors. */
export function escapePanelParentName(parentName) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(String(parentName ?? ''))
  }
  return String(parentName ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function panelHostCandidates(root, parentName) {
  if (!root?.querySelectorAll || !parentName) {
    return []
  }
  const escaped = escapePanelParentName(parentName)
  return [...root.querySelectorAll(`.kanban-card[data-card-name="${escaped}"]`)]
}

function panelSpacerCandidates(root, parentName) {
  if (!root?.querySelectorAll || !parentName) {
    return []
  }
  const escaped = escapePanelParentName(parentName)
  return [...root.querySelectorAll(`.child-panel-spacer[data-panel-parent="${escaped}"]`)]
}

function normalizeHostLaneKey(hostLaneKey) {
  if (hostLaneKey == null) {
    return null
  }
  const key = String(hostLaneKey).trim()
  return key === '' ? null : key
}

function elementMatchesHostLane(el, hostLaneKey) {
  const key = normalizeHostLaneKey(hostLaneKey)
  if (key == null || !el?.closest) {
    return true
  }
  const lane = el.closest(`.swimlane-lane[data-lane-key="${escapePanelParentName(key)}"]`)
  return Boolean(lane)
}

/**
 * Resolve the DOM host card for a board-hosted child panel by depth.
 * Depth 0: main-board instance only (not inside .child-panel).
 * When hostLaneKey is set, prefer the swimlane instance in that lane.
 * Depth >= 1: instance inside parent panel depth-1; never prefer a board duplicate.
 */
export function resolvePanelHostCard(root, parentName, depth = 0, hostLaneKey = null) {
  const cards = panelHostCandidates(root, parentName)
  if (!cards.length) {
    return null
  }
  const level = Math.max(0, Number(depth) || 0)
  if (level <= 0) {
    const boardCards = cards.filter((card) => !card.closest?.('.child-panel'))
    const laneMatch = boardCards.find((card) => elementMatchesHostLane(card, hostLaneKey))
    if (normalizeHostLaneKey(hostLaneKey) != null && laneMatch) {
      return laneMatch
    }
    return boardCards[0] || null
  }
  const parentPanel = root?.querySelector?.(
    `.child-panel[data-child-depth="${level - 1}"]`,
  )
  if (parentPanel) {
    const inParent = cards.find((card) => parentPanel.contains(card))
    if (inParent) {
      return inParent
    }
  }
  return cards.find((card) => card.closest?.('.child-panel')) || null
}

/**
 * Resolve the spacer under a panel host, scoped the same way as resolvePanelHostCard.
 */
export function resolvePanelHostSpacer(root, parentName, depth = 0, hostLaneKey = null) {
  const spacers = panelSpacerCandidates(root, parentName)
  if (!spacers.length) {
    return null
  }
  const level = Math.max(0, Number(depth) || 0)
  if (level <= 0) {
    const boardSpacers = spacers.filter((el) => !el.closest?.('.child-panel'))
    const laneMatch = boardSpacers.find((el) => elementMatchesHostLane(el, hostLaneKey))
    if (normalizeHostLaneKey(hostLaneKey) != null && laneMatch) {
      return laneMatch
    }
    return boardSpacers[0] || null
  }
  const parentPanel = root?.querySelector?.(
    `.child-panel[data-child-depth="${level - 1}"]`,
  )
  if (parentPanel) {
    const inParent = spacers.find((el) => parentPanel.contains(el))
    if (inParent) {
      return inParent
    }
  }
  return spacers.find((el) => el.closest?.('.child-panel')) || null
}
