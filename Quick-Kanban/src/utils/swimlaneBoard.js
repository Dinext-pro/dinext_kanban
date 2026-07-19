import {
  cardMatchesLane,
  cellKey,
  getColumnKey,
  transformCard,
} from './kanban'

export function encodeCellListId(laneIndex, columnIndex) {
  return laneIndex * 10000 + columnIndex
}

export function decodeCellListId(id) {
  const numeric = Number(id)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { laneIndex: null, columnIndex: null }
  }
  if (numeric < 10000) {
    return { laneIndex: null, columnIndex: numeric }
  }
  return {
    laneIndex: Math.floor(numeric / 10000),
    columnIndex: numeric % 10000,
  }
}

export function buildEmptyLaneColumns(columnTemplates) {
  return (columnTemplates || []).map((column) => ({
    ...column,
    cards: [],
  }))
}

export function createCellPagination(lanes, hasMore = true) {
  const pagination = {}
  for (const lane of lanes || []) {
    for (const column of lane.columns || []) {
      pagination[cellKey(lane.key, column.column_name)] = {
        offset: 0,
        hasMore,
        loading: false,
      }
    }
  }
  return pagination
}

export function cardsFromPageMessage(page, userInfo = {}) {
  const keys = page?.keys || []
  const values = page?.values || []
  return values.map((row) => transformCard(keys, row, userInfo))
}

export function forEachCardInstance(lanes, columns, cardName, mutator) {
  let touched = false
  const visit = (column) => {
    const card = column.cards?.find(({ name }) => name === cardName)
    if (card) {
      mutator(card, column)
      touched = true
    }
  }
  if (lanes?.length) {
    for (const lane of lanes) {
      for (const column of lane.columns || []) {
        visit(column)
      }
    }
  } else {
    for (const column of columns || []) {
      visit(column)
    }
  }
  return touched
}

export function findCardInLanes(lanes, cardName) {
  for (let laneIndex = 0; laneIndex < (lanes || []).length; laneIndex += 1) {
    const lane = lanes[laneIndex]
    for (let columnIndex = 0; columnIndex < (lane.columns || []).length; columnIndex += 1) {
      const column = lane.columns[columnIndex]
      const cardIndex = (column.cards || []).findIndex(({ name }) => name === cardName)
      if (cardIndex >= 0) {
        return {
          laneIndex,
          columnIndex,
          cardIndex,
          card: column.cards[cardIndex],
          lane,
          column,
        }
      }
    }
  }
  return null
}

function collectCardLocationsInLane(lane, cardName) {
  const locations = []
  for (let columnIndex = 0; columnIndex < (lane?.columns || []).length; columnIndex += 1) {
    const column = lane.columns[columnIndex]
    const cards = column.cards || []
    for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
      if (cards[cardIndex]?.name === cardName) {
        locations.push({ columnIndex, cardIndex, card: cards[cardIndex], column })
      }
    }
  }
  return locations
}

function removeCardFromColumn(column, cardName) {
  const cards = column.cards || []
  const index = cards.findIndex(({ name }) => name === cardName)
  if (index < 0) {
    return null
  }
  const [card] = cards.splice(index, 1)
  column.cards = [...cards]
  return card
}

/**
 * Align every hydrated copy of a card with membership + status column.
 * Mutates lane column card arrays. Returns true when anything changed.
 *
 * @param {object} [options]
 * @param {(laneKey: string, columnName: string) => boolean} [options.canPrependToCell]
 *   When a lane should contain the card but has no copy, prepend a clone into the
 *   target column only if this returns true (cell already loaded).
 */
export function reconcileCardInstancesAcrossLanes(lanes, config, cardName, options = {}) {
  if (!lanes?.length || !cardName || !config?.field_name) {
    return false
  }

  const found = findCardInLanes(lanes, cardName)
  if (!found) {
    return false
  }

  const template = found.card
  const statusField = config.field_name
  const targetColumnName = template[statusField]
  const canPrependToCell = typeof options.canPrependToCell === 'function'
    ? options.canPrependToCell
    : null

  let touched = false

  for (const lane of lanes) {
    const locations = collectCardLocationsInLane(lane, cardName)
    const shouldBelong = cardMatchesLane(template, lane.key, config)
    const targetColumnIndex = (lane.columns || []).findIndex(
      (column) => column.column_name === targetColumnName,
    )

    if (!shouldBelong) {
      for (let i = locations.length - 1; i >= 0; i -= 1) {
        const { column } = locations[i]
        if (removeCardFromColumn(column, cardName)) {
          touched = true
        }
      }
      continue
    }

    if (targetColumnIndex < 0) {
      continue
    }

    const targetColumn = lane.columns[targetColumnIndex]
    if (!locations.length) {
      if (
        canPrependToCell
        && canPrependToCell(lane.key, targetColumn.column_name)
      ) {
        const clone = { ...template }
        targetColumn.cards = [clone, ...(targetColumn.cards || [])]
        touched = true
      }
      continue
    }

    let kept = null
    const inTarget = locations.find((loc) => loc.columnIndex === targetColumnIndex)
    if (inTarget) {
      kept = inTarget.card
    } else {
      kept = locations[0].card
    }

    for (const loc of locations) {
      if (loc.card !== kept) {
        if (removeCardFromColumn(loc.column, cardName)) {
          touched = true
        }
      }
    }

    const currentIndex = (targetColumn.cards || []).findIndex(
      ({ name }) => name === cardName,
    )
    if (currentIndex >= 0) {
      if (kept[statusField] !== targetColumnName) {
        kept[statusField] = targetColumnName
        touched = true
      }
      continue
    }

    for (const loc of locations) {
      if (loc.card === kept) {
        removeCardFromColumn(loc.column, cardName)
      }
    }
    kept[statusField] = targetColumnName
    targetColumn.cards = [kept, ...(targetColumn.cards || [])]
    touched = true
  }

  return touched
}

export function laneTotalFromCells(cellTotals, laneKey) {
  const byColumn = cellTotals?.[laneKey] || cellTotals?.[String(laneKey)] || {}
  return Object.values(byColumn).reduce((sum, value) => sum + (Number(value) || 0), 0)
}

/**
 * Stable sort: lanes with any cards first, then empty lanes.
 * Relative order within each group is preserved.
 */
export function sortLanesByOccupancy(lanes, cellTotals) {
  const list = Array.isArray(lanes) ? lanes : []
  const indexed = list.map((lane, index) => ({
    lane,
    index,
    occupied: laneTotalFromCells(cellTotals, lane?.key) > 0,
  }))
  indexed.sort((a, b) => {
    if (a.occupied !== b.occupied) {
      return a.occupied ? -1 : 1
    }
    return a.index - b.index
  })
  return indexed.map(({ lane }) => lane)
}

export function normalizeExpandedLaneKeys(keys = []) {
  const out = []
  const seen = new Set()
  for (const key of keys || []) {
    const normalized = String(key ?? '')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/** Persisted expanded keys plus ephemeral drag-hover overlay. */
export function getExpandedLaneKeys(expandedKeys, dragKey) {
  const keys = normalizeExpandedLaneKeys(expandedKeys)
  if (dragKey == null) {
    return keys
  }
  const drag = String(dragKey)
  if (!keys.includes(drag)) {
    keys.push(drag)
  }
  return keys
}

/** Keep only keys that still exist in the current lane list (no forced default). */
export function resolveExpandedLaneKeys(lanes, preferredKeys = []) {
  if (!lanes?.length) {
    return []
  }
  const valid = new Set(lanes.map((lane) => String(lane.key)))
  return normalizeExpandedLaneKeys(preferredKeys).filter((key) => valid.has(key))
}

export function syncColumnTemplatesFromLanes(lanes) {
  if (!lanes?.length) {
    return []
  }
  return (lanes[0].columns || []).map(({ cards: _cards, ...meta }) => ({
    ...meta,
    cards: [],
  }))
}

export function getCellColumn(state, laneIndex, columnIndex) {
  return state.lanes?.[laneIndex]?.columns?.[columnIndex]
}

export function getCellPaginationKey(laneKey, column) {
  return cellKey(laneKey, getColumnKey(column) || column?.column_name)
}

/**
 * Content height for stick-room equalize.
 * Includes list + Add footer; excludes `.column-stick-room-dropzone`.
 * Footer is a sibling of the list in swimlane mode.
 */
export function measureColumnContentHeight(cellEl) {
  if (!cellEl) {
    return 0
  }
  const list = cellEl.querySelector('.kanban-card-list')
  const footer = cellEl.querySelector('.column-footer-actions')
  return (list?.offsetHeight || 0) + (footer?.offsetHeight || 0)
}

/** Per-column stick-room so shorter cells match the tallest content in the lane. */
export function computeColumnStickRooms(contentHeights) {
  const heights = (contentHeights || []).map((h) => Math.max(0, Number(h) || 0))
  if (!heights.length) {
    return []
  }
  const laneMax = Math.max(...heights)
  return heights.map((h) => Math.max(0, laneMax - h))
}

const STICK_ROOM_CELL_SELECTOR = '.kanban-column--cell.kanban-column--external-scroller'

export function applyColumnStickRooms(rowEl) {
  if (!rowEl) {
    return []
  }
  const cells = [...rowEl.querySelectorAll(STICK_ROOM_CELL_SELECTOR)]
  const heights = cells.map((cell) => measureColumnContentHeight(cell))
  const rooms = computeColumnStickRooms(heights)
  cells.forEach((cell, index) => {
    cell.style.setProperty('--column-stick-room', `${rooms[index] || 0}px`)
  })
  return rooms
}

export function clearColumnStickRooms(rowEl) {
  if (!rowEl) {
    return
  }
  rowEl.querySelectorAll(STICK_ROOM_CELL_SELECTOR).forEach((cell) => {
    cell.style.removeProperty('--column-stick-room')
  })
}
