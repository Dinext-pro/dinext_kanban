import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { createKanbanStore } from './store'
import {
  CARD_DRAG_ACTIVE_CLASS,
  CARD_DRAG_FORBIDDEN_CLASS,
  CARD_DROP_HOVER_CLASS,
  completeAppendDrop,
  completeCellAppendDrop,
  findAppendDropTarget,
  findCardDropHoverTarget,
  isForbiddenDropHoverTarget,
  setCardDragActive,
  setCardDragForbidden,
  setCardDropHoverElement,
} from './cellAppendDrop'
import { encodeCellListId } from './swimlaneBoard'
import { encodeChildListId } from './childPanelBoard'

function mountCellDom({
  listId,
  laneKey = 'lane-a',
  withDropzone = true,
  withEmpty = false,
  ghostOver = false,
}) {
  const lane = document.createElement('div')
  lane.setAttribute('data-lane-key', laneKey)
  const cell = document.createElement('div')
  cell.className = 'kanban-column kanban-column--cell kanban-column--external-scroller'
  const list = document.createElement('div')
  list.className = 'kanban-card-list'
  list.id = String(listId)
  if (withEmpty) {
    const empty = document.createElement('p')
    empty.className = 'empty-column empty-column--drop-target'
    empty.textContent = 'No data'
    list.appendChild(empty)
  }
  cell.appendChild(list)
  const footer = document.createElement('div')
  footer.className = 'column-footer-actions column-footer-actions--swimlane'
  cell.appendChild(footer)
  if (withDropzone) {
    const zone = document.createElement('div')
    zone.className = 'column-stick-room-dropzone'
    cell.appendChild(zone)
  }
  lane.appendChild(cell)
  document.body.appendChild(lane)

  if (ghostOver) {
    const ghost = document.createElement('div')
    ghost.className = 'ghost-card'
    document.body.appendChild(ghost)
    return { cell, list, ghost, lane }
  }
  return { cell, list, lane }
}

function stubElementsFromPoint(stack) {
  document.elementsFromPoint = vi.fn(() => stack)
}

describe('findAppendDropTarget', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    delete document.elementsFromPoint
    vi.restoreAllMocks()
  })

  test('finds stick-room dropzone under the pointer', () => {
    const { cell } = mountCellDom({ listId: 1 })
    const zone = cell.querySelector('.column-stick-room-dropzone')
    stubElementsFromPoint([zone, cell])

    const hit = findAppendDropTarget(10, 20)
    expect(hit?.listId).toBe('1')
    expect(hit?.laneKey).toBe('lane-a')
    expect(hit?.target).toBe(zone)
  })

  test('finds empty-column drop target under the pointer', () => {
    const { cell } = mountCellDom({ listId: '5', withDropzone: true, withEmpty: true })
    const empty = cell.querySelector('.empty-column--drop-target')
    stubElementsFromPoint([empty, cell])

    const hit = findAppendDropTarget(10, 20)
    expect(hit?.listId).toBe('5')
    expect(hit?.target).toBe(empty)
  })

  test('skips ghost cards and hits the dropzone beneath', () => {
    const { cell, ghost } = mountCellDom({ listId: 2, ghostOver: true })
    const zone = cell.querySelector('.column-stick-room-dropzone')
    stubElementsFromPoint([ghost, zone, cell])

    const hit = findAppendDropTarget(10, 20)
    expect(hit?.listId).toBe('2')
    expect(hit?.target).toBe(zone)
  })

  test('returns null when pointer is not over an append target', () => {
    const { cell } = mountCellDom({ listId: 0 })
    stubElementsFromPoint([cell])
    expect(findAppendDropTarget(10, 20)).toBeNull()
  })

  test('finds empty-column drop target on classic flat columns', () => {
    const column = document.createElement('section')
    column.className = 'kanban-column'
    const list = document.createElement('div')
    list.className = 'kanban-card-list'
    list.id = '1'
    const empty = document.createElement('p')
    empty.className = 'empty-column empty-column--drop-target'
    empty.textContent = 'No data'
    list.appendChild(empty)
    column.appendChild(list)
    document.body.appendChild(column)
    stubElementsFromPoint([empty, column])

    const hit = findAppendDropTarget(10, 20)
    expect(hit?.listId).toBe('1')
    expect(hit?.laneKey).toBeNull()
    expect(hit?.target).toBe(empty)
  })

  test('finds empty-column drop target in child-panel cells', () => {
    const column = document.createElement('section')
    column.className = 'kanban-column kanban-column--cell'
    const list = document.createElement('div')
    list.className = 'kanban-card-list'
    list.id = String(encodeChildListId(0, 2))
    const empty = document.createElement('p')
    empty.className = 'empty-column empty-column--drop-target'
    list.appendChild(empty)
    column.appendChild(list)
    document.body.appendChild(column)
    stubElementsFromPoint([empty, column])

    const hit = findAppendDropTarget(10, 20)
    expect(hit?.listId).toBe(String(encodeChildListId(0, 2)))
    expect(hit?.target).toBe(empty)
  })
})

describe('completeCellAppendDrop', () => {
  let store
  let previousPermissive

  beforeEach(() => {
    previousPermissive = globalThis.__dinextKanbanPermissiveMoves
    globalThis.__dinextKanbanPermissiveMoves = true
    store = createKanbanStore()
    store.commit('SET_COLUMNS', [
      { name: 'open', column_name: 'Open', display_name: 'Open', indicator: 'gray', cards: [] },
      { name: 'done', column_name: 'Done', display_name: 'Done', indicator: 'green', cards: [] },
    ])
    store.commit('SET_LANES', [
      {
        key: 'lane-a',
        label: 'Lane A',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            display_name: 'Open',
            indicator: 'gray',
            cards: [{ name: 'TASK-1' }],
          },
          {
            name: 'done',
            column_name: 'Done',
            display_name: 'Done',
            indicator: 'green',
            cards: [{ name: 'TASK-EXISTING' }],
          },
        ],
      },
    ])
  })

  afterEach(() => {
    globalThis.__dinextKanbanPermissiveMoves = previousPermissive
  })

  test('prepends into a column that already has cards (lane 0 list ids)', () => {
    const drag = {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromIndex: 0,
      fromLaneIndex: 0,
      fromLaneKey: 'lane-a',
    }
    const result = completeCellAppendDrop({
      store,
      drag,
      listId: String(encodeCellListId(0, 1)),
      laneKey: 'lane-a',
    })

    expect(result?.toIndex).toBe(0)
    expect(store.state.lanes[0].columns[0].cards.map((c) => c.name)).toEqual([])
    expect(store.state.lanes[0].columns[1].cards.map((c) => c.name)).toEqual([
      'TASK-1',
      'TASK-EXISTING',
    ])
    expect(result.payload).toMatchObject({
      key: 'TASK-1',
      newIndex: 0,
      laneIndex: 0,
      event: { from: { id: '0' }, to: { id: '1' } },
    })
  })

  test('appends into an empty column', () => {
    store.state.lanes[0].columns[1].cards = []
    const drag = {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromIndex: 0,
      fromLaneIndex: 0,
      fromLaneKey: 'lane-a',
    }
    const result = completeCellAppendDrop({
      store,
      drag,
      listId: '1',
      laneKey: 'lane-a',
    })

    expect(result?.toIndex).toBe(0)
    expect(store.state.lanes[0].columns[1].cards.map((c) => c.name)).toEqual(['TASK-1'])
  })

  test('rejects same-cell append', () => {
    const drag = {
      cardName: 'TASK-1',
      fromColumn: 0,
      fromIndex: 0,
      fromLaneIndex: 0,
      fromLaneKey: 'lane-a',
    }
    expect(
      completeCellAppendDrop({
        store,
        drag,
        listId: '0',
        laneKey: 'lane-a',
      }),
    ).toBeNull()
    expect(store.state.lanes[0].columns[0].cards.map((c) => c.name)).toEqual(['TASK-1'])
  })
})

describe('completeAppendDrop', () => {
  let store
  let previousPermissive

  beforeEach(() => {
    previousPermissive = globalThis.__dinextKanbanPermissiveMoves
    globalThis.__dinextKanbanPermissiveMoves = true
    store = createKanbanStore()
    store.commit('SET_KANBAN_CONFIG', {
      board_name: 'Task Board',
      ref_doctype: 'Task',
      field_name: 'status',
      fields: ['name', 'status'],
    })
    store.commit('SET_COLUMNS', [
      {
        name: 'open',
        column_name: 'Open',
        display_name: 'Open',
        cards: [{ name: 'TASK-1', status: 'Open' }],
      },
      {
        name: 'done',
        column_name: 'Done',
        display_name: 'Done',
        cards: [],
      },
    ])
  })

  afterEach(() => {
    globalThis.__dinextKanbanPermissiveMoves = previousPermissive
  })

  test('moves into an empty classic column', () => {
    const result = completeAppendDrop({
      store,
      drag: {
        cardName: 'TASK-1',
        fromColumn: 0,
        fromIndex: 0,
      },
      listId: '1',
    })

    expect(result?.mode).toBe('board')
    expect(result?.toIndex).toBe(0)
    expect(store.state.columns[0].cards.map((c) => c.name)).toEqual([])
    expect(store.state.columns[1].cards.map((c) => c.name)).toEqual(['TASK-1'])
    expect(result.payload.event).toEqual({
      from: { id: '0' },
      to: { id: '1' },
    })
  })

  test('moves into an empty child-panel column', () => {
    const scopeId = '0::PARENT'
    store.commit('OPEN_CHILD_PANEL', {
      scopeId,
      parentName: 'PARENT',
      depth: 0,
      hostLaneKey: null,
      ordinal: 0,
      columns: [
        {
          name: 'open',
          column_name: 'Open',
          cards: [{ name: 'CHILD-1', status: 'Open' }],
        },
        { name: 'done', column_name: 'Done', cards: [] },
      ],
      columnPagination: {},
      columnTotals: {},
    })

    const toListId = String(encodeChildListId(0, 1))
    const result = completeAppendDrop({
      store,
      drag: {
        cardName: 'CHILD-1',
        fromColumn: 0,
        fromIndex: 0,
        childScopeId: scopeId,
      },
      listId: toListId,
    })

    expect(result?.mode).toBe('board')
    expect(store.state.childPanels[scopeId].columns[0].cards.map((c) => c.name)).toEqual([])
    expect(store.state.childPanels[scopeId].columns[1].cards.map((c) => c.name)).toEqual([
      'CHILD-1',
    ])
    expect(result.payload.event.to.id).toBe(toListId)
  })

  test('routes swimlane appends with mode swimlane', () => {
    store.commit('SET_LANES', [
      {
        key: 'lane-a',
        label: 'Lane A',
        columns: [
          {
            name: 'open',
            column_name: 'Open',
            cards: [{ name: 'TASK-1' }],
          },
          {
            name: 'done',
            column_name: 'Done',
            cards: [],
          },
        ],
      },
    ])
    store.commit('SET_KANBAN_CONFIG', {
      ...store.state.config,
      swimlane_mode: 'field',
      swimlane_field: 'project',
    })

    const result = completeAppendDrop({
      store,
      drag: {
        cardName: 'TASK-1',
        fromColumn: 0,
        fromIndex: 0,
        fromLaneIndex: 0,
        fromLaneKey: 'lane-a',
      },
      listId: '1',
      laneKey: 'lane-a',
    })

    expect(result?.mode).toBe('swimlane')
    expect(store.state.lanes[0].columns[1].cards.map((c) => c.name)).toEqual(['TASK-1'])
  })
})

describe('card drag cursor and drop hover helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.classList.remove(CARD_DRAG_ACTIVE_CLASS)
    document.documentElement.classList.remove(CARD_DRAG_FORBIDDEN_CLASS)
    delete document.elementsFromPoint
    vi.restoreAllMocks()
  })

  test('setCardDragActive toggles html class', () => {
    setCardDragActive(true)
    expect(document.documentElement.classList.contains(CARD_DRAG_ACTIVE_CLASS)).toBe(true)
    setCardDragActive(false)
    expect(document.documentElement.classList.contains(CARD_DRAG_ACTIVE_CLASS)).toBe(false)
  })

  test('setCardDragForbidden toggles and clears with setCardDragActive(false)', () => {
    setCardDragActive(true)
    setCardDragForbidden(true)
    expect(document.documentElement.classList.contains(CARD_DRAG_FORBIDDEN_CLASS)).toBe(true)
    setCardDragForbidden(false)
    expect(document.documentElement.classList.contains(CARD_DRAG_FORBIDDEN_CLASS)).toBe(false)
    setCardDragForbidden(true)
    setCardDragActive(false)
    expect(document.documentElement.classList.contains(CARD_DRAG_FORBIDDEN_CLASS)).toBe(false)
  })

  test('findCardDropHoverTarget prefers append zone over column', () => {
    const { cell } = mountCellDom({ listId: 1 })
    const zone = cell.querySelector('.column-stick-room-dropzone')
    stubElementsFromPoint([zone, cell])
    const hit = findCardDropHoverTarget(10, 20)
    expect(hit).toEqual({ el: zone, kind: 'append' })
  })

  test('findCardDropHoverTarget falls back to column and skips ghosts', () => {
    const { cell, ghost } = mountCellDom({ listId: 2, ghostOver: true, withDropzone: false })
    stubElementsFromPoint([ghost, cell])
    const hit = findCardDropHoverTarget(10, 20)
    expect(hit).toEqual({ el: cell, kind: 'column' })
  })

  test('findCardDropHoverTarget still returns forbidden columns for cursor handling', () => {
    const { cell } = mountCellDom({ listId: 3, withDropzone: false })
    cell.classList.add('kanban-column-drop-forbidden')
    stubElementsFromPoint([cell])
    const hit = findCardDropHoverTarget(10, 20)
    expect(hit).toEqual({ el: cell, kind: 'column' })
    expect(hit.el.classList.contains('kanban-column-drop-forbidden')).toBe(true)
  })

  test('isForbiddenDropHoverTarget is true for append zone inside forbidden column', () => {
    const { cell } = mountCellDom({ listId: 4 })
    cell.classList.add('kanban-column-drop-forbidden')
    const zone = cell.querySelector('.column-stick-room-dropzone')
    stubElementsFromPoint([zone, cell])
    const hit = findCardDropHoverTarget(10, 20)
    expect(hit).toEqual({ el: zone, kind: 'append' })
    expect(isForbiddenDropHoverTarget(hit)).toBe(true)
  })

  test('isForbiddenDropHoverTarget is false when column is allowed', () => {
    const { cell } = mountCellDom({ listId: 5, withDropzone: false })
    stubElementsFromPoint([cell])
    const hit = findCardDropHoverTarget(10, 20)
    expect(isForbiddenDropHoverTarget(hit)).toBe(false)
    expect(isForbiddenDropHoverTarget(null)).toBe(false)
  })

  test('setCardDropHoverElement swaps the hover class', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    document.body.append(a, b)
    let current = setCardDropHoverElement(a, null)
    expect(a.classList.contains(CARD_DROP_HOVER_CLASS)).toBe(true)
    current = setCardDropHoverElement(b, current)
    expect(a.classList.contains(CARD_DROP_HOVER_CLASS)).toBe(false)
    expect(b.classList.contains(CARD_DROP_HOVER_CLASS)).toBe(true)
    setCardDropHoverElement(null, current)
    expect(b.classList.contains(CARD_DROP_HOVER_CLASS)).toBe(false)
  })
})
