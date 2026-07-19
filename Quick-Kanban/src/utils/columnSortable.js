import Sortable from 'sortablejs'
import { createSwimlaneColumnDragSync } from './swimlaneColumnDragSync'

export const COLUMN_SORTABLE_DRAG_CLASS = 'sortable-column-drag'
export const COLUMN_SORTABLE_CHOSEN_CLASS = 'sortable-column-chosen'
export const COLUMN_SORTABLE_GHOST_CLASS = 'sortable-column-ghost'

const COLUMN_SORTABLE_STALE_CLASSES = [
  'sortable-drag',
  'sortable-chosen',
  'sortable-ghost',
  COLUMN_SORTABLE_DRAG_CLASS,
  COLUMN_SORTABLE_CHOSEN_CLASS,
  COLUMN_SORTABLE_GHOST_CLASS,
]

export function clearColumnSortableArtifacts(container, dragEl) {
  const columns = new Set()
  if (dragEl?.classList?.contains('kanban-column')) {
    columns.add(dragEl)
  }
  container?.querySelectorAll?.('.kanban-column').forEach((el) => {
    columns.add(el)
  })
  for (const el of columns) {
    el.classList.remove(...COLUMN_SORTABLE_STALE_CLASSES)
    el.draggable = false
  }
}

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
    ghostClass: COLUMN_SORTABLE_GHOST_CLASS,
    dragClass: COLUMN_SORTABLE_DRAG_CLASS,
    chosenClass: COLUMN_SORTABLE_CHOSEN_CLASS,
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
      clearColumnSortableArtifacts(container, event.item)
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
