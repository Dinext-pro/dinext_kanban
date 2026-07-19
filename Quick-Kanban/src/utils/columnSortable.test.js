import { expect, test, vi, beforeEach } from 'vitest'
import { createColumnSortable, destroyColumnSortable } from './columnSortable'

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
    ghostClass: 'sortable-column-ghost',
  }))
  expect(createSwimlaneColumnDragSync).not.toHaveBeenCalled()

  sortable.options.onEnd({ oldIndex: 0, newIndex: 1 })
  expect(onReorder).toHaveBeenCalledWith(['Done', 'Open'])
})

test('ignores unchanged column drag ends', () => {
  const container = document.createElement('div')
  const onReorder = vi.fn()
  const sortable = createColumnSortable(container, { onReorder })

  sortable.options.onEnd({ oldIndex: 1, newIndex: 1 })
  expect(onReorder).not.toHaveBeenCalled()
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

  sortable.options.onEnd({ oldIndex: 0, newIndex: 2 })
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
  sortable.options.onEnd({ oldIndex: 1, newIndex: 1 })

  expect(swimlaneSync.finish).toHaveBeenCalledWith({ cancelled: true })
  expect(onReorder).not.toHaveBeenCalled()
})

test('destroys an existing column sortable instance', () => {
  const destroy = vi.fn()
  destroyColumnSortable({ destroy })
  expect(destroy).toHaveBeenCalled()
})
