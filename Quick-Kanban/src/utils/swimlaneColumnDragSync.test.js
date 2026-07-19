import { expect, test } from 'vitest'
import {
  buildHeaderGridTemplate,
  buildWidthByColumn,
  createSwimlaneColumnDragSync,
  leftOffsetForIndex,
  parseGridTracks,
  parseTrackWidthPx,
  readColumnOrder,
  translateXForReorder,
} from './swimlaneColumnDragSync'

function makeColumnEl(tag, className, value) {
  const el = document.createElement(tag)
  el.className = className
  el.setAttribute('data-column-value', value)
  el.textContent = value
  return el
}

function buildBoard({
  tracks = '100px 200px 300px',
  order = ['Open', 'Progress', 'Done'],
} = {}) {
  const board = document.createElement('div')
  board.className = 'kanban kanban--swimlanes'

  const rails = document.createElement('div')
  rails.className = 'swimlane-column-rails'
  rails.style.gridTemplateColumns = tracks
  order.forEach((name) => {
    rails.appendChild(makeColumnEl('div', 'swimlane-column-rail', name))
  })

  const header = document.createElement('div')
  header.className = 'swimlane-header-row'
  header.style.gridTemplateColumns = `${tracks} max-content`
  header.style.columnGap = '8px'
  order.forEach((name) => {
    header.appendChild(makeColumnEl('section', 'kanban-column', name))
  })
  const add = document.createElement('div')
  add.className = 'add-column-control'
  header.appendChild(add)

  const chrome = document.createElement('div')
  chrome.className = 'swimlane-chrome-row'
  chrome.style.gridTemplateColumns = tracks
  order.forEach((name) => {
    chrome.appendChild(makeColumnEl('div', 'swimlane-chrome-cell', name))
  })

  const row = document.createElement('div')
  row.className = 'swimlane-row'
  row.style.gridTemplateColumns = tracks
  order.forEach((name) => {
    row.appendChild(makeColumnEl('section', 'swimlane-group', name))
  })

  board.append(rails, header, chrome, row)
  document.body.appendChild(board)
  return { board, rails, header, chrome, row }
}

function reorderHeader(header, order) {
  const byValue = new Map(
    [...header.children]
      .filter((el) => el.classList.contains('kanban-column'))
      .map((el) => [el.getAttribute('data-column-value'), el]),
  )
  const add = [...header.children].find((el) => el.classList.contains('add-column-control'))
  for (const value of order) {
    const el = byValue.get(value)
    if (el) {
      header.insertBefore(el, add || null)
    }
  }
}

test('parseGridTracks splits template tokens', () => {
  expect(parseGridTracks('100px 200px max-content')).toEqual([
    '100px',
    '200px',
    'max-content',
  ])
})

test('buildWidthByColumn maps tracks and detects add-column track', () => {
  const { widthByColumn, hasAddTrack } = buildWidthByColumn(
    ['Open', 'Progress', 'Done'],
    '100px 200px 300px max-content',
  )
  expect(hasAddTrack).toBe(true)
  expect(widthByColumn).toEqual({
    Open: '100px',
    Progress: '200px',
    Done: '300px',
  })
})

test('translateXForReorder moves columns by cumulative track widths and gaps', () => {
  const widthByColumn = { Open: '100px', Progress: '200px', Done: '300px' }
  const originalOrder = ['Open', 'Progress', 'Done']
  const nextOrder = ['Done', 'Open', 'Progress']

  expect(parseTrackWidthPx('200px')).toBe(200)
  expect(leftOffsetForIndex(originalOrder, 2, widthByColumn, 8)).toBe(100 + 8 + 200 + 8)

  // Done: old index 2 -> new index 0
  expect(translateXForReorder({
    columnValue: 'Done',
    originalOrder,
    nextOrder,
    widthByColumn,
    gapPx: 8,
  })).toBe(
    leftOffsetForIndex(nextOrder, 0, widthByColumn, 8)
    - leftOffsetForIndex(originalOrder, 2, widthByColumn, 8),
  )

  // Open: old 0 -> new 1
  expect(translateXForReorder({
    columnValue: 'Open',
    originalOrder,
    nextOrder,
    widthByColumn,
    gapPx: 8,
  })).toBe(
    leftOffsetForIndex(nextOrder, 1, widthByColumn, 8)
    - leftOffsetForIndex(originalOrder, 0, widthByColumn, 8),
  )
})

test('buildHeaderGridTemplate keeps column widths with optional add track', () => {
  expect(buildHeaderGridTemplate(
    ['Done', 'Open', 'Progress'],
    { Open: '52px', Progress: '200px', Done: '300px' },
    true,
  )).toBe('300px 52px 200px max-content')
})

test('sync applies translateX without changing DOM order of body cells', () => {
  const { board, rails, header, chrome, row } = buildBoard()
  const syncApi = createSwimlaneColumnDragSync(board)
  syncApi.start()

  const originalRailsOrder = readColumnOrder(
    rails,
    (el) => el.classList.contains('swimlane-column-rail'),
  )
  reorderHeader(header, ['Done', 'Open', 'Progress'])
  syncApi.sync()

  expect(readColumnOrder(rails, (el) => el.classList.contains('swimlane-column-rail')))
    .toEqual(originalRailsOrder)
  expect(readColumnOrder(chrome, (el) => el.classList.contains('swimlane-chrome-cell')))
    .toEqual(originalRailsOrder)
  expect(readColumnOrder(row, (el) => el.classList.contains('swimlane-group')))
    .toEqual(originalRailsOrder)
  expect(rails.style.gridTemplateColumns).toBe('100px 200px 300px')

  const doneRail = rails.querySelector('[data-column-value="Done"]')
  const openRail = rails.querySelector('[data-column-value="Open"]')
  expect(doneRail.style.transform).toMatch(/translateX\(-?\d+(\.\d+)?px\)/)
  expect(openRail.style.transform).toMatch(/translateX\(-?\d+(\.\d+)?px\)/)
  expect(doneRail.style.transform).not.toBe(openRail.style.transform)
})

test('sync remaps header tracks so collapsed width follows its column', () => {
  const { board, rails, header } = buildBoard({
    tracks: '52px 200px 300px',
    order: ['Open', 'Progress', 'Done'],
  })
  const syncApi = createSwimlaneColumnDragSync(board)
  syncApi.start()

  reorderHeader(header, ['Done', 'Open', 'Progress'])
  syncApi.sync()

  expect(header.style.gridTemplateColumns).toBe('300px 52px 200px max-content')
  expect(rails.style.gridTemplateColumns).toBe('52px 200px 300px')
  expect(readColumnOrder(rails, (el) => el.classList.contains('swimlane-column-rail')))
    .toEqual(['Open', 'Progress', 'Done'])
  expect(rails.querySelector('[data-column-value="Open"]').style.transform)
    .toMatch(/translateX\(-?\d+(\.\d+)?px\)/)
})

test('cancel restores header template and clears transforms', () => {
  const { board, rails, header } = buildBoard({
    tracks: '52px 200px 300px',
  })
  const syncApi = createSwimlaneColumnDragSync(board)
  syncApi.start()
  reorderHeader(header, ['Done', 'Open', 'Progress'])
  syncApi.sync()

  expect(header.style.gridTemplateColumns).toBe('300px 52px 200px max-content')
  expect(rails.querySelector('[data-column-value="Done"]').style.transform).toBeTruthy()

  syncApi.finish({ cancelled: true })
  expect(rails.querySelector('[data-column-value="Done"]').style.transform).toBe('')
  expect(rails.querySelector('[data-column-value="Open"]').style.transform).toBe('')
  expect(header.style.gridTemplateColumns).toBe('52px 200px 300px max-content')
})

test('successful finish clears transforms but keeps synced header template', () => {
  const { board, rails, header, row } = buildBoard({
    tracks: '52px 200px 300px',
  })
  const syncApi = createSwimlaneColumnDragSync(board)
  syncApi.start()
  reorderHeader(header, ['Done', 'Open', 'Progress'])
  syncApi.sync()
  syncApi.finish({ cancelled: false })

  expect(rails.querySelector('[data-column-value="Done"]').style.transform).toBe('')
  expect(row.querySelector('[data-column-value="Open"]').style.transform).toBe('')
  expect(header.style.gridTemplateColumns).toBe('300px 52px 200px max-content')
  expect(readColumnOrder(rails, (el) => el.classList.contains('swimlane-column-rail')))
    .toEqual(['Open', 'Progress', 'Done'])
})
