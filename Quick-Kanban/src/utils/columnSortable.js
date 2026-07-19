import Sortable from 'sortablejs'
import { createSwimlaneColumnDragSync } from './swimlaneColumnDragSync'

export function createColumnSortable(
  container,
  { onReorder, boardRoot, onDragStart, onDragEnd } = {},
) {
  if (!container) {
    return null
  }

  const swimlaneSync = boardRoot ? createSwimlaneColumnDragSync(boardRoot) : null

  const sortable = Sortable.create(container, {
    animation: 150,
    handle: '.column-title--draggable',
    draggable: '.kanban-column',
    filter: '.add-column-control',
    dataIdAttr: 'data-column-value',
    ghostClass: 'sortable-column-ghost',
    forceFallback: Boolean(globalThis.__quickKanbanForceColumnSortableFallback),
    onStart() {
      onDragStart?.()
      swimlaneSync?.start()
    },
    onChange() {
      swimlaneSync?.sync()
    },
    onEnd(event) {
      const unchanged = event.oldIndex === event.newIndex
      if (swimlaneSync) {
        // Always clear transforms before Vue reorders from store.
        swimlaneSync.finish({ cancelled: unchanged })
      }
      onDragEnd?.({ cancelled: unchanged })
      if (unchanged) {
        return
      }
      onReorder?.(sortable.toArray())
    },
  })

  return sortable
}

export function destroyColumnSortable(sortable) {
  sortable?.destroy()
}
