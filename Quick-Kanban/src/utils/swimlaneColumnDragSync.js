const DEFAULT_COLUMN_GAP_PX = 8

function columnValue(el) {
  return el?.getAttribute?.('data-column-value') || null
}

function isHeaderColumn(el) {
  return el?.classList?.contains('kanban-column') && Boolean(columnValue(el))
}

function isBodyColumnEl(el) {
  if (!el?.classList || !columnValue(el)) {
    return false
  }
  return (
    el.classList.contains('swimlane-column-rail')
    || el.classList.contains('swimlane-chrome-cell')
    || el.classList.contains('swimlane-group')
    || el.classList.contains('swimlane-cell-spacer')
    || el.classList.contains('child-panel-group')
    || el.classList.contains('child-panel-cell-spacer')
  )
}

export function readColumnOrder(container, matchFn = isHeaderColumn) {
  if (!container) {
    return []
  }
  return [...container.children]
    .filter((el) => matchFn(el))
    .map((el) => columnValue(el))
    .filter(Boolean)
}

export function parseGridTracks(template) {
  return String(template || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function buildWidthByColumn(order, template) {
  const tracks = parseGridTracks(template)
  const hasAddTrack = tracks[tracks.length - 1] === 'max-content'
  const columnTracks = hasAddTrack ? tracks.slice(0, -1) : tracks
  const widthByColumn = {}
  order.forEach((value, index) => {
    if (columnTracks[index]) {
      widthByColumn[value] = columnTracks[index]
    }
  })
  return { widthByColumn, hasAddTrack }
}

export function buildHeaderGridTemplate(order, widthByColumn, hasAddTrack) {
  const tracks = order
    .map((value) => widthByColumn[value])
    .filter(Boolean)
    .join(' ')
  if (!tracks) {
    return ''
  }
  return hasAddTrack ? `${tracks} max-content` : tracks
}

export function parseTrackWidthPx(track) {
  const match = String(track || '').trim().match(/^(-?\d+(?:\.\d+)?)px$/i)
  if (!match) {
    return null
  }
  return Number(match[1])
}

export function leftOffsetForIndex(order, index, widthByColumn, gapPx) {
  let left = 0
  for (let i = 0; i < index; i += 1) {
    left += parseTrackWidthPx(widthByColumn[order[i]]) || 0
    left += gapPx
  }
  return left
}

export function translateXForReorder({
  columnValue: value,
  originalOrder,
  nextOrder,
  widthByColumn,
  gapPx,
}) {
  const oldIndex = originalOrder.indexOf(value)
  const newIndex = nextOrder.indexOf(value)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return 0
  }
  const oldLeft = leftOffsetForIndex(originalOrder, oldIndex, widthByColumn, gapPx)
  const newLeft = leftOffsetForIndex(nextOrder, newIndex, widthByColumn, gapPx)
  return newLeft - oldLeft
}

function readGapPx(headerRow) {
  if (!headerRow || typeof getComputedStyle !== 'function') {
    return DEFAULT_COLUMN_GAP_PX
  }
  const gap = parseFloat(getComputedStyle(headerRow).columnGap || getComputedStyle(headerRow).gap)
  return Number.isFinite(gap) ? gap : DEFAULT_COLUMN_GAP_PX
}

function collectBodyElements(boardRoot) {
  const byValue = new Map()
  const add = (el) => {
    if (!isBodyColumnEl(el)) {
      return
    }
    const value = columnValue(el)
    if (!byValue.has(value)) {
      byValue.set(value, [])
    }
    byValue.get(value).push(el)
  }

  const rails = boardRoot.querySelector('.swimlane-column-rails')
  if (rails) {
    for (const el of rails.children) {
      add(el)
    }
  }
  boardRoot.querySelectorAll('.swimlane-chrome-row').forEach((row) => {
    for (const el of row.children) {
      add(el)
    }
  })
  boardRoot.querySelectorAll('.swimlane-row').forEach((row) => {
    for (const el of row.children) {
      add(el)
    }
  })
  boardRoot.querySelectorAll('.child-panel-scroll').forEach((row) => {
    for (const el of row.children) {
      add(el)
    }
  })
  return byValue
}

function applyTranslate(el, dx) {
  if (!el) {
    return
  }
  if (!dx) {
    el.style.transform = ''
    el.style.willChange = ''
    return
  }
  el.style.willChange = 'transform'
  el.style.transform = `translateX(${dx}px)`
}

function clearTransforms(elementsByValue) {
  if (!elementsByValue) {
    return
  }
  for (const els of elementsByValue.values()) {
    for (const el of els) {
      applyTranslate(el, 0)
    }
  }
}

/**
 * Visually mirrors column reorder onto swimlane body cells and child-panel
 * tracks via translateX. Does not mutate Vue-managed DOM order during drag.
 * Order source: swimlane header row when present, otherwise boardRoot (classic).
 */
export function createSwimlaneColumnDragSync(boardRoot) {
  let session = null

  function getOrderContainer() {
    if (!boardRoot) {
      return null
    }
    return boardRoot.querySelector?.('.swimlane-header-row') || boardRoot
  }

  function start() {
    const orderContainer = getOrderContainer()
    if (!boardRoot || !orderContainer) {
      session = null
      return
    }
    const managesGridTemplate = orderContainer.classList?.contains('swimlane-header-row')
    const order = readColumnOrder(orderContainer, isHeaderColumn)
    const headerTemplate = managesGridTemplate
      ? (orderContainer.style.gridTemplateColumns || '')
      : ''
    const { widthByColumn, hasAddTrack } = buildWidthByColumn(order, headerTemplate)

    for (const el of orderContainer.children) {
      if (!isHeaderColumn(el)) {
        continue
      }
      const value = columnValue(el)
      if (value && !parseTrackWidthPx(widthByColumn[value])) {
        const width = el.getBoundingClientRect?.().width
        if (width > 0) {
          widthByColumn[value] = `${Math.round(width)}px`
        }
      }
    }

    session = {
      originalOrder: [...order],
      widthByColumn,
      hasAddTrack: managesGridTemplate ? hasAddTrack : false,
      orderContainer,
      headerRow: orderContainer,
      headerTemplate,
      managesGridTemplate,
      gapPx: readGapPx(orderContainer),
      elementsByValue: collectBodyElements(boardRoot),
    }
  }

  function sync() {
    if (!session) {
      return
    }
    const orderContainer = getOrderContainer() || session.orderContainer
    if (!orderContainer) {
      return
    }
    const nextOrder = readColumnOrder(orderContainer, isHeaderColumn)
    if (!nextOrder.length) {
      return
    }
    if (session.managesGridTemplate) {
      orderContainer.style.gridTemplateColumns = buildHeaderGridTemplate(
        nextOrder,
        session.widthByColumn,
        session.hasAddTrack,
      )
    }
    for (const value of session.originalOrder) {
      const dx = translateXForReorder({
        columnValue: value,
        originalOrder: session.originalOrder,
        nextOrder,
        widthByColumn: session.widthByColumn,
        gapPx: session.gapPx,
      })
      const els = session.elementsByValue.get(value) || []
      for (const el of els) {
        applyTranslate(el, dx)
      }
    }
  }

  function clearTransformsOnly() {
    if (!session) {
      return
    }
    clearTransforms(session.elementsByValue)
  }

  function finish({ cancelled } = {}) {
    if (!session) {
      return
    }
    clearTransformsOnly()
    if (cancelled && session.managesGridTemplate && session.orderContainer) {
      session.orderContainer.style.gridTemplateColumns = session.headerTemplate
    }
    session = null
  }

  return {
    start,
    sync,
    clear: clearTransformsOnly,
    finish,
    restore: () => finish({ cancelled: true }),
  }
}
