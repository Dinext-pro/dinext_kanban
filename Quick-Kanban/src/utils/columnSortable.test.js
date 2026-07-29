import { expect, test, vi, beforeEach } from 'vitest'
import {
  COLUMN_SORTABLE_CHOSEN_CLASS,
  COLUMN_SORTABLE_DRAG_CLASS,
  COLUMN_SORTABLE_DRAGGING_CLASS,
  COLUMN_SORTABLE_GHOST_CLASS,
  clearColumnSortableArtifacts,
  clearColumnSortableDraggingClass,
  columnSortableOnMove,
  createColumnSortable,
  destroyColumnSortable,
  reparentColumnSortableFallback,
  setColumnSortableDraggingClass,
} from './columnSortable'

const swimlaneSync = {
  start: vi.fn(),
  sync: vi.fn(),
  finish: vi.fn(),
}

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn((container, options) => ({
      toArray: () => ['Done', 'Open'],
      destroy: vi.fn(),
      options,
      container,
    })),
  },
}))

vi.mock('./swimlaneColumnDragSync', () => ({
  createSwimlaneColumnDragSync: vi.fn(() => swimlaneSync),
}))

import Sortable from 'sortablejs'
import { createSwimlaneColumnDragSync } from './swimlaneColumnDragSync'

beforeEach(() => {
  vi.clearAllMocks()
  swimlaneSync.start.mockClear()
  swimlaneSync.sync.mockClear()
  swimlaneSync.finish.mockClear()
})

test('creates Sortable with the column drag handle and reports reorder', () => {
  const container = document.createElement('div')
  const onReorder = vi.fn()
  const sortable = createColumnSortable(container, { onReorder })

  expect(Sortable.create).toHaveBeenCalledWith(container, expect.objectContaining({
    handle: '.column-title--draggable',
    draggable: '.kanban-column',
    filter: '.add-column-control',
    dataIdAttr: 'data-column-value',
    ghostClass: COLUMN_SORTABLE_GHOST_CLASS,
    dragClass: COLUMN_SORTABLE_DRAG_CLASS,
    chosenClass: COLUMN_SORTABLE_CHOSEN_CLASS,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 5,
    onMove: columnSortableOnMove,
  }))
  expect(createSwimlaneColumnDragSync).not.toHaveBeenCalled()

  sortable.options.onEnd({ oldIndex: 0, newIndex: 1, item: null })
  expect(onReorder).toHaveBeenCalledWith(['Done', 'Open'])
})

test('always enables forceFallback for floating collapsed title drags', () => {
  const previous = globalThis.__quickKanbanForceColumnSortableFallback
  globalThis.__quickKanbanForceColumnSortableFallback = false
  try {
    const container = document.createElement('div')
    createColumnSortable(container, { onReorder: vi.fn() })
    expect(Sortable.create).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        forceFallback: true,
        fallbackOnBody: true,
        fallbackTolerance: 5,
      }),
    )
  } finally {
    globalThis.__quickKanbanForceColumnSortableFallback = previous
  }
})

test('onMove inserts before add-column-control and child-panel-portal', () => {
  const add = document.createElement('div')
  add.className = 'add-column-control'
  expect(columnSortableOnMove({ related: add })).toBe(-1)

  const portal = document.createElement('div')
  portal.className = 'child-panel-portal'
  expect(columnSortableOnMove({ related: portal })).toBe(-1)

  const nested = document.createElement('div')
  add.appendChild(nested)
  expect(columnSortableOnMove({ related: nested })).toBe(-1)

  const column = document.createElement('section')
  column.className = 'kanban-column'
  expect(columnSortableOnMove({ related: column })).toBe(true)
})

test('dragging class is set on start and cleared on end', () => {
  document.documentElement.classList.remove(COLUMN_SORTABLE_DRAGGING_CLASS)
  const container = document.createElement('div')
  const sortable = createColumnSortable(container, { onReorder: vi.fn() })

  sortable.options.onStart()
  expect(document.documentElement.classList.contains(COLUMN_SORTABLE_DRAGGING_CLASS)).toBe(true)

  sortable.options.onEnd({ oldIndex: 0, newIndex: 0, item: null })
  expect(document.documentElement.classList.contains(COLUMN_SORTABLE_DRAGGING_CLASS)).toBe(false)
})

test('set and clear dragging class helpers', () => {
  clearColumnSortableDraggingClass()
  setColumnSortableDraggingClass()
  expect(document.documentElement.classList.contains(COLUMN_SORTABLE_DRAGGING_CLASS)).toBe(true)
  clearColumnSortableDraggingClass()
  expect(document.documentElement.classList.contains(COLUMN_SORTABLE_DRAGGING_CLASS)).toBe(false)
})

test('reparentColumnSortableFallback moves body mirror under #kanbanapp', () => {
  const app = document.createElement('div')
  app.id = 'kanbanapp'
  document.body.appendChild(app)

  const fallback = document.createElement('section')
  fallback.className = 'kanban-column sortable-fallback'
  document.body.appendChild(fallback)

  expect(reparentColumnSortableFallback(app)).toBe(fallback)
  expect(fallback.parentElement).toBe(app)
  expect(reparentColumnSortableFallback(app)).toBe(null)

  fallback.remove()
  app.remove()
})

test('reparentColumnSortableFallback is a no-op without host or mirror', () => {
  expect(reparentColumnSortableFallback(null)).toBe(null)
  expect(reparentColumnSortableFallback(document.createElement('div'))).toBe(null)
})

test('onStart reparents fallbackOnBody mirror into #kanbanapp', () => {
  const app = document.createElement('div')
  app.id = 'kanbanapp'
  const boardRoot = document.createElement('div')
  app.appendChild(boardRoot)
  document.body.appendChild(app)

  const fallback = document.createElement('section')
  fallback.className = 'kanban-column sortable-fallback'
  document.body.appendChild(fallback)

  const container = document.createElement('div')
  const sortable = createColumnSortable(container, {
    onReorder: vi.fn(),
    boardRoot,
  })
  sortable.options.onStart()

  expect(fallback.parentElement).toBe(app)

  fallback.remove()
  app.remove()
})

test('ignores unchanged column drag ends', () => {
  const container = document.createElement('div')
  const onReorder = vi.fn()
  const sortable = createColumnSortable(container, { onReorder })

  sortable.options.onEnd({ oldIndex: 1, newIndex: 1, item: null })
  expect(onReorder).not.toHaveBeenCalled()
})

test('clears leftover Sortable classes and draggable on column drag end', () => {
  const container = document.createElement('div')
  const column = document.createElement('section')
  column.className = 'kanban-column'
  column.classList.add(
    'sortable-drag',
    'sortable-chosen',
    COLUMN_SORTABLE_DRAG_CLASS,
    COLUMN_SORTABLE_CHOSEN_CLASS,
    COLUMN_SORTABLE_GHOST_CLASS,
  )
  column.draggable = true
  container.appendChild(column)

  const sortable = createColumnSortable(container, { onReorder: vi.fn() })
  sortable.options.onEnd({ oldIndex: 0, newIndex: 1, item: column })

  expect(column.classList.contains('sortable-drag')).toBe(false)
  expect(column.classList.contains('sortable-chosen')).toBe(false)
  expect(column.classList.contains(COLUMN_SORTABLE_DRAG_CLASS)).toBe(false)
  expect(column.classList.contains(COLUMN_SORTABLE_CHOSEN_CLASS)).toBe(false)
  expect(column.classList.contains(COLUMN_SORTABLE_GHOST_CLASS)).toBe(false)
  expect(column.draggable).toBe(false)
})

test('clearColumnSortableArtifacts scrubs all columns in the container', () => {
  const container = document.createElement('div')
  const a = document.createElement('section')
  const b = document.createElement('section')
  a.className = 'kanban-column'
  b.className = 'kanban-column'
  a.classList.add(COLUMN_SORTABLE_DRAG_CLASS, 'sortable-drag')
  b.classList.add(COLUMN_SORTABLE_CHOSEN_CLASS)
  a.draggable = true
  b.draggable = true
  container.append(a, b)

  clearColumnSortableArtifacts(container, a)

  expect(a.classList.contains(COLUMN_SORTABLE_DRAG_CLASS)).toBe(false)
  expect(a.classList.contains('sortable-drag')).toBe(false)
  expect(b.classList.contains(COLUMN_SORTABLE_CHOSEN_CLASS)).toBe(false)
  expect(a.draggable).toBe(false)
  expect(b.draggable).toBe(false)
})

test('wires swimlane drag sync when boardRoot is provided', () => {
  const container = document.createElement('div')
  const boardRoot = document.createElement('div')
  const onReorder = vi.fn()
  const onDragStart = vi.fn()
  const onDragEnd = vi.fn()
  const sortable = createColumnSortable(container, {
    onReorder,
    boardRoot,
    onDragStart,
    onDragEnd,
  })

  expect(createSwimlaneColumnDragSync).toHaveBeenCalledWith(boardRoot)

  sortable.options.onStart()
  expect(onDragStart).toHaveBeenCalled()
  expect(swimlaneSync.start).toHaveBeenCalled()
  expect(onDragStart.mock.invocationCallOrder[0])
    .toBeLessThan(swimlaneSync.start.mock.invocationCallOrder[0])

  sortable.options.onChange()
  expect(swimlaneSync.sync).toHaveBeenCalledTimes(1)

  sortable.options.onEnd({ oldIndex: 0, newIndex: 2, item: null })
  expect(swimlaneSync.finish).toHaveBeenCalledWith({ cancelled: false })
  expect(onDragEnd).toHaveBeenCalledWith({ cancelled: false })
  expect(onReorder).toHaveBeenCalledWith(['Done', 'Open'])
  // transforms must be cleared before store reorder
  expect(swimlaneSync.finish.mock.invocationCallOrder[0])
    .toBeLessThan(onReorder.mock.invocationCallOrder[0])
  expect(onDragEnd.mock.invocationCallOrder[0])
    .toBeLessThan(onReorder.mock.invocationCallOrder[0])
})

test('cancels swimlane sync when column drag ends unchanged', () => {
  const container = document.createElement('div')
  const boardRoot = document.createElement('div')
  const onReorder = vi.fn()
  const sortable = createColumnSortable(container, { onReorder, boardRoot })

  sortable.options.onStart()
  sortable.options.onChange()
  sortable.options.onEnd({ oldIndex: 1, newIndex: 1, item: null })

  expect(swimlaneSync.finish).toHaveBeenCalledWith({ cancelled: true })
  expect(onReorder).not.toHaveBeenCalled()
})

test('destroys an existing column sortable instance', () => {
  const destroy = vi.fn()
  destroyColumnSortable({ destroy })
  expect(destroy).toHaveBeenCalled()
})
