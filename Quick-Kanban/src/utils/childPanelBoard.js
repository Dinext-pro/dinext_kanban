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
