import { expect, test, vi } from 'vitest'
import { createColumnSortable, destroyColumnSortable } from './columnSortable'

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

import Sortable from 'sortablejs'

test('creates Sortable with the column drag handle and reports reorder', () => {
  const container = document.createElement('div')
  const onReorder = vi.fn()
  const sortable = createColumnSortable(container, { onReorder })

  expect(Sortable.create).toHaveBeenCalledWith(container, expect.objectContaining({
    handle: '.column-title--draggable',
    draggable: '.kanban-column',
    dataIdAttr: 'data-column-value',
    ghostClass: 'sortable-column-ghost',
  }))

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

test('destroys an existing column sortable instance', () => {
  const destroy = vi.fn()
  destroyColumnSortable({ destroy })
  expect(destroy).toHaveBeenCalled()
})
